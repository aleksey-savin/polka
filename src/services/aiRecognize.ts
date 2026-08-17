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
  fetchOpenGraph,
  genSearch,
  mentionsIsbn,
  searchCoverImage,
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
  /** Человек отверг все пути — предлагать больше нечего. */
  exhausted: boolean
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
  annotation: string | null
  pages: number | null
}> {
  let { coverUrl, annotation, pages } = base
  if (coverUrl && annotation && pages) return { coverUrl, annotation, pages }

  const { fetchGoogleByTitle } = await import('./metadata/googleBooks')
  const byTitle = await fetchGoogleByTitle(base.title, base.authors)
  coverUrl = coverUrl ?? byTitle?.coverUrl ?? null
  annotation = annotation ?? byTitle?.annotation ?? null
  pages = pages ?? byTitle?.pages ?? null

  if ((!coverUrl || !annotation) && base.proofUrl) {
    const page = await fetchOpenGraph(base.proofUrl)
    coverUrl = coverUrl ?? page.image ?? null
    annotation = annotation ?? page.description ?? null
  }
  if (!coverUrl) {
    coverUrl = await searchCoverImage(
      `${base.title} ${base.authors ?? ''} обложка книги`.trim(),
    )
  }
  return { coverUrl, annotation, pages }
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

  if (hit && options.force) {
    await db.delete(aiIsbnGuess).where(eq(aiIsbnGuess.isbn13, isbn13))
    hit = null
    rejected.length = 0
  }
  if (hit) {
    // «не знаю», полученное до включения поиска, — не приговор
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
  if (hit && hit.via && rejected.includes(hit.via)) hit = null

  if (hit) {
    return {
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
      confirmed: hit.refBookId
        ? await confirmedFields(hit.refBookId)
        : hit.title
          ? {
              title: hit.title,
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
      const refBookId = await bestRefBookIdForIsbn(isbn13)
      const extra = await enrichMissing({
        title: direct.draft.title,
        authors: direct.draft.authors ?? null,
        coverUrl: direct.draft.coverUrl ?? null,
        annotation: direct.draft.annotation ?? null,
        pages: direct.draft.pages ?? null,
        proofUrl: null,
      })
      await writeGuess({
        isbn13,
        verdict: 'confirmed',
        title: direct.draft.title,
        authors: direct.draft.authors ?? null,
        publisher: direct.draft.publisher ?? null,
        year: direct.draft.year ?? null,
        seriesName: direct.draft.seriesName ?? null,
        pages: extra.pages,
        annotation: extra.annotation,
        coverUrl: extra.coverUrl,
        refBookId,
        workId: null,
        via: 'sources',
        rejectedVias: rejectedJson,
      })
      log.info('ai', 'разбор: хватило источников', {
        isbn: isbn13,
        sources: direct.sources.join(','),
      })
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
        exhausted: false,
        via: 'sources',
        proof: null,
      }
    }
  }

  // ── 2. Яндекс Поиск и Нейропоиск ──
  if (!web.enabled) {
    sources.push({
      name: 'Яндекс Поиск',
      outcome: 'молчит',
      detail: 'выключен в настройках источников',
    })
  } else {
    const modes: Array<'extract' | 'generative'> = options.mode
      ? [options.mode]
      : web.paidFallback
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

  // ── 3. Модель по памяти ──
  if (!rejected.includes('model')) {
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
    const extra = guess.title
      ? await enrichMissing({
          title: guess.title,
          authors: guess.authors,
          coverUrl: null,
          annotation: null,
          pages: null,
          proofUrl: null,
        })
      : { coverUrl: null, annotation: null, pages: null }

    await writeGuess({
      isbn13,
      verdict: checked.verdict,
      title: guess.title,
      authors: guess.authors,
      publisher: guess.publisher ?? fromPrefix,
      year: guess.year,
      seriesName: guess.seriesName,
      pages: extra.pages,
      annotation: extra.annotation,
      coverUrl: extra.coverUrl,
      refBookId: checked.refBookId,
      workId: checked.workId,
      model: settings.model,
      via: 'model',
      rawJson: answer.text.slice(0, 2000),
      rejectedVias: rejectedJson,
    })
    log.info('ai', 'разбор нераспознанного', {
      isbn: isbn13,
      verdict: checked.verdict,
      tokens: answer.tokens,
    })
    return {
      isbn13,
      verdict: checked.verdict,
      guess,
      fromPrefix,
      refBookId: checked.refBookId,
      workId: checked.workId,
      confirmed: checked.refBookId
        ? await confirmedFields(checked.refBookId)
        : guess.title
          ? {
              title: guess.title,
              authors: guess.authors ?? '',
              publisher: guess.publisher ?? fromPrefix,
              year: guess.year,
              pages: extra.pages,
              seriesName: guess.seriesName,
              coverUrl: extra.coverUrl,
              annotation: extra.annotation,
            }
          : null,
      cached: false,
      askedModel: true,
      sources,
      exhausted: !guess.title && rejected.length > 0,
      via: 'model',
      proof: null,
    }
  }

  // все пути отвергнуты или молчат
  await writeGuess({
    isbn13,
    verdict: 'unknown',
    via: 'model',
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
    exhausted: true,
    via: 'model',
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
  if (hit?.via && hit.verdict !== 'unknown') {
    const rejected = parseRejected(hit.rejectedVias)
    if (!rejected.includes(hit.via)) rejected.push(hit.via)
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
  rejectedJson: string,
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

  // В сниппетах нет ни обложки, ни описания. По названию и автору их отдаёт
  // Google Books; если и он молчит — берём открытые теги найденной страницы.
  const { fetchGoogleByTitle } = await import('./metadata/googleBooks')
  const byTitle = await fetchGoogleByTitle(guess.title, guess.authors)
  const page =
    box.proof && !byTitle?.coverUrl
      ? await fetchOpenGraph(box.proof.url)
      : { image: null, description: null }
  const extra = {
    pages: byTitle?.pages ?? null,
    annotation: byTitle?.annotation ?? page.description ?? null,
    coverUrl: byTitle?.coverUrl ?? page.image ?? null,
  }
  if (extra.coverUrl || extra.annotation) {
    log.info('web', 'добрали обложку и описание', {
      isbn: isbn13,
      from: byTitle ? 'google-by-title' : 'страница',
      cover: Boolean(extra.coverUrl),
      annotation: Boolean(extra.annotation),
    })
  }

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
    refBookId: checked.refBookId,
    workId: checked.workId,
    model: settings.model,
    via,
    proofUrl: box.proof?.url ?? null,
    proofTitle: box.proof?.title ?? null,
    rawJson: answer.text.slice(0, 2000),
    rejectedVias: rejectedJson,
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
  suggestionId: string
  /** Какие поля заполнятся: показываем человеку до применения. */
  fills: Array<{ field: string; label: string; value: string }>
  title: string
  authors: string
  coverUrl: string | null
  annotation: string | null
  proof: { url: string; title: string } | null
  via: string
}

const FIELD_LABEL: Record<string, string> = {
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
export async function proposeForBook(
  userId: string,
  bookId: string,
): Promise<Proposal | null> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)

  // 1. что уже известно по номеру: веб-находка хранит и страницу-доказательство
  const webHit = row.isbn13 ? await cached(row.isbn13) : null

  // 2. каталоги по номеру — там наше конкретное издание
  let draft: Record<string, unknown> = {}
  if (row.isbn13) {
    const { lookupIsbn } = await import('./metadata/lookup')
    const byIsbn = await lookupIsbn(userId, row.isbn13).catch(() => null)
    if (byIsbn?.draft.title) draft = { ...byIsbn.draft }
  }

  // 3. обложка и аннотация: Google по названию, затем страница из веб-находки
  const title =
    (draft.title as string | undefined) ?? webHit?.title ?? row.title
  const authors =
    (draft.authors as string | undefined) ?? webHit?.authors ?? row.authors
  if (!draft.coverUrl || !draft.annotation) {
    const { fetchGoogleByTitle } = await import('./metadata/googleBooks')
    const byTitle = await fetchGoogleByTitle(title, authors)
    draft = {
      ...byTitle,
      ...Object.fromEntries(
        Object.entries(draft).filter(([, v]) => v !== null && v !== undefined),
      ),
    }
  }
  if ((!draft.coverUrl || !draft.annotation) && webHit?.proofUrl) {
    const page = await fetchOpenGraph(webHit.proofUrl)
    draft.coverUrl = draft.coverUrl ?? page.image ?? undefined
    draft.annotation = draft.annotation ?? page.description ?? undefined
  }
  // данные веб-находки — как основа, если каталоги промолчали
  draft.publisher = draft.publisher ?? webHit?.publisher ?? undefined
  draft.year = draft.year ?? webHit?.year ?? undefined
  draft.pages = draft.pages ?? webHit?.pages ?? undefined
  draft.annotation = draft.annotation ?? webHit?.annotation ?? undefined
  draft.coverUrl = draft.coverUrl ?? webHit?.coverUrl ?? undefined

  const fills: Proposal['fills'] = []
  const patch: Record<string, unknown> = {}
  const put = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return
    const current = (row as unknown as Record<string, unknown>)[field]
    if (current !== null && current !== undefined && current !== '') return
    patch[field] = value
    fills.push({
      field,
      label: FIELD_LABEL[field] ?? field,
      value: String(value).slice(0, 120),
    })
  }
  put('authors', authors === row.authors ? null : authors)
  put('publisher', draft.publisher)
  put('year', draft.year)
  put('pages', draft.pages)
  put('annotation', draft.annotation)
  if (!row.coverPath && draft.coverUrl) {
    patch.coverUrl = draft.coverUrl
    fills.push({ field: 'coverUrl', label: 'обложка', value: 'нашлась' })
  }
  if (fills.length === 0) return null

  const [created] = await db
    .insert(aiSuggestion)
    .values({
      bookId,
      isbn13: row.isbn13 ?? '',
      verdict: 'confirmed',
      status: 'proposed',
      beforeJson: JSON.stringify(snapshot(row)),
      afterJson: JSON.stringify(patch),
      appliedBy: userId,
    })
    .returning({ id: aiSuggestion.id })
  if (!created) throw new AppError('Не удалось сохранить предложение')

  log.info('ai', 'дозаполнение предложено', {
    bookId,
    fields: fills.map((f) => f.field).join(','),
  })

  return {
    suggestionId: created.id,
    fills,
    title,
    authors,
    coverUrl: (draft.coverUrl as string | undefined) ?? null,
    annotation: (draft.annotation as string | undefined) ?? null,
    proof: webHit?.proofUrl
      ? { url: webHit.proofUrl, title: webHit.proofTitle ?? webHit.proofUrl }
      : null,
    via: webHit ? (webHit.via ?? 'model') : 'sources',
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
    await db
      .update(book)
      .set({
        ...patch,
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
