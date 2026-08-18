import { and, desc, eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { book, refBook } from '@/db/schema/catalog'
import { aiIsbnGuess, aiSuggestion } from '@/db/schema/moderation'
import { user } from '@/db/schema/auth'
import { log } from '@/lib/logger'
import { syncBookAuthors } from './authors'
import { AppError } from './errors'
import { isbnOrigin } from './isbnPrefix'
import { cleanAnnotation, cleanFoundTitle, cleanPublisher } from './find/clean'
import { memberLibraryIds } from './members'
import { requireModerator } from './moderation'
import { bestRefBookIdForIsbn, ensureRefWork } from './reference'
import { normalizeForSearch } from './search'
import type { FindOptions, SourceKey } from './find/types'
import { resolveSeriesByName } from './series'

/**
 * Разбор нераспознанных с ИИ (M25).
 *
 * Модель не знает ISBN — она знает книги. Поэтому её ответ никогда не
 * заполняет карточку напрямую: название и автора мы прогоняем через свой
 * поиск, и если каталог находит издание с этим номером, данные берутся из
 * каталога. Всё остальное живёт с честной пометкой «не подтверждено».
 */

// чистилки живут в подсистеме поиска: ими пользуются и адаптеры источников
export {
  cleanAnnotation,
  cleanFoundTitle,
  cleanPublisher,
  looksTransliterated,
} from './find/clean'

/** Имена ступеней такие же, как в «Сервис → Источники». */
const SOURCE_NAME: Record<string, string> = {
  reference: 'Свой эталон',
  fantlab: 'FantLab',
  google: 'Google Books',
  openlibrary: 'OpenLibrary',
  web: 'Яндекс Поиск',
  neuro: 'Нейропоиск',
}

export type Verdict = 'confirmed' | 'work-only' | 'unconfirmed' | 'unknown'

export interface Guess {
  known: boolean
  title: string | null
  authors: string | null
  publisher: string | null
  year: number | null
  seriesName: string | null
  /** Описание книги со страницы: есть только у веб-ветки. */
  annotation?: string | null
}

/** Что ответил каждый источник — чтобы «не нашлось» не выглядело загадкой. */
export interface SourceReport {
  name: string
  outcome: 'нашёл' | 'молчит' | 'ошибка'
  detail: string | null
}

/** Найденный вариант: хранится в истории по номеру, листается без запросов. */
export interface FoundVariant {
  via: string
  verdict: Verdict
  title: string
  authors: string | null
  publisher: string | null
  year: number | null
  pages: number | null
  seriesName: string | null
  annotation: string | null
  coverUrl: string | null
  coverOptions: Array<string>
  refBookId: string | null
  workId: string | null
  proofUrl: string | null
  proofTitle: string | null
}

export interface RecognizeResult {
  bookId: string
  isbn13: string
  verdict: Verdict
  /** Что предложила модель — показываем как есть, даже когда не подтвердилось. */
  guess: Guess
  /** Издательство из префикса номера: известно без всяких запросов. */
  fromPrefix: string | null
  /** Данные подтверждённого издания — ими и заполняем карточку. */
  refBookId: string | null
  workId: string | null
  confirmed: {
    title: string
    authors: string
    publisher: string | null
    year: number | null
    pages: number | null
    seriesName: string | null
    coverUrl: string | null
    annotation: string | null
  } | null
  /** Ответ пришёл из кэша — запрос к модели не тратился. */
  cached: boolean
  /** Спрашивали ли модель вообще: источники могли справиться сами. */
  askedModel: boolean
  sources: Array<SourceReport>
  /** Человек отверг все пути — предлагать больше нечего. */
  exhausted: boolean
  /** Кандидаты обложек для свайпа: первым — самый надёжный. */
  coverOptions: Array<string>
  /** Вся история находок: листается стрелками бесплатно. */
  variants: Array<FoundVariant>
  variantIndex: number
  /** Каким путём получено: sources · web-extract · web-generative · model. */
  via: string
  /** Страница, на которой встретился номер. */
  proof: { url: string; title: string } | null
}

/** Достаём объект из ответа: модели любят обрамлять JSON текстом и ```. */
export function parseGuess(text: string): Guess {
  const empty: Guess = {
    known: false,
    title: null,
    authors: null,
    publisher: null,
    year: null,
    seriesName: null,
    annotation: null,
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return empty
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return empty
  }
  if (typeof raw !== 'object' || raw === null) return empty
  const o = raw as Record<string, unknown>
  const str = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s.length > 0 ? s : null
  }
  const year = Number(o.year)
  const rawTitle = str(o.title)
  const title = rawTitle ? cleanFoundTitle(rawTitle) || null : null
  return {
    known: o.known === true && title !== null,
    title,
    authors: str(o.authors),
    publisher: cleanPublisher(str(o.publisher)),
    year: Number.isFinite(year) && year > 1400 && year < 2100 ? year : null,
    seriesName: str(o.series) ?? str(o.seriesName),
    annotation: cleanAnnotation(str(o.annotation)),
  }
}

