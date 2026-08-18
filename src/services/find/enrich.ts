import { safely } from './safely'
import type { MetadataDraft } from '@/services/metadata/types'
import type { ChainStep } from './chain'
import type { FindContext } from './types'

/**
 * Добор недостающего: обложка, аннотация, объём.
 *
 * Идёт по той же цепочке и тем же настройкам, что и сам поиск. Раньше добор
 * жил отдельной жизнью — `enrichMissing` ходил в Google и Яндекс Картинки
 * всегда, невзирая на настройки, а Картинки к тому же мимо суточного лимита.
 */
export async function enrichDraft(
  ctx: FindContext,
  chain: Array<ChainStep>,
  draft: MetadataDraft,
  covers: Array<string>,
): Promise<{ draft: MetadataDraft; covers: Array<string> }> {
  if (!draft.title) return { draft, covers }
  const filled = { ...draft }
  const all = [...covers]

  for (const step of chain) {
    if (filled.annotation && filled.pages && all.length >= 3) break
    if (!step.enabled || !step.adapter.enrich) continue
    if (ctx.leftMs() < step.adapter.timeoutMs) {
      ctx.trace.info('добор пропущен: не хватает времени', {
        step: step.adapter.key,
      })
      continue
    }

    const enrich = step.adapter.enrich
    const got = await safely(
      `добор ${step.adapter.key}`,
      ctx.trace,
      () => enrich(ctx, filled),
      step.adapter.timeoutMs,
    )
    if (!got.value) continue
    filled.annotation = filled.annotation ?? got.value.draft.annotation
    filled.pages = filled.pages ?? got.value.draft.pages
    for (const url of got.value.covers) {
      if (url.startsWith('http') && !all.includes(url)) all.push(url)
    }
    ctx.trace.info('добор', {
      step: step.adapter.key,
      covers: got.value.covers.length,
      annotation: Boolean(got.value.draft.annotation),
    })
  }

  if (all[0]) filled.coverUrl = all[0]
  return { draft: filled, covers: all.slice(0, 5) }
}
