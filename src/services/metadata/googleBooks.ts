/**
 * Google Books. Без ключа общая анонимная квота исчерпана (проверено: 429),
 * поэтому ключ в проде обязателен — задаётся в «Сервис → Источники» или через
 * GOOGLE_BOOKS_API_KEY.
 *
 * Ключи в консоли Google по умолчанию ограничены по HTTP-referrer, а серверный
 * запрос реферер не посылает — отсюда 403 «Requests from referer <empty> are
 * blocked». Поэтому подставляем реферер приложения: ключ выдан для этого же
 * домена, и с ним ограничение выполняется.
 */
import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import { googleBooksKey } from '@/services/sources'
import { yearFrom } from './types'
import type { MetadataDraft, SourceResult } from './types'

const TIMEOUT = 4000
/** Google отвечает 503 «Service temporarily unavailable» на ровном месте —
    со второй попытки обычно проходит, поэтому повторяем. */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504])
const ATTEMPTS = 3

interface GbVolumeInfo {
  title?: string
  authors?: Array<string>
  publisher?: string
  publishedDate?: string
  description?: string
  pageCount?: number
  language?: string
  imageLinks?: { thumbnail?: string; smallThumbnail?: string }
}

export function parseGoogleBooks(json: unknown): MetadataDraft | null {
  const items = (
    json as { items?: Array<{ id?: string; volumeInfo?: GbVolumeInfo }> } | null
  )?.items
  const first = items?.[0]
  const info = first?.volumeInfo
  if (!info?.title) return null
  const draft: MetadataDraft = { title: info.title }
  if (info.authors?.length) draft.authors = info.authors.join('; ')
  if (info.publisher) draft.publisher = info.publisher
  const year = yearFrom(info.publishedDate)
  if (year) draft.year = year
  if (typeof info.pageCount === 'number' && info.pageCount > 0)
    draft.pages = info.pageCount
  if (info.description) draft.annotation = info.description
  if (info.language) draft.language = info.language
  const thumb = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail
  if (thumb) draft.coverUrl = thumb.replace(/^http:/, 'https:')
  return draft
}

export async function fetchGoogleBooks(
  isbn13: string,
): Promise<SourceResult | null> {
  try {
    const stored = await googleBooksKey()
    const key = stored ? `&key=${stored}` : ''
    let res: Response | null = null
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}&country=RU${key}`,
        {
          headers: { referer: `${env.APP_URL}/` },
          signal: AbortSignal.timeout(TIMEOUT),
        },
      )
      if (res.ok || !RETRY_STATUS.has(res.status)) break
      if (attempt < ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 400))
      }
    }
    if (!res) return null
    if (!res.ok) {
      // 403 — ключ ограничен и реферер не подошёл, 429 — квота: и то и другое
      // выглядит для человека как «книга не нашлась», поэтому пишем в журнал
      log.warn('lookup', 'google books отказал', {
        isbn: isbn13,
        status: res.status,
        keyed: Boolean(stored),
        body: (await res.text()).slice(0, 200),
      })
      return null
    }
    const draft = parseGoogleBooks(await res.json())
    return draft ? { source: 'google', draft } : null
  } catch (error) {
    log.warn('lookup', 'google books не ответил', {
      isbn: isbn13,
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return null
  }
}

/**
 * Поиск по названию и автору. Нужен, когда номер нашёлся в интернете, но
 * аннотации и обложки в сниппетах нет: у Google они есть почти всегда.
 *
 * Пробуем от строгого запроса к мягкому: полное название с подзаголовком в
 * intitle не находится, а inauthor капризен к порядку «Имя Фамилия» — поэтому
 * берём название до двоеточия и одно слово из автора, а последним заходом
 * ищем свободной строкой.
 */
export async function fetchGoogleByTitle(
  title: string,
  authors: string | null,
): Promise<MetadataDraft | null> {
  const short = title.split(/[:—]/)[0]?.trim() ?? title
  const surname =
    authors
      ?.split(/[,;]/)[0]
      ?.trim()
      .split(/\s+/)
      .sort((a, b) => b.length - a.length)[0] ?? ''
  const queries = [
    surname
      ? `intitle:${JSON.stringify(short.slice(0, 60))}+inauthor:${JSON.stringify(surname)}`
      : `intitle:${JSON.stringify(short.slice(0, 60))}`,
    `${JSON.stringify(short.slice(0, 60))} ${authors ?? ''} книга`.trim(),
  ]
  for (const query of queries) {
    const draft = await googleQuery(query)
    // без обложки и аннотации ответ бесполезен — ради них и ходим
    if (draft && (draft.coverUrl || draft.annotation)) return draft
  }
  return null
}

async function googleQuery(query: string): Promise<MetadataDraft | null> {
  try {
    const stored = await googleBooksKey()
    const key = stored ? `&key=${stored}` : ''
    let res: Response | null = null
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&country=RU${key}`,
        {
          headers: { referer: `${env.APP_URL}/` },
          signal: AbortSignal.timeout(TIMEOUT),
        },
      )
      if (res.ok || !RETRY_STATUS.has(res.status)) break
      if (attempt < ATTEMPTS)
        await new Promise((r) => setTimeout(r, attempt * 400))
    }
    if (!res?.ok) return null
    return parseGoogleBooks(await res.json())
  } catch {
    return null
  }
}
