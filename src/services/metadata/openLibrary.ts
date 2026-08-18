/** Open Library: вежливый User-Agent, ≤3 rps; русское покрытие слабое, но старые издания находит. */
import { POLKA_USER_AGENT } from '@/services/userAgent'
import { yearFrom } from './types'
import type { MetadataDraft, SourceResult } from './types'

// из российских сетей openlibrary.org отвечает через раз: ждём недолго,
// FantLab и Google важнее для наших книг
const TIMEOUT = 4000
const HEADERS = { 'User-Agent': POLKA_USER_AGENT }

interface OlBook {
  title?: string
  publishers?: Array<string>
  publish_date?: string
  number_of_pages?: number
  covers?: Array<number>
  authors?: Array<{ key?: string }>
}

export function parseOpenLibraryBook(json: unknown): {
  draft: MetadataDraft
  authorKeys: Array<string>
} | null {
  const b = json as OlBook | null
  if (!b || typeof b !== 'object' || !b.title) return null
  const draft: MetadataDraft = { title: b.title }
  if (b.publishers?.[0]) draft.publisher = b.publishers[0]
  const year = yearFrom(b.publish_date)
  if (year) draft.year = year
  if (typeof b.number_of_pages === 'number') draft.pages = b.number_of_pages
  if (b.covers?.[0])
    draft.coverUrl = `https://covers.openlibrary.org/b/id/${b.covers[0]}-L.jpg`
  const authorKeys = (b.authors ?? [])
    .map((a) => a.key)
    .filter((k): k is string => typeof k === 'string')
    .slice(0, 3)
  return { draft, authorKeys }
}

export async function fetchOpenLibrary(
  isbn13: string,
): Promise<SourceResult | null> {
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${isbn13}.json`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const parsed = parseOpenLibraryBook(await res.json())
    if (!parsed) return null

    const names: Array<string> = []
    for (const key of parsed.authorKeys) {
      try {
        const authorRes = await fetch(`https://openlibrary.org${key}.json`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(TIMEOUT),
        })
        if (authorRes.ok) {
          const name = ((await authorRes.json()) as { name?: string }).name
          if (name) names.push(name)
        }
      } catch {
        // имя автора — best-effort
      }
    }
    if (names.length > 0) parsed.draft.authors = names.join('; ')
    return { source: 'openlibrary', draft: parsed.draft }
  } catch {
    return null
  }
}
