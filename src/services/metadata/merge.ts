import type { MetadataDraft, MetadataSource, SourceResult } from './types'

export interface MergedLookup {
  draft: MetadataDraft
  sources: Array<MetadataSource>
  coverCandidates: Array<string>
}

/** Приоритет библиографических полей: FantLab → Google → Open Library. */
const BIB_ORDER: Array<MetadataSource> = ['fantlab', 'google', 'openlibrary']
/** Аннотация обычно лучше у Google. */
const ANNOTATION_ORDER: Array<MetadataSource> = [
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
): MergedLookup {
  const bySource = new Map<MetadataSource, MetadataDraft>()
  for (const r of results) {
    if (r) bySource.set(r.source, r.draft)
  }

  const draft: MetadataDraft = {}
  for (const field of BIB_FIELDS) {
    for (const source of BIB_ORDER) {
      const value = bySource.get(source)?.[field]
      if (value !== undefined && value !== '') {
        draft[field] = value as never
        break
      }
    }
  }
  for (const source of ANNOTATION_ORDER) {
    const annotation = bySource.get(source)?.annotation
    if (annotation) {
      draft.annotation = annotation
      break
    }
  }

  const flAuthors = bySource.get('fantlab')?.fantlabAuthors
  if (flAuthors && flAuthors.length > 0) draft.fantlabAuthors = flAuthors

  const coverCandidates = BIB_ORDER.map(
    (s) => bySource.get(s)?.coverUrl,
  ).filter((u): u is string => Boolean(u))
  if (coverCandidates.length > 0) draft.coverUrl = coverCandidates[0]

  return {
    draft,
    sources: BIB_ORDER.filter((s) => bySource.has(s)),
    coverCandidates,
  }
}
