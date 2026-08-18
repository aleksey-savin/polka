import type { MetadataDraft } from '@/services/metadata/types'
import type { Finding, SourceKey } from './types'

/**
 * Слияние находок пофилдово (M32).
 *
 * Приоритет полей — это порядок цепочки из настроек, а не зашитая константа.
 * Раньше приоритет лежал в трёх местах (`BIB_ORDER` и `ANNOTATION_ORDER` в
 * metadata/merge.ts, `SOURCE_PRIORITY` в reference.ts) и настройкам не
 * подчинялся: список в «Источниках» создавал иллюзию управления — поднимаешь
 * Google над FantLab, а название всё равно приходит из FantLab.
 *
 * Слабые находки (транслит вместо русского названия) уступают любым нормальным,
 * как бы высоко ни стоял их источник, — но берутся, если больше нечего взять.
 */

const FIELDS = [
  'title',
  'authors',
  'publisher',
  'year',
  'pages',
  'annotation',
  'seriesName',
  'language',
  'heightMm',
  'coverType',
  'sourceRef',
  'fantlabAuthors',
  'fantlabWorks',
] as const

export function mergeFindings(
  findings: Array<Finding>,
  order: Array<SourceKey>,
): { draft: MetadataDraft; covers: Array<string> } {
  // сначала нормальные находки по порядку, затем слабые — тем же порядком
  const ranked = [
    ...order.filter((k) => findings.some((f) => f.key === k && !f.weak)),
    ...order.filter((k) => findings.some((f) => f.key === k && f.weak)),
  ]
  // у ступени может быть несколько находок — в слитый черновик идёт первая
  const byKey = new Map<SourceKey, MetadataDraft>()
  for (const key of ranked) {
    const found = findings.find((f) => f.key === key)
    if (found) byKey.set(key, found.draft)
  }

  const draft: MetadataDraft = {}
  for (const field of FIELDS) {
    for (const key of ranked) {
      const value = byKey.get(key)?.[field]
      if (value !== undefined && value !== '') {
        draft[field] = value as never
        break
      }
    }
  }

  const covers: Array<string> = []
  for (const key of ranked) {
    const found = findings.find((f) => f.key === key)
    for (const url of found?.covers ?? []) {
      if (!covers.includes(url)) covers.push(url)
    }
  }
  if (covers[0]) draft.coverUrl = covers[0]
  return { draft, covers }
}
