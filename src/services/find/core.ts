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

  for (const step of chain) {
    const key = step.adapter.key
    if (rejected.has(key)) {
      probes.push({
        key,
        outcome: 'выключен',
        detail: 'отвергнут человеком',
        ms: 0,
      })
      continue
    }
    if (!step.enabled) {
      probes.push({ key, outcome: 'выключен', detail: step.reason, ms: 0 })
      continue
    }
    // за платное не платим, если бесплатное уже дало годный ответ: цепочка
    // лесенкой — это её главный смысл, а не побочный эффект
    if (step.adapter.paid && findings.some((f) => !f.weak && f.draft.title)) {
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
      continue
    }
    if (!got.value || got.value.length === 0) {
      probes.push({ key, outcome: 'молчит', detail: null, ms: got.ms })
      trace.info('ступень промолчала', { step: key, ms: got.ms })
      continue
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
    // бесплатные каталоги опрашиваем целиком: их ответы дополняют друг друга.
    // платную ступень, которая уже дала название, повторять незачем
    if (step.adapter.paid && first.draft.title) {
      skippedByEarlyHit = true
      break
    }
  }

  const merged = mergeFindings(findings, order)
  const ctx: FindContext = {
    userId,
    isbn13,
    soFar: findings,
    trace,
    leftMs: () => budget.left(),
  }
  const enriched = await enrichDraft(ctx, chain, merged.draft, merged.covers)

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
