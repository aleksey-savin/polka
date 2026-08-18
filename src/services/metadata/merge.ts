import type { MetadataDraft, MetadataSource, SourceResult } from './types'

export interface MergedLookup {
  draft: MetadataDraft
  sources: Array<MetadataSource>
  coverCandidates: Array<string>
}

/**
 * Порядок по умолчанию — только для вызовов вне подсистемы поиска (M32).
 * Там приоритет полей задаётся порядком цепочки из настроек, а не константой.
 */
const DEFAULT_ORDER: Array<MetadataSource> = [
  'manual',
  'fantlab',
  'google',
  'openlibrary',
]
/** Аннотация обычно лучше у Google — эмпирика, проверенная на фикстурах. */
const DEFAULT_ANNOTATION_ORDER: Array<MetadataSource> = [
  'manual',
  'google',
  'fantlab',
  'openlibrary',
]

const BIB_FIELDS = [
  'title',
  'authors',
  'publisher',
  'year',
  'pages',
  'seriesName',
  'language',
  'heightMm',
  'coverType',
] as const

export function mergeResults(
  results: Array<SourceResult | null>,
  order: Array<MetadataSource> = DEFAULT_ORDER,
  annotationOrder: Array<MetadataSource> = DEFAULT_ANNOTATION_ORDER,
): MergedLookup {
  const bySource = new Map<MetadataSource, MetadataDraft>()
  for (const r of results) {
    if (r) bySource.set(r.source, r.draft)
  }

  const draft: MetadataDraft = {}
  for (const field of BIB_FIELDS) {
    for (const source of order) {
      const value = bySource.get(source)?.[field]
      if (value !== undefined && value !== '') {
        draft[field] = value as never
        break
      }
    }
  }
  for (const source of annotationOrder) {
    const annotation = bySource.get(source)?.annotation
    if (annotation) {
      draft.annotation = annotation
      break
    }
  }

  const flAuthors = bySource.get('fantlab')?.fantlabAuthors
  if (flAuthors && flAuthors.length > 0) draft.fantlabAuthors = flAuthors

  const coverCandidates = order
    .map((s) => bySource.get(s)?.coverUrl)
    .filter((u): u is string => Boolean(u))
  if (coverCandidates.length > 0) draft.coverUrl = coverCandidates[0]

  return {
    draft,
    sources: order.filter((s) => bySource.has(s)),
    coverCandidates,
  }
}