/** Разбирать и откатывать можно только свои книги и книги своих библиотек. */
async function assertBookAccess(
  userId: string,
  row: { libraryId: string | null; addedBy: string | null },
): Promise<void> {
  if (row.addedBy === userId) return
  const libIds = await memberLibraryIds(userId)
  if (row.libraryId && libIds.includes(row.libraryId)) return
  throw new AppError('Нет доступа к этой книге', 'forbidden')
}

async function cached(isbn13: string) {
  const [row] = await db
    .select()
    .from(aiIsbnGuess)
    .where(eq(aiIsbnGuess.isbn13, isbn13))
  return row ?? null
}

async function confirmedFields(refBookId: string) {
  const [row] = await db.select().from(refBook).where(eq(refBook.id, refBookId))
  if (!row) return null
  return {
    title: row.title,
    authors: row.authors,
    publisher: row.publisher,
    year: row.year,
    pages: row.pages,
    seriesName: row.seriesName,
    coverUrl: row.coverUrl,
    annotation: row.annotation,
  }
}

/** Разбор одной книги. Тратит запрос к модели только если номер новый. */
type CoreResult = Omit<RecognizeResult, 'bookId'>

const parseRejected = (raw: string | null | undefined): Array<string> => {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

export function parseVariants(
  raw: string | null | undefined,
): Array<FoundVariant> {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (v): v is FoundVariant =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as FoundVariant).via === 'string' &&
        typeof (v as FoundVariant).title === 'string',
    )
  } catch {
    return []
  }
}

/** Вариант с той же ступени заменяется, с новой — добавляется в конец. */
export function upsertVariant(
  list: Array<FoundVariant>,
  variant: FoundVariant,
): Array<FoundVariant> {
  const rest = list.filter((v) => v.via !== variant.via)
  return [...rest, variant]
}

/** Снимок ответа в кэш; список отвергнутых путей не трогаем. */
async function writeGuess(
  values: typeof aiIsbnGuess.$inferInsert,
): Promise<void> {
  const { isbn13: _key, ...rest } = values
  await db
    .insert(aiIsbnGuess)
    .values(values)
    .onConflictDoUpdate({ target: aiIsbnGuess.isbn13, set: rest })
}

/**
 * Ядро разбора: одна цепочка на все входы — «Не распознано», карточку книги
 * и (дальше) сканер. Эталон → каталоги → Яндекс Поиск → Нейропоиск → модель;
 * каждый следующий шаг только если предыдущий молчит или отвергнут человеком.
 */
export interface RecognizeOptions {
  force?: boolean
  mode?: 'extract' | 'generative'
  /** Подмена источников в тестах. В бою не передаётся. */
  adapters?: FindOptions['adapters']
}

