import { sourceStates } from '@/services/bookSources'
import { ADAPTERS } from './adapters'
import type { SourceAdapter, SourceKey } from './types'

/**
 * Состав и порядок цепочки поиска (M32).
 *
 * Единственное место, где решается «спрашивать ли этот источник». Раньше
 * решение было размазано: `lookupIsbn` смотрел настройки, `enrichMissing` и
 * `proposeForBook` ходили в Google всегда, `searchByTitle` — в FantLab всегда,
 * Яндекс Картинки дёргались мимо суточного лимита.
 *
 * `userId` в сигнатуре — на будущее: если платные ступени когда-нибудь станут
 * доступны не всем, отказ добавится здесь, а не в самой цепочке.
 */
export interface ChainStep {
  adapter: SourceAdapter
  /** Спрашивать ли. Выключенные остаются в списке ради честного отчёта. */
  enabled: boolean
  /** Почему не спрашиваем: показывается человеку и пишется в журнал. */
  reason: string | null
}

export async function resolveChain(
  _userId: string,
  registry: Partial<Record<SourceKey, SourceAdapter>> = ADAPTERS,
): Promise<Array<ChainStep>> {
  const states = await sourceStates()
  const steps: Array<ChainStep> = []

  for (const state of states) {
    const adapter = registry[state.key]
    // ключ есть в базе, а адаптера нет — источник выведен из строя кодом
    if (!adapter) continue

    // эталон закреплён первым и не выключается: бесплатный, мгновенный и свой
    if (state.key === 'reference') {
      steps.push({ adapter, enabled: true, reason: null })
      continue
    }
    if (!state.enabled) {
      steps.push({
        adapter,
        enabled: false,
        reason: 'выключен в настройках источников',
      })
      continue
    }
    steps.push({ adapter, enabled: true, reason: null })
  }

  // эталон всегда первый, как бы ни переставили список
  steps.sort((a, b) =>
    a.adapter.key === 'reference' ? -1 : b.adapter.key === 'reference' ? 1 : 0,
  )
  return steps
}
