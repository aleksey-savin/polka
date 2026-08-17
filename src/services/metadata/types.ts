/** Черновик карточки, собранный из внешнего источника метаданных. */
export interface MetadataDraft {
  title?: string
  authors?: string
  publisher?: string
  year?: number
  pages?: number
  annotation?: string
  seriesName?: string
  language?: string
  coverUrl?: string
  /** Из FantLab format_mm («145x215» → 215). */
  heightMm?: number
  /** Из FantLab cover_type («твёрдая»/«мягкая»). */
  coverType?: 'soft' | 'hard'
  /** Пары «имя — fantlabId» из BB-тегов [autor=…] поиска FantLab. */
  fantlabAuthors?: Array<{ name: string; id: number }>
  /** Идентификатор записи в источнике (edition_id / volumeId / OL key). */
  sourceRef?: string
  /** Произведения издания из FantLab content — для эталонного каталога. */
  fantlabWorks?: Array<{ id: number; title: string; author?: string }>
}

export type MetadataSource = 'manual' | 'fantlab' | 'google' | 'openlibrary'

export interface SourceResult {
  source: MetadataSource
  draft: MetadataDraft
}

export const SOURCE_LABEL: Record<MetadataSource, string> = {
  manual: 'проверено вручную',
  fantlab: 'FantLab',
  google: 'Google Books',
  openlibrary: 'Open Library',
}

/** Год из свободной строки даты («2014», «Jan 1, 1997», «2014-01-01»). */
export function yearFrom(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /(1[5-9]|20)\d{2}/.exec(value)
  return match ? Number(match[0]) : undefined
}

/** Снимает HTML-теги, сохраняя абзацы и переносы (рендер — pre-line). */
export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
