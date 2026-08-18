import type { Trace } from './trace'

/**
 * «Поймать всё и записать».
 *
 * Правило подсистемы: ни одна ступень не имеет права уронить поиск. Раньше
 * `recognizeIsbn` падал целиком, если модель отвечала 401 или каталог бросал
 * ошибку, — хотя предыдущие ступени уже что-то нашли. Здесь любой отказ
 * становится «источник промолчал», и в журнале остаётся warn с причиной.
 *
 * Глухих `catch {}` в подсистеме быть не должно: причина всегда записывается.
 */
export interface SafeResult<T> {
  value: T | null
  /** Текст отказа для отчёта человеку; null — всё прошло. */
  failure: string | null
  ms: number
}

export async function safely<T>(
  what: string,
  trace: Trace,
  run: () => Promise<T>,
  timeoutMs?: number,
): Promise<SafeResult<T>> {
  const started = performance.now()
  const ms = () => Math.round(performance.now() - started)
  try {
    const value =
      timeoutMs === undefined
        ? await run()
        : await withTimeout(run(), timeoutMs)
    return { value, failure: null, ms: ms() }
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error)
    trace.warn(`${what}: не справился`, { failure, ms: ms() })
    return { value: null, failure, ms: ms() }
  }
}

/** Свой таймаут поверх ступени: у чужих клиентов он бывает щедрее нашего. */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`не уложился в ${timeoutMs} мс`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
