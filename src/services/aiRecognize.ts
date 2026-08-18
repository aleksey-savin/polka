import { and, desc, eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { book, refBook } from '@/db/schema/catalog'
import { aiIsbnGuess, aiSuggestion } from '@/db/schema/moderation'
import { user } from '@/db/schema/auth'
import { log } from '@/lib/logger'
import { ask, getAiSettings } from './ai'
import { syncBookAuthors } from './authors'
import { AppError } from './errors'
import { isCyrillicRegion, isbnOrigin } from './isbnPrefix'
import { memberLibraryIds } from './members'
import { requireModerator } from './moderation'
import {
  bestRefBookIdForIsbn,
  ensureRefWork,
  fetchWorkEditions,
} from './reference'
import { normalizeForSearch } from './search'
import { resolveSeriesByName } from './series'
import { adoptExternalWork, searchByTitle } from './titleSearch'
import {
  fetchOpenGraph,
  genSearch,
  mentionsIsbn,
  searchCoverImages,
  searchWeb,
  spendSearch,
  webSettings,
} from './webSearch'

/**
 * Разбор нераспознанных с ИИ (M25).
 *
 * Модель не знает ISBN — она знает книги. Поэтому её ответ никогда не
 * заполняет карточку напрямую: название и автора мы прогоняем через свой
 * поиск, и если каталог находит издание с этим номером, данные берутся из
 * каталога. Всё остальное живёт с честной пометкой «не подтверждено».
 */

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

/** Магазинный мусор в названиях: точка в конце, «(тв. переплёт)», ISBN. */
export function cleanFoundTitle(raw: string): string {
  return raw
    .replace(
      /\s*\((?=[^)]*(?:переплёт|переплет|обложк|isbn|97[89][\d -]{10,}))[^)]*\)/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?<!\.)\.$/, '')
    .trim()
}

