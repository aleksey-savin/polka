import { and, desc, eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { book, refBook } from '@/db/schema/catalog'
import { aiIsbnGuess, aiSuggestion } from '@/db/schema/moderation'
import { user } from '@/db/schema/auth'
import { log } from '@/lib/logger'
import { ask, getAiSettings } from './ai'
import { syncBookAuthors } from './authors'
import { AppError } from './errors'
import { isbnOrigin } from './isbnPrefix'
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
  genSearch,
  mentionsIsbn,
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
}

/** Что ответил каждый источник — чтобы «не нашлось» не выглядело загадкой. */
export interface SourceReport {
  name: string
  outcome: 'нашёл' | 'молчит' | 'ошибка'
  detail: string | null
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
  /** Каким путём получено: sources · web-extract · web-generative · model. */
  via: string
  /** Страница, на которой встретился номер. */
  proof: { url: string; title: string } | null
}

const SYSTEM = [
  'Ты помогаешь опознать книгу по номеру ISBN.',
  'Отвечай строго одним JSON-объектом, без пояснений и разметки.',
  'Поля: known (boolean), title, authors, publisher, year (число), series.',
  'authors — «Имя Фамилия», несколько через запятую.',
  'Если ты не знаешь книгу с этим номером — верни {"known": false}.',
  'Выдумывать название запрещено: неуверенность означает known: false.',
].join(' ')