export async function recognizeIsbn(
  userId: string,
  isbn13: string,
  options: RecognizeOptions = {},
): Promise<CoreResult> {
  const { findEdition } = await import('./find/core')
  const hit = await cached(isbn13)
  const rejected = options.force ? [] : parseRejected(hit?.rejectedVias)

  const found = await findEdition(userId, isbn13, {
    force: options.force,
    rejected: rejected as Array<SourceKey>,
    adapters: options.adapters,
  })

  /**
   * Добор (обложка, аннотация, объём) цепочка складывает в слитый черновик, а
   * не в отдельные находки. Показываемому варианту это нужно не меньше:
   * иначе человек видит книгу без обложки и описания, хотя цепочка их достала.
   */
  const enrichOf = (f: (typeof found.findings)[number]) =>
    f.weak
      ? f.draft
      : {
          ...f.draft,
          annotation: f.draft.annotation ?? found.draft.annotation,
          coverUrl: f.draft.coverUrl ?? found.draft.coverUrl,
          pages: f.draft.pages ?? found.draft.pages,
        }

  const fresh: Array<FoundVariant> = found.findings.map((f) => ({
    via: f.variantKey,
    verdict: f.refBookId ? 'confirmed' : 'unconfirmed',
    ...(() => {
      const d = enrichOf(f)
      return {
        title: d.title ?? '',
        authors: d.authors ?? null,
        publisher: d.publisher ?? null,
        year: d.year ?? null,
        pages: d.pages ?? null,
        seriesName: d.seriesName ?? null,
        annotation: d.annotation ?? null,
        coverUrl: d.coverUrl ?? null,
      }
    })(),
    coverOptions: f.covers.length > 0 ? f.covers : found.covers,
    refBookId: f.refBookId,
    workId: f.workId,
    proofUrl: f.proof?.url ?? null,
    proofTitle: f.proof?.title ?? null,
  }))

  // История копится, а не перезаписывается: человек отверг ступень и пошёл
  // дальше — найденное раньше должно остаться под стрелками и листаться
  // бесплатно. «Начать заново» историю стирает намеренно.
  const known = options.force ? [] : parseVariants(hit?.variants)
  const variants = [
    ...known.filter((k) => !fresh.some((f) => f.via === k.via)),
    ...fresh,
  ]

  const title = found.draft.title ?? null
  // слабая находка (транслит вместо русского названия) подтверждённой не
  // считается, даже когда запись есть в эталоне: имя всё равно нечитаемое
  const solid = found.findings.some((f) => !f.weak && f.refBookId)
  const verdict: Verdict = solid
    ? 'confirmed'
    : title
      ? 'unconfirmed'
      : 'unknown'
  const top = found.findings[0]

  await writeGuess({
    isbn13,
    verdict,
    title,
    authors: found.draft.authors ?? null,
    publisher: found.draft.publisher ?? null,
    year: found.draft.year ?? null,
    seriesName: found.draft.seriesName ?? null,
    pages: found.draft.pages ?? null,
    annotation: found.draft.annotation ?? null,
    coverUrl: found.draft.coverUrl ?? null,
    coverOptions: JSON.stringify(found.covers),
    refBookId: found.refBookId,
    workId: found.workId,
    via: top?.variantKey ?? 'none',
    proofUrl: found.proof?.url ?? null,
    proofTitle: found.proof?.title ?? null,
    rejectedVias: JSON.stringify(rejected),
    variants: JSON.stringify(variants),
  })

  return {
    isbn13,
    verdict,
    guess: {
      known: verdict !== 'unknown',
      title,
      authors: found.draft.authors ?? null,
      publisher: found.draft.publisher ?? null,
      year: found.draft.year ?? null,
      seriesName: found.draft.seriesName ?? null,
    },
    fromPrefix: isbnOrigin(isbn13).publisher,
    refBookId: found.refBookId,
    workId: found.workId,
    confirmed: title
      ? {
          title,
          authors: found.draft.authors ?? '',
          publisher: found.draft.publisher ?? null,
          year: found.draft.year ?? null,
          pages: found.draft.pages ?? null,
          seriesName: found.draft.seriesName ?? null,
          coverUrl: found.draft.coverUrl ?? null,
          annotation: found.draft.annotation ?? null,
        }
      : null,
    cached: found.cached,
    askedModel: found.findings.some(
      (f) => f.key === 'web' || f.key === 'neuro',
    ),
    sources: found.probes.map((p) => ({
      name: SOURCE_NAME[p.key] ?? p.key,
      outcome:
        p.outcome === 'нашёл'
          ? ('нашёл' as const)
          : p.outcome === 'ошибка'
            ? ('ошибка' as const)
            : ('молчит' as const),
      detail: p.detail,
    })),
    exhausted: found.exhausted,
    coverOptions: found.covers,
    variants,
    // показываем лучшую находку, а не первую по цепочке: эталон стоит первым,
    // и латинская запись в нём перебивала бы русское название из поиска
    variantIndex: bestVariantIndex(variants, found.findings, rejected),
    via: top?.variantKey ?? 'none',
    proof: found.proof,
  }
}

/**
 * Какой вариант показать человеку.
 *
 * Не первый по цепочке: первым стоит свой эталон, и попавшая туда латиница
 * («Deti-bilingvy» вместо «Дети-билингвы») перебивала бы нормальное название,
 * найденное поиском. Берём первый неслабый с названием, иначе — первый.
 */
function bestVariantIndex(
  variants: Array<FoundVariant>,
  findings: Array<{ variantKey: string; weak: boolean }>,
  rejected: Array<string>,
): number {
  const weakKeys = new Set(
    findings.filter((f) => f.weak).map((f) => f.variantKey),
  )
  // отвергнутое человеком не предлагаем снова: он нажал «Искать дальше»
  // именно потому, что показанное его не устроило
  const usable = (v: FoundVariant) =>
    v.title.trim() !== '' && !rejected.includes(v.via)

  const best = variants.findIndex((v) => usable(v) && !weakKeys.has(v.via))
  if (best >= 0) return best
  // ничего свежего не нашлось — показываем хоть что-то неотвергнутое
  const spare = variants.findIndex(usable)
  return spare >= 0 ? spare : 0
}

export async function recognizeBook(
  userId: string,
  bookId: string,
  options: RecognizeOptions = {},
): Promise<RecognizeResult> {
  const [row] = await db
    .select({
      id: book.id,
      isbn13: book.isbn13,
      addedBy: book.addedBy,
      libraryId: book.libraryId,
    })
    .from(book)
    .where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)
  if (!row.isbn13) {
    throw new AppError('У книги нет ISBN — заполните вручную', 'invalid')
  }
  const core = await recognizeIsbn(userId, row.isbn13, options)
  return { ...core, bookId }
}

/**
 * «Искать дальше»: человек отверг показанный вариант — помечаем путь и
 * продолжаем цепочку со следующей ступени. Отвергнутое не показывается снова.
 */
