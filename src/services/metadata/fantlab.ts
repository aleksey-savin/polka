/**
 * FantLab (api.fantlab.ru) — лучший источник по русской фантастике.
 * API v0.9 «test mode»: без SLA, поля с BB-разметкой — парсим оборонительно.
 */
import { normalizeIsbnInput } from '@/services/isbn'
import { stripHtml } from './types'
import type { MetadataDraft, SourceResult } from './types'

const BASE = 'https://api.fantlab.ru'
const TIMEOUT = 4000

/** Снимает BB-теги вида [autor=52]…[/autor]. */
export function stripBb(value: string): string {
  return value.replace(/\[[^\]]*\]/g, '').trim()
}

interface SearchMatch {
  edition_id?: number
  name?: string
  autors?: string
  publisher?: string
  series?: string
  year?: number
  isbn?: string
}

/** Разбор ответа /search-editions: подходящий match + черновик. */
export function parseFantlabSearch(
  json: unknown,
  isbn13: string,
): { editionId: number | null; draft: MetadataDraft } | null {
  const matches = (json as { matches?: Array<SearchMatch> } | null)?.matches
  if (!Array.isArray(matches) || matches.length === 0) return null
  const exact = matches.find(
    (m) => typeof m.isbn === 'string' && normalizeIsbnInput(m.isbn) === isbn13,
  )
  const match = exact ?? matches[0]
  if (!match) return null
  const draft: MetadataDraft = {}
  if (match.name) draft.title = stripBb(match.name)
  if (match.autors) draft.authors = stripBb(match.autors)
  if (match.publisher) draft.publisher = stripBb(match.publisher)
  if (match.series) draft.seriesName = stripBb(match.series)
  if (typeof match.year === 'number') draft.year = match.year
  return {
    editionId: typeof match.edition_id === 'number' ? match.edition_id : null,
    draft,
  }
}

/** Разбор ответа /edition/{id}: страницы, аннотация, обложка. */
export function parseFantlabEdition(json: unknown): Partial<MetadataDraft> {
  const e = json as {
    pages?: number
    description?: string
    image?: string
    edition_name?: string
  } | null
  if (!e || typeof e !== 'object') return {}
  const extra: Partial<MetadataDraft> = {}
  if (typeof e.pages === 'number' && e.pages > 0) extra.pages = e.pages
  if (typeof e.description === 'string' && e.description.trim()) {
    extra.annotation = stripHtml(e.description)
  }
  if (typeof e.image === 'string' && e.image.startsWith('/')) {
    extra.coverUrl = `https://fantlab.ru${e.image}`
  }
  return extra
}

export async function fetchFantlab(
  isbn13: string,
): Promise<SourceResult | null> {
  try {
    const searchRes = await fetch(`${BASE}/search-editions?q=${isbn13}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!searchRes.ok) return null
    const parsed = parseFantlabSearch(await searchRes.json(), isbn13)
    if (!parsed) return null

    let extra: Partial<MetadataDraft> = {}
    if (parsed.editionId !== null) {
      try {
        const editionRes = await fetch(`${BASE}/edition/${parsed.editionId}`, {
          signal: AbortSignal.timeout(TIMEOUT),
        })
        if (editionRes.ok) extra = parseFantlabEdition(await editionRes.json())
      } catch {
        // деталка — best-effort
      }
    }
    return {
      source: 'fantlab',
      draft: { ...parsed.draft, ...extra, language: 'ru' },
    }
  } catch {
    return null
  }
}
