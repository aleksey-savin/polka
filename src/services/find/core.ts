import { AppError } from '@/services/errors'
import { parseIsbn } from '@/services/isbn'
import { deadline } from './budget'
import { chainFingerprint, readCache, writeCache } from './cache'
import { resolveChain } from './chain'
import { enrichDraft } from './enrich'
import { mergeFindings } from './merge'
import { safely } from './safely'
import { startTrace } from './trace'
import { FULL_BUDGET_MS } from './types'
import type {
  Finding,
  FindContext,
  FindOptions,
  FindResult,
  SourceProbe,
} from './types'

/**
 * Единая точка поиска издания по номеру (M32).
 *
 * Одна функция на все входы: добавление по ISBN, «Не распознано», карточка
 * книги, фоновая доигровка. Вариаций нет — есть параметры: бюджет времени,
 * список отвергнутых ступеней и признак «забыть кэш».
 *
 * Каждая ступень обёрнута `safely`: её отказ становится строкой отчёта, а не
 * падением. Бюджет решает, докуда дойти: не хватило времени на платную
 * ступень — цепочка честно помечается `truncated`, и доигрывает её воркер.
 */
export async function findEdition(
  userId: string,
  rawIsbn: string,
  options: FindOptions = {},
): Promise<FindResult> {
  const parsed = parseIsbn(rawIsbn)
  if (!parsed) {
    throw new AppError(
      'Это не похоже на ISBN — проверьте цифры или заполните карточку вручную',
    )
  }
  const { isbn13, isbn10 } = parsed
  const trace = startTrace(isbn13, userId)
  const budget = deadline(options.budgetMs ?? FULL_BUDGET_MS)
  const rejected = new Set(options.rejected ?? [])

  const chain = await resolveChain(userId, options.adapters)
  const order = chain.map((step) => step.adapter.key)
  const fingerprint = chainFingerprint(order)
  trace.info('поиск начат', {
    chain: order.join('>'),
    budgetMs: options.budgetMs ?? FULL_BUDGET_MS,
    force: Boolean(options.force),
  })

  if (!options.force && rejected.size === 0) {
    const hit = await safely('чтение кэша', trace, () =>
      readCache(isbn13, fingerprint),
    )
    if (hit.value) {
      trace.info('отдано из кэша', { ms: trace.ms() })
      return hit.value
    }
  }

  const probes: Array<SourceProbe> = []
  const findings: Array<Finding> = []
  let truncated = false
  /** Ступень пропущена только потому, что книга нашлась раньше нужного. */
  let skippedByEarlyHit = false

  /** Причина, по которой ступень не спрашивали; null — спрашиваем. */
  const skipReason = (step: (typeof chain)[number]): SourceProbe | null => {
    const key = step.adapter.key
    if (rejected.has(key)) {
      return { key, outcome: 'выключен', detail: 'отвергнут человеком', ms: 0 }
    }
    if (!step.enabled) {
      return { key, outcome: 'выключен', detail: step.reason, ms: 0 }
    }
    return null
  }

  /** Спросить ступень и записать, чем это кончилось. */
  const ask = async (step: (typeof chain)[number]): Promise<void> => {
    const key = step.adapter.key
    const ctx: FindContext = {
      userId,
      isbn13,
      soFar: findings,
      trace,
      leftMs: () => budget.left(),
    }
    const got = await safely(
      `ступень ${key}`,
      trace,
      () => step.adapter.probe(ctx),
      step.adapter.timeoutMs,
    )
    if (got.failure) {
      probes.push({ key, outcome: 'ошибка', detail: got.failure, ms: got.ms })
      return
    }
    if (!got.value || got.value.length === 0) {
      probes.push({ key, outcome: 'молчит', detail: null, ms: got.ms })
      trace.info('ступень промолчала', { step: key, ms: got.ms })
      return
    }
    findings.push(...got.value)
    const first = got.value[0]!
    probes.push({
      key,
      outcome: 'нашёл',
      // у веб-ступени вариантов может быть несколько — говорим сколько
      detail:
        got.value.length > 1
          ? `${got.value.length} варианта`
          : (first.proof?.url ?? null),
      ms: got.ms,
    })
    trace.info('ступень ответила', {
      step: key,
      title: first.draft.title,
      variants: got.value.length,
      ms: got.ms,
    })
  }

  // ── Бесплатные ступени — разом ──
  //
  // Они не мешают друг другу и дополняют ответы: спрашивать их по очереди
  // значит складывать таймауты (3 + 5 + 4 с там, где хватает 6). Так же
  // делал прежний `lookupIsbn` через Promise.allSettled.
  const free = chain.filter((step) => !step.adapter.paid)
  const freeToAsk: typeof chain = []
  for (const step of free) {
    const skip = skipReason(step)
    if (skip) {
      probes.push(skip)
      continue
    }
    freeToAsk.push(step)
  }
  if (freeToAsk.length > 0) {
    const needMs = Math.max(...freeToAsk.map((s) => s.adapter.timeoutMs))
    if (budget.enoughFor(needMs)) {
      await Promise.all(freeToAsk.map((step) => ask(step)))
    } else {
      truncated = true
      for (const step of freeToAsk) {
        probes.push({
          key: step.adapter.key,
          outcome: 'не успели',
          detail: `осталось ${budget.left()} мс`,
          ms: 0,
        })
      }
      trace.info('каталоги отложены: не хватает бюджета', {
        leftMs: budget.left(),
        needMs,
      })
    }
  }

  // ── Платные ступени — по очереди ──
  //
  // Лесенка: за платное не платим, если бесплатное уже дало годный ответ.
  // Это главный смысл порядка, а не побочный эффект.
  for (const step of chain.filter((s) => s.adapter.paid)) {
    const key = step.adapter.key
    const skip = skipReason(step)
    if (skip) {
      probes.push(skip)
      continue
    }
    if (findings.some((f) => !f.weak && f.draft.title)) {
      skippedByEarlyHit = true
      probes.push({
        key,
        outcome: 'молчит',
        detail: 'не понадобился: книга нашлась раньше',
        ms: 0,
      })
      continue
    }
    if (!budget.enoughFor(step.adapter.timeoutMs)) {
      truncated = true
      probes.push({
        key,
        outcome: 'не успели',
        detail: `осталось ${budget.left()} мс`,
        ms: 0,
      })
      trace.info('ступень отложена: не хватает бюджета', {
        step: key,
        leftMs: budget.left(),
      })
      continue
    }
    await ask(step)
    // платную ступень, которая уже дала название, повторять незачем
    if (findings.some((f) => f.key === key && f.draft.title)) {
      skippedByEarlyHit = true
      break
    }
  }

  // отчёт и находки выстраиваем по цепочке: параллельный опрос не должен
  // менять порядок на экране
  probes.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  findings.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))

  const merged = mergeFindings(findings, order)
  const ctx: FindContext = {
    userId,
    isbn13,
    soFar: findings,
    trace,
    leftMs: () => budget.left(),
  }
  const enriched = await enrichDraft(ctx, chain, merged.draft, merged.covers)

  // ── Пополнение общего эталона ──
  //
  // Ради него и заведён M14: второй раз ту же книгу находим мгновенно и без
  // сети. Пишем только находки каталогов и только неслабые: транслит
  // («Deti-bilingvy») осел бы в общем эталоне и портил бы выдачу всем, потому
  // что эталон стоит в цепочке первым.
  const CATALOGS = new Set(['fantlab', 'google', 'openlibrary'])
  const worthKeeping = findings.filter(
    (f) => CATALOGS.has(f.key) && !f.weak && f.draft.title,
  )
  if (worthKeeping.length > 0) {
    const kept = await safely('пополнение эталона', trace, async () => {
      const { persistLookup } = await import('@/services/reference')
      await persistLookup(
        isbn13,
        isbn10,
        worthKeeping.map((f) => ({
          source: f.key as 'fantlab' | 'google' | 'openlibrary',
          draft: f.draft,
        })),
      )
      return worthKeeping.length
    })
    if (kept.value) {
      trace.info('эталон пополнен', {
        sources: worthKeeping.map((f) => f.key).join(','),
      })
    }
  }

  const confirmed = findings.find((f) => f.refBookId)
  const proven = findings.find((f) => f.proof)
  const result: FindResult = {
    isbn13,
    isbn10,
    draft: enriched.draft,
    found: findings.map((f) => f.key),
    probes,
    findings,
    proof: proven?.proof ?? null,
    refBookId: confirmed?.refBookId ?? null,
    workId: confirmed?.workId ?? null,
    covers: enriched.covers,
    cached: false,
    truncated,
    // идти больше некуда: цепочка прошла до конца и ни одна ступень не
    // отложена — ни по бюджету, ни потому что книга нашлась раньше
    exhausted: !truncated && !skippedByEarlyHit,
  }

  const written = await safely('запись кэша', trace, () =>
    writeCache(isbn13, fingerprint, result),
  )
  // кэш — не best-effort молчком: если он не пишется, поиск будет ходить
  // в платные источники по кругу, и об этом надо знать
  if (written.failure) {
    trace.error('кэш не записался', { failure: written.failure })
  }

  trace.info('поиск закончен', {
    found: result.found.join(',') || 'ничего',
    truncated,
    ms: trace.ms(),
  })
  return result
}