/** Издатель в источниках часто закавычен: «"Манн, Иванов и Фербер"». */
export function cleanPublisher(raw: string | null): string | null {
  if (!raw) return raw
  const cleaned = raw
    .trim()
    .replace(/^["'«„]+/, '')
    .replace(/["'»“]+$/, '')
    .replace(/\s*(?:ООО|ЗАО|ОАО|АО|ИП)\s+(?=\S)/i, '')
    .trim()
  return cleaned.length > 0 ? cleaned : null
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

/** Мусор магазинов: «Купить книгу … доставка … отзывы» — это не аннотация. */
const SHOP_NOISE =
  /(купить|заказать|интернет-магазин|доставка|цена|скидк|отзывы покупателей|наличии)/i

export function cleanAnnotation(raw: string | null): string | null {
  const text = raw?.replace(/\s+/g, ' ').trim() ?? ''
  if (text.length < 60) return null
  // страничные описания часто начинаются с карточки товара — такое не берём
  if (SHOP_NOISE.test(text.slice(0, 120))) return null
  return text.slice(0, 2000)
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

/**
 * Проверка гипотезы каталогом. FantLab часто молчит на поиск по ISBN, но по
 * названию находит произведение — и нужное издание оказывается в его списке.
 */
async function verify(
  userId: string,
  isbn13: string,
  guess: Guess,
): Promise<{
  verdict: Verdict
  refBookId: string | null
  workId: string | null
}> {
  if (!guess.known || !guess.title) {
    return { verdict: 'unknown', refBookId: null, workId: null }
  }
  const query = [guess.title, guess.authors?.split(/[,;]/)[0] ?? '']
    .join(' ')
    .trim()
  const found = await searchByTitle(userId, query)

  let workId = found.reference[0]?.workId ?? null
  const external = found.external[0]
  const externalId = external?.sourceId
  if (!workId && external && externalId) {
    workId = await adoptExternalWork(
      externalId,
      external.title,
      external.authors,
      external.year,
      external.workType,
      userId,
    )
  }
  if (workId) {
    // тянет издания произведения в эталон — среди них и ищем наш номер
    await fetchWorkEditions(userId, workId).catch(() => null)
  }
  const refBookId = await bestRefBookIdForIsbn(isbn13)
  if (refBookId) return { verdict: 'confirmed', refBookId, workId }
  if (workId) return { verdict: 'work-only', refBookId: null, workId }
  return { verdict: 'unconfirmed', refBookId: null, workId: null }
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
 * Добор недостающего: обложка, аннотация, объём. Чем бы книга ни нашлась,
 * человек должен получить полную карточку сразу — без второго шага.
 */
async function enrichMissing(base: {
  title: string
  authors: string | null
  coverUrl: string | null
  annotation: string | null
  pages: number | null
  proofUrl: string | null
}): Promise<{
  coverUrl: string | null
  coverOptions: Array<string>
  annotation: string | null
  pages: number | null
}> {
  let { annotation, pages } = base
  const covers: Array<string> = []
  const addCover = (url: string | null | undefined) => {
    if (url && url.startsWith('http') && !covers.includes(url)) covers.push(url)
  }
  // порядок надёжности: страница с номером → каталоги → Google → Картинки
  if (base.proofUrl) {
    const page = await fetchOpenGraph(base.proofUrl)
    addCover(page.image)
    annotation = annotation ?? cleanAnnotation(page.description ?? null)
  }
  addCover(base.coverUrl)

  if (!annotation || !pages || covers.length < 2) {
    const { fetchGoogleByTitle } = await import('./metadata/googleBooks')
    const byTitle = await fetchGoogleByTitle(base.title, base.authors)
    addCover(byTitle?.coverUrl)
    annotation = annotation ?? byTitle?.annotation ?? null
    pages = pages ?? byTitle?.pages ?? null
  }
  if (covers.length < 4) {
    for (const url of await searchCoverImages(
      `${base.title} ${base.authors ?? ''} книга обложка`.trim(),
      4 - covers.length,
    )) {
      addCover(url)
    }
  }
  return {
    coverUrl: covers[0] ?? null,
    coverOptions: covers.slice(0, 5),
    annotation,
    pages,
  }
}

const CYRILLIC = /[\u0400-\u04FF]/

/**
 * Транслит вместо названия — обычная беда каталогов: Google Books хранит
 * русские издания латиницей («Deti-bilingvy»), без издательства и аннотации.
 * Формально ответ есть, а карточка получается нечитаемой, поэтому цепочку на
 * такой находке не останавливаем: она остаётся запасным вариантом, а поиск
 * идёт дальше — за живой страницей на русском.
 */
export function looksTransliterated(
  isbn13: string,
  title: string | null | undefined,
  authors: string | null | undefined,
): boolean {
  if (!title?.trim()) return false
  if (CYRILLIC.test(title) || CYRILLIC.test(authors ?? '')) return false
  return isCyrillicRegion(isbn13)
}

/**
 * Ядро разбора: одна цепочка на все входы — «Не распознано», карточку книги
 * и (дальше) сканер. Эталон → каталоги → Яндекс Поиск → Нейропоиск → модель;
 * каждый следующий шаг только если предыдущий молчит или отвергнут человеком.
 */
export async function recognizeIsbn(
  userId: string,
  isbn13: string,
  options: { force?: boolean; mode?: 'extract' | 'generative' } = {},
): Promise<CoreResult> {
  const fromPrefix = isbnOrigin(isbn13).publisher
  const web = await webSettings()

  let hit = await cached(isbn13)
  const rejected = parseRejected(hit?.rejectedVias)
  let variants = parseVariants(hit?.variants)

  if (hit && options.force) {
    await db.delete(aiIsbnGuess).where(eq(aiIsbnGuess.isbn13, isbn13))
    hit = null
    rejected.length = 0
    variants = []
  }
  if (hit) {
    // «не знаю», полученное до включения поиска, — не приговор.
    // via='model' встречается в старых записях: ступени уже нет (M30.1)
    const staleWithoutWeb =
      hit.verdict === 'unknown' &&
      web.enabled &&
      (hit.via === null || hit.via === 'model') &&
      rejected.length === 0
    if (staleWithoutWeb) {
      log.info('ai', 'старый ответ по номеру отброшен', {
        isbn: isbn13,
        was: hit.verdict,
        via: hit.via,
      })
      hit = null
    }
  }
  if (hit && rejected.includes(hit.via ?? 'model')) hit = null
  if (
    hit &&
    hit.via === 'sources' &&
    looksTransliterated(isbn13, hit.title, hit.authors) &&
    web.enabled &&
    !rejected.includes('web-extract')
  ) {
    // карточка с латинским названием уже сохранена — но поиск не доделан
    log.info('ai', 'каталог дал транслит, идём в поиск', {
      isbn: isbn13,
      title: hit.title,
    })
    hit = null
  }

  if (hit) {
    const cachedTitle = hit.title ? cleanFoundTitle(hit.title) : hit.title
    return {
      isbn13,
      verdict: hit.verdict,
      guess: {
        known: hit.verdict !== 'unknown',
        title: cachedTitle,
        authors: hit.authors,
        publisher: hit.publisher,
        year: hit.year,
        seriesName: hit.seriesName,
      },
      fromPrefix,
      refBookId: hit.refBookId,
      workId: hit.workId,
      confirmed: hit.refBookId
        ? await confirmedFields(hit.refBookId)
        : cachedTitle
          ? {
              title: cachedTitle,
              authors: hit.authors ?? '',
              publisher: hit.publisher,
              year: hit.year,
              pages: hit.pages,
              seriesName: hit.seriesName,
              coverUrl: hit.coverUrl,
              annotation: hit.annotation,
            }
          : null,
      cached: true,
      askedModel: false,
      sources: [],
      coverOptions: parseRejected(hit.coverOptions),
      variants,
      variantIndex: Math.max(
        0,
        variants.findIndex((v) => v.via === (hit.via ?? 'model')),
      ),
      exhausted: hit.verdict === 'unknown' && rejected.length > 0,
      via: hit.via ?? 'model',
      proof: hit.proofUrl
        ? { url: hit.proofUrl, title: hit.proofTitle ?? hit.proofUrl }
        : null,
    }
  }

  const sources: Array<SourceReport> = []
  const rejectedJson = JSON.stringify(rejected)

  // ── 1. Эталон и каталоги ──
  if (!rejected.includes('sources')) {
    const { lookupIsbn } = await import('./metadata/lookup')
    const direct = await lookupIsbn(userId, isbn13)
    sources.push(
      {
        name: 'FantLab',
        outcome: direct.sources.includes('fantlab') ? 'нашёл' : 'молчит',
        detail: null,
      },
      {
        name: 'Google Books',
        outcome: direct.sources.includes('google') ? 'нашёл' : 'молчит',
        detail: direct.sources.includes('google')
          ? null
          : 'без своего ключа общая квота Google часто исчерпана',
      },
      {
        name: 'OpenLibrary',
        outcome: direct.sources.includes('openlibrary') ? 'нашёл' : 'молчит',
        detail: null,
      },
    )
    if (direct.draft.title?.trim()) {
      // проверенный модератором эталон под это правило не попадает: там
      // латиница — осознанное решение человека, а не транслит каталога
      const weak =
        !direct.sources.includes('manual') &&
        looksTransliterated(isbn13, direct.draft.title, direct.draft.authors)
      const refBookId = await bestRefBookIdForIsbn(isbn13)
      const extra = await enrichMissing({
        title: direct.draft.title,
        authors: direct.draft.authors ?? null,
        coverUrl: direct.draft.coverUrl ?? null,
        annotation: direct.draft.annotation ?? null,
        pages: direct.draft.pages ?? null,
        proofUrl: null,
      })
      variants = upsertVariant(variants, {
        via: 'sources',
        verdict: weak ? 'unconfirmed' : 'confirmed',
        title: direct.draft.title,
        authors: direct.draft.authors ?? null,
        publisher: direct.draft.publisher ?? null,
        year: direct.draft.year ?? null,
        pages: extra.pages,
        seriesName: direct.draft.seriesName ?? null,
        annotation: extra.annotation,
        coverUrl: extra.coverUrl,
        coverOptions: extra.coverOptions,
        refBookId,
        workId: null,
        proofUrl: null,
        proofTitle: null,
      })
      await writeGuess({
        isbn13,
        verdict: weak ? 'unconfirmed' : 'confirmed',
        title: direct.draft.title,
        authors: direct.draft.authors ?? null,
        publisher: direct.draft.publisher ?? null,
        year: direct.draft.year ?? null,
        seriesName: direct.draft.seriesName ?? null,
        pages: extra.pages,
        annotation: extra.annotation,
        coverUrl: extra.coverUrl,
        coverOptions: JSON.stringify(extra.coverOptions),
        refBookId,
        workId: null,
        via: 'sources',
        rejectedVias: rejectedJson,
        variants: JSON.stringify(variants),
      })
      log.info('ai', 'разбор: ответили источники', {
        isbn: isbn13,
        sources: direct.sources.join(','),
        weak,
      })
      // транслит держим про запас: вернём его, если дальше никто не ответит
      if (!weak)
        return {
          isbn13,
          verdict: 'confirmed',
          guess: {
            known: true,
            title: direct.draft.title,
            authors: direct.draft.authors ?? null,
            publisher: direct.draft.publisher ?? null,
            year: direct.draft.year ?? null,
            seriesName: direct.draft.seriesName ?? null,
          },
          fromPrefix,
          refBookId,
          workId: null,
          confirmed: {
            title: direct.draft.title,
            authors: direct.draft.authors ?? '',
            publisher: direct.draft.publisher ?? null,
            year: direct.draft.year ?? null,
            pages: extra.pages,
            seriesName: direct.draft.seriesName ?? null,
            coverUrl: extra.coverUrl,
            annotation: extra.annotation,
          },
          cached: false,
          askedModel: false,
          sources,
          coverOptions: extra.coverOptions,
          variants,
          variantIndex: variants.length - 1,
          exhausted: false,
          via: 'sources',
          proof: null,
        }
    }
  }

  // ── 2. Яндекс Поиск и Нейропоиск ── порядок и состав из настроек (M30)
  const { isEnabled } = await import('./bookSources')
  const webAllowed = await isEnabled('web')
  const neuroAllowed = await isEnabled('neuro')
  if (!webAllowed) {
    sources.push({
      name: 'Яндекс Поиск',
      outcome: 'молчит',
      detail: 'выключен в настройках источников',
    })
  } else {
    const modes: Array<'extract' | 'generative'> = options.mode
      ? [options.mode]
      : neuroAllowed && web.paidFallback
        ? ['extract', 'generative']
        : ['extract']
    for (const mode of modes) {
      const via = mode === 'generative' ? 'web-generative' : 'web-extract'
      if (rejected.includes(via)) continue
      const found = await webLookup(
        userId,
        isbn13,
        mode,
        fromPrefix,
        rejectedJson,
        variants,
      )
      if (found) {
        sources.push({
          name: mode === 'generative' ? 'Нейропоиск' : 'Яндекс Поиск',
          outcome: 'нашёл',
          detail: found.proof?.url ?? null,
        })
        return { ...found, isbn13, fromPrefix, sources }
      }
      sources.push({
        name: mode === 'generative' ? 'Нейропоиск' : 'Яндекс Поиск',
        outcome: 'молчит',
        detail: 'номер не встретился на найденных страницах',
      })
    }
  }

  /*
   * Ступени «спросить модель по памяти» больше нет (M30.1).
   *
   * ISBN — случайное число, а не факт о книге: модель номеров не помнит, зато
   * охотно сочиняет под них правдоподобные названия. На 29 номерах владельца
   * она не угадала ни одного, а запросы тратила. Модель осталась там, где
   * приносит пользу: читает найденные страницы в веб-поиске.
   */

  // поиск промолчал — отдаём отложенную находку каталога, она всё же лучше
  // пустой карточки: человек увидит её как «не подтверждено» и решит сам
  const spare = rejected.includes('sources')
    ? undefined
    : variants.find((v) => v.via === 'sources')
  if (spare) {
    log.info('ai', 'вернулись к находке каталога', { isbn: isbn13 })
    return {
      isbn13,
      verdict: 'unconfirmed',
      guess: {
        known: true,
        title: spare.title,
        authors: spare.authors,
        publisher: spare.publisher,
        year: spare.year,
        seriesName: spare.seriesName,
      },
      fromPrefix,
      refBookId: spare.refBookId,
      workId: spare.workId,
      confirmed: {
        title: spare.title,
        authors: spare.authors ?? '',
        publisher: spare.publisher,
        year: spare.year,
        pages: spare.pages,
        seriesName: spare.seriesName,
        coverUrl: spare.coverUrl,
        annotation: spare.annotation,
      },
      cached: false,
      askedModel: false,
      sources,
      coverOptions: spare.coverOptions,
      variants,
      variantIndex: variants.findIndex((v) => v.via === 'sources'),
      exhausted: true,
      via: 'sources',
      proof: null,
    }
  }

  // все пути отвергнуты или молчат
  await writeGuess({
    isbn13,
    verdict: 'unknown',
    via: 'none',
    rejectedVias: rejectedJson,
  })
  return {
    isbn13,
    verdict: 'unknown',
    guess: {
      known: false,
      title: null,
      authors: null,
      publisher: null,
      year: null,
      seriesName: null,
    },
    fromPrefix,
    refBookId: null,
    workId: null,
    confirmed: null,
    cached: false,
    askedModel: false,
    sources,
    coverOptions: [],
    variants,
    variantIndex: 0,
    exhausted: true,
    via: 'none',
    proof: null,
  }
}

export async function recognizeBook(
  userId: string,
  bookId: string,
  options: { force?: boolean; mode?: 'extract' | 'generative' } = {},
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
    log.info('ai', 'вариант отвергнут, ищем дальше', {
      isbn: row.isbn13,
      rejected: rejected.join(','),
    })
  }
  const core = await recognizeIsbn(userId, row.isbn13)
  return { ...core, bookId }
}

const WEB_SYSTEM = [
  'Ты читаешь фрагменты веб-страниц и выписываешь выходные данные книги.',
  'Отвечай строго одним JSON-объектом, без пояснений.',
  'Поля: known (boolean), title, authors, publisher, year (число), pages (число), series, annotation, sourceUrl.',
  'annotation — описание книги из фрагментов (о чём она), без слов про магазин, цену и доставку; если описания нет, верни null.',
  'Бери только то, что есть во фрагментах; sourceUrl — адрес страницы, откуда взял.',
  'Если во фрагментах нет книги с этим ISBN — верни {"known": false}.',
].join(' ')

/**
 * Веб-поиск с извлечением. Правило приёмки: номер должен встретиться в тексте
 * найденной страницы, иначе результат не берём.
 */
async function webLookup(
  userId: string,
  isbn13: string,
  mode: 'extract' | 'generative',
  fromPrefix: string | null,
  rejectedJson: string,
  knownVariants: Array<FoundVariant>,
): Promise<Omit<
  RecognizeResult,
  'bookId' | 'isbn13' | 'fromPrefix' | 'sources'
> | null> {
  let payload = ''
  interface Proof {
    url: string
    title: string
  }
  // ссылку набираем внутри колбэка расхода — держим в объекте, иначе TS
  // считает переменную навсегда null
  const box: { proof: Proof | null } = { proof: null }

  try {
    if (mode === 'generative') {
      await spendSearch(userId, async () => {
        const answer = await genSearch(
          `Книга с ISBN ${isbn13}: название, автор, издательство, год, число страниц.`,
        )
        const cited =
          answer.sources.find((src) => src.used) ?? answer.sources[0]
        if (cited)
          box.proof = { url: cited.url, title: cited.title || cited.url }
        payload = [
          answer.text,
          ...answer.sources.map((src) => `${src.url} ${src.title}`),
        ].join('\n')
        return `${answer.sources.length} источников`
      })
    } else {
      await spendSearch(userId, async () => {
        const hits = await searchWeb(`ISBN ${isbn13}`)
        const withIsbn = hits.filter(
          (hit) =>
            mentionsIsbn(hit.text, isbn13) || mentionsIsbn(hit.title, isbn13),
        )
        const useful = withIsbn.length > 0 ? withIsbn : hits
        const first = withIsbn[0]
        if (first)
          box.proof = { url: first.url, title: first.title || first.url }
        payload = useful
          .slice(0, 8)
          .map((hit) => `${hit.url}\n${hit.title}\n${hit.text}`)
          .join('\n\n')
        return `${hits.length} результатов, с номером ${withIsbn.length}`
      })
    }
  } catch (error) {
    log.warn('web', 'поиск по номеру не удался', {
      isbn: isbn13,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }

  // без номера в тексте доверять нечему
  if (!payload.trim() || !mentionsIsbn(payload, isbn13)) return null

  const answer = await ask(
    userId,
    `ISBN: ${isbn13}. Фрагменты найденных страниц:\n\n${payload.slice(0, 6000)}`,
    { system: WEB_SYSTEM, maxTokens: 400 },
  )
  const guess = parseGuess(answer.text)
  if (!guess.known || !guess.title) return null

  const checked = await verify(userId, isbn13, guess)
  const via = mode === 'generative' ? 'web-generative' : 'web-extract'
  const settings = await getAiSettings()

  // в сниппетах нет ни обложки, ни описания — добираем общим путём
  const extra = await enrichMissing({
    title: guess.title,
    authors: guess.authors,
    coverUrl: null,
    annotation: guess.annotation ?? null,
    pages: null,
    proofUrl: box.proof?.url ?? null,
  })

  const variants = upsertVariant(knownVariants, {
    via,
    verdict: checked.refBookId ? 'confirmed' : 'unconfirmed',
    title: guess.title,
    authors: guess.authors,
    publisher: guess.publisher ?? fromPrefix,
    year: guess.year,
    pages: extra.pages,
    seriesName: guess.seriesName,
    annotation: extra.annotation,
    coverUrl: extra.coverUrl,
    coverOptions: extra.coverOptions,
    refBookId: checked.refBookId,
    workId: checked.workId,
    proofUrl: box.proof?.url ?? null,
    proofTitle: box.proof?.title ?? null,
  })

  await writeGuess({
    isbn13,
    // страница с номером — подтверждение не хуже каталога
    verdict: checked.refBookId ? 'confirmed' : 'unconfirmed',
    title: guess.title,
    authors: guess.authors,
    publisher: guess.publisher ?? fromPrefix,
    year: guess.year,
    seriesName: guess.seriesName,
    pages: extra.pages,
    annotation: extra.annotation,
    coverUrl: extra.coverUrl,
    coverOptions: JSON.stringify(extra.coverOptions),
    refBookId: checked.refBookId,
    workId: checked.workId,
    model: settings.model,
    via,
    proofUrl: box.proof?.url ?? null,
    proofTitle: box.proof?.title ?? null,
    rawJson: answer.text.slice(0, 2000),
    rejectedVias: rejectedJson,
    variants: JSON.stringify(variants),
  })

  log.info('web', 'номер найден в интернете', { isbn: isbn13, via })

  return {
    verdict: checked.refBookId ? 'confirmed' : 'unconfirmed',
    guess,
    refBookId: checked.refBookId,
    workId: checked.workId,
    confirmed: checked.refBookId
      ? await confirmedFields(checked.refBookId)
      : {
          title: guess.title,
          authors: guess.authors ?? '',
          publisher: guess.publisher ?? fromPrefix,
          year: guess.year,
          pages: extra.pages,
          seriesName: guess.seriesName,
          coverUrl: extra.coverUrl,
          annotation: extra.annotation,
        },
    cached: false,
    askedModel: true,
    coverOptions: extra.coverOptions,
    variants,
    variantIndex: variants.length - 1,
    exhausted: false,
    via,
    proof: box.proof,
  }
}

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
  if (hit.via !== 'sources') {
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
): Promise<Proposal | null> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)

  // штатная цепочка: эталон → каталоги → Яндекс Поиск → Нейропоиск;
  // «искать заново» забывает и кэш, и отвергнутые пути — тупика быть не должно
  const found = row.isbn13
    ? await recognizeIsbn(userId, row.isbn13, { force: fresh })
    : null
  const shown =
    found?.variants.find((v) => v.via === variantVia) ??
    found?.variants[found.variantIndex] ??
    found?.variants[found.variants.length - 1] ??
    null

  // без ISBN остаётся поиск по названию: обложка и описание тоже нужны
  const { fetchGoogleByTitle } = await import('./metadata/googleBooks')
  const byTitle =
    shown === null ? await fetchGoogleByTitle(row.title, row.authors) : null

  const draft = {
    title: shown?.title ?? byTitle?.title ?? null,
    authors: shown?.authors ?? byTitle?.authors ?? null,
    publisher: shown?.publisher ?? byTitle?.publisher ?? null,
    year: shown?.year ?? byTitle?.year ?? null,
    pages: shown?.pages ?? byTitle?.pages ?? null,
    annotation: shown?.annotation ?? byTitle?.annotation ?? null,
    coverUrl: shown?.coverUrl ?? byTitle?.coverUrl ?? null,
    seriesName: shown?.seriesName ?? byTitle?.seriesName ?? null,
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
  const fromAi = rows.filter((row) => row.via !== 'sources')
  for (const row of fromAi) {
    await enqueue('ai_book', row.bookId, row.appliedBy, true)
  }
  return fromAi.length
}