export async function nextVariant(
  userId: string,
  bookId: string,
  options: RecognizeOptions = {},
): Promise<RecognizeResult> {
  const [row] = await db
    .select({
      id: book.id,
      isbn13: book.isbn13,
      addedBy: book.addedBy,
      libraryId: book.libraryId,
    })
    .from(book)
    .where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)
  if (!row.isbn13) throw new AppError('У книги нет ISBN', 'invalid')

  const hit = await cached(row.isbn13)
  if (hit && hit.verdict !== 'unknown') {
    // записи до появления колонки via — модельные: колонка появилась вместе
    // с веб-поиском, раньше путь был один
    const via = hit.via ?? 'model'
    const rejected = parseRejected(hit.rejectedVias)
    if (!rejected.includes(via)) rejected.push(via)
    await db
      .update(aiIsbnGuess)
      .set({
        rejectedVias: JSON.stringify(rejected),
        // сам вариант очищаем, чтобы кэш не вернул его же
        verdict: 'unknown',
        title: null,
        authors: null,
        coverUrl: null,
        annotation: null,
      })
      .where(eq(aiIsbnGuess.isbn13, row.isbn13))
    log.info('find', 'вариант отвергнут, ищем дальше', {
      isbn: row.isbn13,
      rejected: rejected.join(','),
    })

    // Человек отверг то, что дал общий эталон, — значит запись негодная.
    // Сам себя каталог не чинит: помечаем её модератору на проверку.
    if (via === 'reference' && hit.refBookId) {
      try {
        const { enqueue } = await import('./moderation')
        await enqueue(
          'ref_book',
          hit.refBookId,
          null,
          false,
          'Проверить актуальность: владелец отверг данные и продолжил поиск',
        )
        log.info('find', 'запись эталона помечена на проверку', {
          isbn: row.isbn13,
          refBookId: hit.refBookId,
        })
      } catch (error) {
        // пометка не должна мешать поиску, но молчать о ней нельзя
        log.warn('find', 'не удалось пометить запись эталона', {
          isbn: row.isbn13,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  const core = await recognizeIsbn(userId, row.isbn13, options)
  return { ...core, bookId }
}

/** Каталоги — обычное дозаполнение; модель участвует только в веб-ступенях. */
const FROM_AI = (via: string | null): boolean =>
  // у веб-ступени ключ варианта с номером: web#1, web#2 …
  Boolean(via && (via.startsWith('web') || via.startsWith('neuro')))

/** Снимок полей, которые меняет разбор: им же и откатываем. */
function snapshot(row: typeof book.$inferSelect) {
  return {
    title: row.title,
    authors: row.authors,
    publisher: row.publisher,
    year: row.year,
    pages: row.pages,
    annotation: row.annotation,
    seriesId: row.seriesId,
    unrecognized: row.unrecognized,
  }
}

/**
 * Применение к карточке. Подтверждённое берём из эталона, неподтверждённое —
 * со слов модели, но с пометкой, которая видна и владельцу, и модератору.
 */
export async function applyRecognition(
  userId: string,
  bookId: string,
  chosenCover?: string,
  variantVia?: string,
): Promise<{ verdict: Verdict }> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)
  if (!row.isbn13) throw new AppError('У книги нет ISBN', 'invalid')

  let hit = await cached(row.isbn13)
  if (!hit) {
    // Источники справились сами — это обычное дозаполнение, а не работа ИИ:
    // пометку «заполнил ИИ» и очередь модератора здесь ставить не за что.
    const { retryLookup } = await import('./unrecognized')
    const result = await retryLookup(userId, [bookId])
    if (result.resolved > 0) return { verdict: 'confirmed' }
    throw new AppError('Сначала разберите книгу', 'invalid')
  }

  // человек пролистал историю: сохраняем показанный вариант, а не последний
  if (variantVia) {
    const chosen = parseVariants(hit.variants).find((v) => v.via === variantVia)
    if (chosen) {
      hit = {
        ...hit,
        verdict: chosen.verdict,
        title: chosen.title,
        authors: chosen.authors,
        publisher: chosen.publisher,
        year: chosen.year,
        pages: chosen.pages,
        seriesName: chosen.seriesName,
        annotation: chosen.annotation,
        coverUrl: chosen.coverUrl,
        refBookId: chosen.refBookId,
        workId: chosen.workId,
        via: chosen.via,
      }
    }
  }
  if (hit.verdict === 'unknown') {
    throw new AppError('Номер не опознан — заполните вручную', 'invalid')
  }

  const fields = hit.refBookId
    ? await confirmedFields(hit.refBookId)
    : // веб-находка: данные лежат в самой записи
      {
        title: hit.title ?? '',
        authors: hit.authors ?? '',
        publisher: hit.publisher,
        year: hit.year,
        pages: hit.pages,
        seriesName: hit.seriesName,
        coverUrl: hit.coverUrl,
        annotation: hit.annotation,
      }
  const title = cleanFoundTitle(fields?.title ?? hit.title ?? '')
  if (!title) throw new AppError('Нечего применять: названия нет', 'invalid')
  const authors = (fields?.authors ?? hit.authors ?? '').trim()
  const seriesName = fields?.seriesName ?? hit.seriesName
  const seriesId = seriesName
    ? await resolveSeriesByName(userId, seriesName)
    : row.seriesId

  const before = snapshot(row)
  const after = {
    title,
    authors,
    publisher: cleanPublisher(fields?.publisher ?? hit.publisher),
    year: fields?.year ?? hit.year,
    pages: fields?.pages ?? row.pages,
    annotation: fields?.annotation ?? row.annotation,
    seriesId,
    unrecognized: false,
  }

  await db
    .update(book)
    .set({
      ...after,
      titleNorm: normalizeForSearch(title),
      authorsNorm: normalizeForSearch(authors),
      updatedAt: new Date(),
    })
    .where(eq(book.id, bookId))
  await syncBookAuthors(bookId, authors)

  const coverToSave = chosenCover?.startsWith('http')
    ? chosenCover
    : fields?.coverUrl
  if (!row.coverPath && coverToSave) {
    try {
      const { saveCoverFromUrl } = await import('./covers')
      const saved = await saveCoverFromUrl(bookId, coverToSave)
      await db
        .update(book)
        .set({ coverPath: saved.path, coverColor: saved.color })
        .where(eq(book.id, bookId))
    } catch {
      // обложка — best-effort, карточка уже заполнена
    }
  }

  // находка каталогов — обычное дозаполнение, а не работа модели:
  // пометка «Заполнил ИИ» и очередь модератора здесь ни к чему
  if (FROM_AI(hit.via)) {
    await db.insert(aiSuggestion).values({
      bookId,
      isbn13: row.isbn13,
      verdict: hit.verdict,
      status: 'applied',
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify(after),
      appliedBy: userId,
    })
    // в общую очередь модерации — с меткой «нашёл ИИ» (M29): отдельного
    // раздела «Проверка находок» больше нет. Ставим саму книгу: у веб-находки
    // подтверждённой записи эталона может и не быть, а проверять данные надо.
    const { enqueue } = await import('./moderation')
    await enqueue('ai_book', bookId, userId, true)
  }
  return { verdict: hit.verdict }
}

/** Откат: возвращаем карточку к тому, что было до разбора. */
export async function revertRecognition(
  userId: string,
  bookId: string,
): Promise<void> {
  const [target] = await db.select().from(book).where(eq(book.id, bookId))
  if (!target) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, target)

  const [row] = await db
    .select()
    .from(aiSuggestion)
    .where(
      and(eq(aiSuggestion.bookId, bookId), eq(aiSuggestion.status, 'applied')),
    )
    .orderBy(desc(aiSuggestion.appliedAt))
  if (!row) throw new AppError('Откатывать нечего', 'not_found')

  const before = JSON.parse(row.beforeJson) as ReturnType<typeof snapshot>
  await db
    .update(book)
    .set({
      ...before,
      titleNorm: normalizeForSearch(before.title),
      authorsNorm: normalizeForSearch(before.authors),
      updatedAt: new Date(),
    })
    .where(eq(book.id, bookId))
  await syncBookAuthors(bookId, before.authors)
  await db
    .update(aiSuggestion)
    .set({ status: 'reverted', reviewedBy: userId, reviewedAt: new Date() })
    .where(eq(aiSuggestion.id, row.id))
}

/** Есть ли на карточке непроверенная работа ИИ — от этого зависит плашка. */
export async function aiMarkFor(
  bookId: string,
): Promise<{ verdict: Verdict; appliedAt: Date; approved: boolean } | null> {
  const [row] = await db
    .select({
      verdict: aiSuggestion.verdict,
      appliedAt: aiSuggestion.appliedAt,
      status: aiSuggestion.status,
    })
    .from(aiSuggestion)
    .where(
      and(
        eq(aiSuggestion.bookId, bookId),
        inArray(aiSuggestion.status, ['applied', 'approved']),
      ),
    )
    .orderBy(desc(aiSuggestion.appliedAt))
  if (!row) return null
  return {
    verdict: row.verdict,
    appliedAt: row.appliedAt,
    approved: row.status === 'approved',
  }
}

export interface ReviewRow {
  id: string
  bookId: string
  isbn13: string
  verdict: Verdict
  title: string
  authors: string
  publisher: string | null
  year: number | null
  appliedAt: Date
  appliedByName: string | null
  fromPrefix: string | null
  inReference: boolean
}

/** Очередь модератора: что ИИ применил и ждёт проверки. */
export async function listAiReview(userId: string): Promise<Array<ReviewRow>> {
  await requireModerator(userId)
  const rows = await db
    .select({
      id: aiSuggestion.id,
      bookId: aiSuggestion.bookId,
      isbn13: aiSuggestion.isbn13,
      verdict: aiSuggestion.verdict,
      afterJson: aiSuggestion.afterJson,
      appliedAt: aiSuggestion.appliedAt,
      appliedByName: user.name,
    })
    .from(aiSuggestion)
    .leftJoin(user, eq(user.id, aiSuggestion.appliedBy))
    .where(eq(aiSuggestion.status, 'applied'))
    .orderBy(desc(aiSuggestion.appliedAt))

  const isbns = rows.map((r) => r.isbn13)
  const known =
    isbns.length > 0
      ? await db
          .select({ isbn13: refBook.isbn13 })
          .from(refBook)
          .where(inArray(refBook.isbn13, isbns))
      : []
  const inRef = new Set(known.map((k) => k.isbn13))

  return rows.map((r) => {
    const after = JSON.parse(r.afterJson) as {
      title: string
      authors: string
      publisher: string | null
      year: number | null
    }
    return {
      id: r.id,
      bookId: r.bookId,
      isbn13: r.isbn13,
      verdict: r.verdict,
      title: after.title,
      authors: after.authors,
      publisher: after.publisher,
      year: after.year,
      appliedAt: r.appliedAt,
      appliedByName: r.appliedByName,
      fromPrefix: isbnOrigin(r.isbn13).publisher,
      inReference: inRef.has(r.isbn13),
    }
  })
}

export async function pendingAiReview(): Promise<number> {
  const rows = await db
    .select({ id: aiSuggestion.id })
    .from(aiSuggestion)
    .where(eq(aiSuggestion.status, 'applied'))
  return rows.length
}

/**
 * Утверждение модератором. Подтверждённое каталогом уже лежит в эталоне;
 * остальное заводим записью source='manual' — с этого момента такой ISBN
 * находится поиском, и модель по нему больше не спрашивают.
 */
export async function approveToReference(
  userId: string,
  suggestionId: string,
  patch?: {
    title?: string
    authors?: string
    publisher?: string
    year?: number | null
  },
): Promise<void> {
  await requireModerator(userId)
  const [row] = await db
    .select()
    .from(aiSuggestion)
    .where(eq(aiSuggestion.id, suggestionId))
  if (!row) throw new AppError('Запись не найдена', 'not_found')

  const after = JSON.parse(row.afterJson) as {
    title: string
    authors: string
    publisher: string | null
    year: number | null
  }
  const title = (patch?.title ?? after.title).trim()
  const authors = (patch?.authors ?? after.authors).trim()
  if (!title) throw new AppError('Без названия в эталон нельзя', 'invalid')

  const existing = await bestRefBookIdForIsbn(row.isbn13)
  if (!existing) {
    const refBookId = crypto.randomUUID()
    await db.insert(refBook).values({
      id: refBookId,
      source: 'manual',
      sourceRef: row.isbn13,
      isbn13: row.isbn13,
      title,
      titleNorm: normalizeForSearch(title),
      authors,
      publisher: patch?.publisher ?? after.publisher,
      year: patch?.year ?? after.year,
    })
    // произведение в эталоне: без него издание не найдётся поиском по автору
    const workId = await ensureRefWork(
      'manual',
      `isbn:${row.isbn13}`,
      title,
      patch?.year ?? after.year,
      null,
    )
    const { refBookWork } = await import('@/db/schema/catalog')
    await db
      .insert(refBookWork)
      .values({ refBookId, workId })
      .onConflictDoNothing()
  }

  if (patch && (patch.title || patch.authors)) {
    await db
      .update(book)
      .set({
        title,
        titleNorm: normalizeForSearch(title),
        authors,
        authorsNorm: normalizeForSearch(authors),
        updatedAt: new Date(),
      })
      .where(eq(book.id, row.bookId))
    await syncBookAuthors(row.bookId, authors)
  }

  await db
    .update(aiSuggestion)
    .set({ status: 'approved', reviewedBy: userId, reviewedAt: new Date() })
    .where(eq(aiSuggestion.id, suggestionId))
  log.info('ai', 'разбор утверждён в эталон', { isbn: row.isbn13 })
}

/** Отклонение: карточку возвращаем к ISBN, номер помечаем как «не вышло». */
export async function rejectRecognition(
  userId: string,
  suggestionId: string,
  note: string,
): Promise<void> {
  await requireModerator(userId)
  const [row] = await db
    .select()
    .from(aiSuggestion)
    .where(eq(aiSuggestion.id, suggestionId))
  if (!row) throw new AppError('Запись не найдена', 'not_found')
  if (!note.trim()) throw new AppError('Нужна причина', 'invalid')

  const before = JSON.parse(row.beforeJson) as ReturnType<typeof snapshot>
  await db
    .update(book)
    .set({
      ...before,
      titleNorm: normalizeForSearch(before.title),
      authorsNorm: normalizeForSearch(before.authors),
      updatedAt: new Date(),
    })
    .where(eq(book.id, row.bookId))
  await syncBookAuthors(row.bookId, before.authors)
  await db
    .update(aiSuggestion)
    .set({
      status: 'rejected',
      reviewedBy: userId,
      reviewedAt: new Date(),
      reviewNote: note.trim(),
    })
    .where(eq(aiSuggestion.id, suggestionId))

  // ответ модели по этому номеру оказался негодным — пусть не всплывает снова
  await db
    .update(aiIsbnGuess)
    .set({ verdict: 'unknown', title: null, authors: null })
    .where(eq(aiIsbnGuess.isbn13, row.isbn13))
  log.info('ai', 'разбор отклонён', { isbn: row.isbn13, note: note.trim() })
}

/**
 * «Не то»: человек посмотрел на найденное и отверг. Книга остаётся
 * нераспознанной, а негодный ответ больше не предлагается.
 */
export async function dismissRecognition(
  userId: string,
  bookId: string,
): Promise<void> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)
  if (!row.isbn13) return
  await db
    .update(aiIsbnGuess)
    .set({ verdict: 'unknown', title: null, authors: null, coverUrl: null })
    .where(eq(aiIsbnGuess.isbn13, row.isbn13))
  log.info('ai', 'найденное отклонено человеком', { isbn: row.isbn13 })
}

