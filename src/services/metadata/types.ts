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
}

export type MetadataSource = 'fantlab' | 'google' | 'openlibrary'

export interface SourceResult {
  source: MetadataSource
  draft: MetadataDraft
}

export const SOURCE_LABEL: Record<MetadataSource, string> = {
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

/** Снимает HTML-теги из аннотаций внешних источников. */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+\n/g, '\n')
    .trim()
}
