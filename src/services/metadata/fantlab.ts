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

/**
 * Разбор ответа /edition/{id}/extended: страницы, обложка и id произведения.
 * ВАЖНО: поле `description` издания — примечания («Внецикловый роман»,
 * иллюстратор…), НЕ аннотация; настоящая аннотация — у произведения (/work).
 */
export function parseFantlabEdition(json: unknown): {
  extra: Partial<MetadataDraft>
  workId: number | null
} {
  const e = json as {
    pages?: number
    image?: string
    edition_work_id?: number | null
    content?: Array<string> | null
    format_mm?: string
    cover_type?: string
  } | null
  if (!e || typeof e !== 'object') return { extra: {}, workId: null }
  const extra: Partial<MetadataDraft> = {}
  if (typeof e.pages === 'number' && e.pages > 0) extra.pages = e.pages
  // физика издания: «145x215» → высота 215 мм; тип переплёта
  if (typeof e.format_mm === 'string') {
    const h = Number(e.format_mm.split(/[xх×]/i)[1])
    if (Number.isFinite(h) && h >= 60 && h <= 500)
      extra.heightMm = Math.round(h)
  }
  if (typeof e.cover_type === 'string') {
    const ct = e.cover_type.toLowerCase()
    if (ct.includes('твёрд') || ct.includes('тверд')) extra.coverType = 'hard'
    else if (ct.includes('мягк') || ct.includes('интеграл'))
      extra.coverType = 'soft'
  }
  if (typeof e.image === 'string' && e.image.startsWith('/')) {
    extra.coverUrl = `https://fantlab.ru${e.image}`
  }

  let workId: number | null =
    typeof e.edition_work_id === 'number' ? e.edition_work_id : null
  if (workId === null && Array.isArray(e.content)) {
    // В content ссылки вида <a href="/work569">; аннотацию берём только
    // если произведение в издании ровно одно (иначе это сборник).
    const ids = new Set<string>()
    for (const line of e.content) {
      if (typeof line !== 'string') continue
      for (const match of line.matchAll(/\/work(\d+)/g)) {
        if (match[1]) ids.add(match[1])
      }
    }
    if (ids.size === 1) workId = Number([...ids][0])
  }
  return { extra, workId }
}

/** Разбор ответа /work/{id}: настоящая аннотация произведения. */
export function parseFantlabWork(json: unknown): Partial<MetadataDraft> {
  const w = json as { work_description?: string } | null
  if (
    !w ||
    typeof w.work_description !== 'string' ||
    !w.work_description.trim()
  )
    return {}
  return { annotation: stripHtml(w.work_description) }
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
        const editionRes = await fetch(
          `${BASE}/edition/${parsed.editionId}/extended`,
          { signal: AbortSignal.timeout(TIMEOUT) },
        )
        if (editionRes.ok) {
          const edition = parseFantlabEdition(await editionRes.json())
          extra = edition.extra
          if (edition.workId !== null) {
            try {
              const workRes = await fetch(`${BASE}/work/${edition.workId}`, {
                signal: AbortSignal.timeout(TIMEOUT),
              })
              if (workRes.ok) {
                extra = { ...extra, ...parseFantlabWork(await workRes.json()) }
              }
            } catch {
              // аннотация — best-effort
            }
          }
        }
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
