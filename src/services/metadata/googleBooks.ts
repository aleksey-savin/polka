/**
 * Google Books. Без ключа общая анонимная квота часто исчерпана (проверено),
 * поэтому GOOGLE_BOOKS_API_KEY в проде фактически обязателен.
 */
import { env } from '@/lib/env'
import { yearFrom } from './types'
import type { MetadataDraft, SourceResult } from './types'

const TIMEOUT = 4000

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
    json as { items?: Array<{ volumeInfo?: GbVolumeInfo }> } | null
  )?.items
  const info = items?.[0]?.volumeInfo
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
    const key = env.GOOGLE_BOOKS_API_KEY
      ? `&key=${env.GOOGLE_BOOKS_API_KEY}`
      : ''
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}&country=RU${key}`,
      { signal: AbortSignal.timeout(TIMEOUT) },
    )
    if (!res.ok) return null
    const draft = parseGoogleBooks(await res.json())
    return draft ? { source: 'google', draft } : null
  } catch {
    return null
  }
}
