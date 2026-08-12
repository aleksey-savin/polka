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
  if (match.autors) {
    draft.authors = stripBb(match.autors)
    // пары «имя — id» из [autor=14093]Сергей Довлатов[/autor]
    const pairs = [
      ...match.autors.matchAll(/\[autor=(\d+)\]([^[]+)\[\/autor\]/g),
    ]
      .map((m) => ({ id: Number(m[1]), name: (m[2] ?? '').trim() }))
      .filter((a) => a.name && Number.isFinite(a.id))
    if (pairs.length > 0) draft.fantlabAuthors = pairs
  }
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
/** Типы содержимого, не являющиеся произведениями для библиографии. */
const NON_WORK_TYPES =
  /стать|предислов|послеслов|коммент|интервью|примечан|указател/i

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
  if (Array.isArray(e.content)) {
    // Строки вида « Автор. <a href="/work569">Название</a> (повесть), стр…» —
    // собираем произведения для эталонного каталога (без статей/предисловий).
    const works: Array<{ id: number; title: string; author?: string }> = []
    for (const line of e.content) {
      if (typeof line !== 'string') continue
      const m = /<a href="\/work(\d+)">([^<]+)<\/a>\s*(\(([^)]*)\))?/.exec(line)
      if (!m || !m[1] || !m[2]) continue
      if (m[4] && NON_WORK_TYPES.test(m[4])) continue
      const author = line.split('<a')[0]?.trim().replace(/\.$/, '') || undefined
      works.push({ id: Number(m[1]), title: m[2].trim(), author })
    }
    if (works.length > 0) extra.fantlabWorks = works
    // аннотацию произведения берём только когда оно в издании ровно одно
    if (workId === null && works.length === 1 && works[0]) {
      workId = works[0].id
    }
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
      parsed.draft.sourceRef = String(parsed.editionId)
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