export interface Proposal {
  /** Нет id — менять нечего: показываем находку и предлагаем искать дальше. */
  suggestionId: string | null
  /** Какая ветка: заполнить пустое или заменить всё. */
  mode: UpdateMode
  /** Какие поля изменятся и что в них было: сравнение до применения. */
  fills: Array<{
    field: string
    label: string
    value: string
    was: string | null
  }>
  title: string
  authors: string
  coverUrl: string | null
  annotation: string | null
  /** Что в карточке сейчас — для сравнения «было → станет». */
  current: {
    title: string
    authors: string
    publisher: string | null
    year: number | null
  }
  /** Найденные варианты: их листают стрелками, как в разборе. */
  variants: Array<FoundVariant>
  variantIndex: number
  proof: { url: string; title: string } | null
  via: string
  /** Цепочка дошла до конца — «искать дальше» уже некуда. */
  exhausted: boolean
}

const FIELD_LABEL: Record<string, string> = {
  title: 'название',
  publisher: 'издательство',
  year: 'год',
  pages: 'страниц',
  annotation: 'аннотация',
  coverUrl: 'обложка',
  seriesName: 'серия',
  authors: 'авторы',
}

/**
 * «Найти данные» для книги, у которой название уже есть: из «Не распознано»
 * она ушла, а обложки и аннотации может не быть. Заполняем только пустые поля —
 * введённое руками не трогаем.
 */