/** Достаём объект из ответа: модели любят обрамлять JSON текстом и ```. */
export function parseGuess(text: string): Guess {
  const empty: Guess = {
    known: false,
    title: null,
    authors: null,
    publisher: null,
    year: null,
    seriesName: null,
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
  const title = str(o.title)
  return {
    known: o.known === true && title !== null,
    title,
    authors: str(o.authors),
    publisher: str(o.publisher),
    year: Number.isFinite(year) && year > 1400 && year < 2100 ? year : null,
    seriesName: str(o.series) ?? str(o.seriesName),
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
export async function recognizeBook(
  userId: string,
  bookId: string,
): Promise<RecognizeResult> {
  const [row] = await db
    .select({
      id: book.id,
      isbn13: book.isbn13,
      unrecognized: book.unrecognized,
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
  const isbn13 = row.isbn13
  const fromPrefix = isbnOrigin(isbn13).publisher

  const hit = await cached(isbn13)
  if (hit) {
    return {
      bookId,
      isbn13,
      verdict: hit.verdict,
      guess: {
        known: hit.verdict !== 'unknown',
        title: hit.title,
        authors: hit.authors,
        publisher: hit.publisher,
        year: hit.year,
        seriesName: hit.seriesName,
      },
      fromPrefix,
      refBookId: hit.refBookId,
      workId: hit.workId,
      confirmed: hit.refBookId ? await confirmedFields(hit.refBookId) : null,
      cached: true,
      askedModel: false,
      sources: [],
      via: hit.via ?? 'model',
      proof: hit.proofUrl
        ? { url: hit.proofUrl, title: hit.proofTitle ?? hit.proofUrl }
        : null,
    }
  }

  // Источники — первыми: модель дорогая и ISBN не знает, а Google/FantLab
  // порой отвечают со второй попытки (квота, таймаут при добавлении).
  const { lookupIsbn } = await import('./metadata/lookup')
  const direct = await lookupIsbn(userId, isbn13)
  const sources: Array<SourceReport> = [
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
  ]
  if (direct.draft.title?.trim()) {
    // источники справились сами — модель не тревожим
    const refBookId = await bestRefBookIdForIsbn(isbn13)
    log.info('ai', 'разбор: хватило источников', {
      isbn: isbn13,
      sources: direct.sources.join(','),
    })
    return {
      bookId,
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
        pages: direct.draft.pages ?? null,
        seriesName: direct.draft.seriesName ?? null,
        coverUrl: direct.draft.coverUrl ?? null,
        annotation: direct.draft.annotation ?? null,
      },
      cached: false,
      askedModel: false,
      sources,
      via: 'sources',
      proof: null,
    }
  }

  // Поиск в интернете: номер лежит на страницах магазинов и библиотек.
  const web = await webSettings()
  if (!web.enabled) {
    // молчаливо пропущенный шаг выглядел как «нигде не нашлось»
    sources.push({
      name: 'Поиск в интернете',
      outcome: 'молчит',
      detail: 'выключен в настройках источников',
    })
  }
  if (web.enabled) {
    const found = await webLookup(userId, isbn13, web.mode, fromPrefix)
    if (found) {
      sources.push({
        name: 'Поиск в интернете',
        outcome: 'нашёл',
        detail: found.proof?.url ?? null,
      })
      return { ...found, bookId, isbn13, fromPrefix, sources }
    }
    sources.push({
      name: 'Поиск в интернете',
      outcome: 'молчит',
      detail: 'номер не встретился на найденных страницах',
    })
  }

  const settings = await getAiSettings()
  const prompt = [
    `ISBN: ${isbn13}.`,
    fromPrefix ? `Издательство по префиксу номера: ${fromPrefix}.` : '',
    'Какая это книга?',
  ]
    .filter(Boolean)
    .join(' ')
  const answer = await ask(userId, prompt, { system: SYSTEM, maxTokens: 300 })
  const guess = parseGuess(answer.text)
  const checked = await verify(userId, isbn13, guess)

  await db
    .insert(aiIsbnGuess)
    .values({
      isbn13,
      verdict: checked.verdict,
      title: guess.title,
      authors: guess.authors,
      publisher: guess.publisher ?? fromPrefix,
      year: guess.year,
      seriesName: guess.seriesName,
      refBookId: checked.refBookId,
      workId: checked.workId,
      model: settings.model,
      rawJson: answer.text.slice(0, 2000),
    })
    .onConflictDoNothing()

  log.info('ai', 'разбор нераспознанного', {
    isbn: isbn13,
    verdict: checked.verdict,
    tokens: answer.tokens,
  })

  return {
    bookId,
    isbn13,
    verdict: checked.verdict,
    guess,
    fromPrefix,
    refBookId: checked.refBookId,
    workId: checked.workId,
    confirmed: checked.refBookId
      ? await confirmedFields(checked.refBookId)
      : null,
    cached: false,
    askedModel: true,
    sources,
    via: 'model',
    proof: null,
  }
}

const WEB_SYSTEM = [
  'Ты читаешь фрагменты веб-страниц и выписываешь выходные данные книги.',
  'Отвечай строго одним JSON-объектом, без пояснений.',
  'Поля: known (boolean), title, authors, publisher, year (число), pages (число), series, sourceUrl.',
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

  await db
    .insert(aiIsbnGuess)
    .values({
      isbn13,
      // страница с номером — подтверждение не хуже каталога
      verdict: checked.refBookId ? 'confirmed' : 'unconfirmed',
      title: guess.title,
      authors: guess.authors,
      publisher: guess.publisher ?? fromPrefix,
      year: guess.year,
      seriesName: guess.seriesName,
      refBookId: checked.refBookId,
      workId: checked.workId,
      model: settings.model,
      via,
      proofUrl: box.proof?.url ?? null,
      proofTitle: box.proof?.title ?? null,
      rawJson: answer.text.slice(0, 2000),
    })
    .onConflictDoNothing()

  log.info('web', 'номер найден в интернете', { isbn: isbn13, via })

  return {
    verdict: checked.refBookId ? 'confirmed' : 'unconfirmed',
    guess,
    refBookId: checked.refBookId,
    workId: checked.workId,
    confirmed: checked.refBookId
      ? await confirmedFields(checked.refBookId)
      : null,
    cached: false,
    askedModel: true,
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
): Promise<{ verdict: Verdict }> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)
  if (!row.isbn13) throw new AppError('У книги нет ISBN', 'invalid')

  const hit = await cached(row.isbn13)
  if (!hit) {
    // Источники справились сами — это обычное дозаполнение, а не работа ИИ:
    // пометку «заполнил ИИ» и очередь модератора здесь ставить не за что.
    const { retryLookup } = await import('./unrecognized')
    const result = await retryLookup(userId, [bookId])
    if (result.resolved > 0) return { verdict: 'confirmed' }
    throw new AppError('Сначала разберите книгу', 'invalid')
  }
  if (hit.verdict === 'unknown') {
    throw new AppError(
      'Модель не знает этого номера — заполните вручную',
      'invalid',
    )
  }

  const fields = hit.refBookId ? await confirmedFields(hit.refBookId) : null
  const title = (fields?.title ?? hit.title ?? '').trim()
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
    publisher: fields?.publisher ?? hit.publisher,
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

  if (!row.coverPath && fields?.coverUrl) {
    try {
      const { saveCoverFromUrl } = await import('./covers')
      const saved = await saveCoverFromUrl(bookId, fields.coverUrl)
      await db
        .update(book)
        .set({ coverPath: saved.path, coverColor: saved.color })
        .where(eq(book.id, bookId))
    } catch {
      // обложка — best-effort, карточка уже заполнена
    }
  }

  await db.insert(aiSuggestion).values({
    bookId,
    isbn13: row.isbn13,
    verdict: hit.verdict,
    status: 'applied',
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(after),
    appliedBy: userId,
  })
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