export type UpdateMode = 'fill' | 'replace'

/**
 * Обновление данных карточки (M31): две ветки, а не переключатель.
 *
 * «Найти недостающее» трогает только пустые поля, «Заменить данные»
 * перезаписывает карточку целиком. Разные намерения и разная цена ошибки,
 * поэтому и вызовы разные. Поиск — общий: та же цепочка с порядком из
 * настроек, что и в разборе нераспознанных.
 */
export async function proposeForBook(
  userId: string,
  bookId: string,
  mode: UpdateMode = 'fill',
  variantVia?: string,
  fresh = false,
  options: RecognizeOptions = {},
): Promise<Proposal | null> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)

  // штатная цепочка: эталон → каталоги → Яндекс Поиск → Нейропоиск;
  // «искать заново» забывает и кэш, и отвергнутые пути — тупика быть не должно
  const found = row.isbn13
    ? await recognizeIsbn(userId, row.isbn13, { ...options, force: fresh })
    : null
  const shown =
    found?.variants.find((v) => v.via === variantVia) ??
    found?.variants[found.variantIndex] ??
    found?.variants[found.variants.length - 1] ??
    null

  // добор по названию живёт в цепочке (enrichDraft) и подчиняется настройкам:
  // ходить отсюда в Google напрямую значило бы снова обойти «Источники»
  const draft = {
    title: shown?.title ?? null,
    authors: shown?.authors ?? null,
    publisher: shown?.publisher ?? null,
    year: shown?.year ?? null,
    pages: shown?.pages ?? null,
    annotation: shown?.annotation ?? null,
    coverUrl: shown?.coverUrl ?? null,
    seriesName: shown?.seriesName ?? null,
  }
  if (!draft.title) return null

  const fills: Proposal['fills'] = []
  const patch: Record<string, unknown> = {}
  const put = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return
    const current = (row as unknown as Record<string, unknown>)[field]
    const empty = current === null || current === undefined || current === ''
    // «найти недостающее» правит только пустое, «заменить» — всё
    if (mode === 'fill' && !empty) return
    if (mode === 'replace' && current === value) return
    patch[field] = value
    fills.push({
      field,
      label: FIELD_LABEL[field] ?? field,
      value: String(value).slice(0, 160),
      was: empty ? null : String(current).slice(0, 160),
    })
  }
  if (mode === 'replace') put('title', draft.title)
  put('authors', draft.authors)
  put('publisher', draft.publisher)
  put('year', draft.year)
  put('pages', draft.pages)
  put('annotation', draft.annotation)
  if (draft.coverUrl && (mode === 'replace' || !row.coverPath)) {
    patch.coverUrl = draft.coverUrl
    fills.push({
      field: 'coverUrl',
      label: 'обложка',
      value: draft.coverUrl,
      was: row.coverPath ? 'своя' : null,
    })
  }
  const nothingToChange = fills.length === 0

  const [created] = nothingToChange
    ? [null]
    : await db
        .insert(aiSuggestion)
        .values({
          bookId,
          isbn13: row.isbn13 ?? '',
          verdict: shown?.verdict ?? 'unconfirmed',
          status: 'proposed',
          via: shown?.via ?? 'sources',
          beforeJson: JSON.stringify(snapshot(row)),
          afterJson: JSON.stringify(patch),
          appliedBy: userId,
        })
        .returning({ id: aiSuggestion.id })
  if (!created && !nothingToChange) {
    throw new AppError('Не удалось сохранить предложение')
  }

  log.info('ai', 'обновление данных предложено', {
    bookId,
    mode,
    fields: fills.map((f) => f.field).join(',') || 'нечего менять',
  })

  return {
    suggestionId: created?.id ?? null,
    mode,
    fills,
    title: draft.title,
    authors: draft.authors ?? row.authors,
    coverUrl: draft.coverUrl,
    annotation: draft.annotation,
    current: {
      title: row.title,
      authors: row.authors,
      publisher: row.publisher,
      year: row.year,
    },
    variants: found?.variants ?? [],
    variantIndex: shown
      ? (found?.variants.findIndex((v) => v.via === shown.via) ?? 0)
      : 0,
    proof: shown?.proofUrl
      ? { url: shown.proofUrl, title: shown.proofTitle ?? shown.proofUrl }
      : null,
    via: shown?.via ?? 'sources',
    exhausted: found?.exhausted ?? true,
  }
}

/** Применение предложения: только те поля, что были пустыми. */
export async function applyProposal(
  userId: string,
  suggestionId: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(aiSuggestion)
    .where(eq(aiSuggestion.id, suggestionId))
  if (!row || row.status !== 'proposed') {
    throw new AppError('Предложение не найдено', 'not_found')
  }
  const [target] = await db.select().from(book).where(eq(book.id, row.bookId))
  if (!target) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, target)

  const patch = JSON.parse(row.afterJson) as Record<string, unknown>
  const coverUrl = typeof patch.coverUrl === 'string' ? patch.coverUrl : null
  delete patch.coverUrl

  if (Object.keys(patch).length > 0) {
    const authors = typeof patch.authors === 'string' ? patch.authors : null
    const title = typeof patch.title === 'string' ? patch.title : null
    await db
      .update(book)
      .set({
        ...patch,
        // поиск ищет по нормализованным полям: меняем их вместе с исходными
        ...(title ? { titleNorm: normalizeForSearch(title) } : {}),
        ...(authors ? { authorsNorm: normalizeForSearch(authors) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(book.id, row.bookId))
    if (authors) await syncBookAuthors(row.bookId, authors)
  }
  if (coverUrl) {
    try {
      const { saveCoverFromUrl } = await import('./covers')
      const saved = await saveCoverFromUrl(row.bookId, coverUrl)
      await db
        .update(book)
        .set({ coverPath: saved.path, coverColor: saved.color })
        .where(eq(book.id, row.bookId))
    } catch {
      // обложка — best-effort
    }
  }
  await db
    .update(aiSuggestion)
    .set({ status: 'applied', appliedAt: new Date() })
    .where(eq(aiSuggestion.id, suggestionId))
  log.info('ai', 'дозаполнение применено', {
    bookId: row.bookId,
    fields: Object.keys(patch).join(','),
  })
}

/** Отказ от предложения: ничего не меняем, запись закрываем. */
export async function dismissProposal(
  userId: string,
  suggestionId: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(aiSuggestion)
    .where(eq(aiSuggestion.id, suggestionId))
  if (!row) throw new AppError('Предложение не найдено', 'not_found')
  const [target] = await db.select().from(book).where(eq(book.id, row.bookId))
  if (target) await assertBookAccess(userId, target)
  await db
    .update(aiSuggestion)
    .set({ status: 'rejected', reviewedBy: userId, reviewedAt: new Date() })
    .where(eq(aiSuggestion.id, suggestionId))
}

/**
 * Перенос уже применённых находок в общую очередь (M29).
 *
 * До слияния они жили в отдельном разделе «Проверка находок» — после выката
 * их не было видно нигде. Ставится один раз: enqueue не плодит дубли.
 */
export async function backfillAiQueue(): Promise<number> {
  const rows = await db
    .select({
      bookId: aiSuggestion.bookId,
      appliedBy: aiSuggestion.appliedBy,
      via: aiSuggestion.via,
    })
    .from(aiSuggestion)
    .where(eq(aiSuggestion.status, 'applied'))
  if (rows.length === 0) return 0
  const { enqueue } = await import('./moderation')
  // находки каталогов проверять незачем: там не было модели
  const fromAi = rows.filter((row) => FROM_AI(row.via))
  for (const row of fromAi) {
    await enqueue('ai_book', row.bookId, row.appliedBy, true)
  }
  return fromAi.length
}
