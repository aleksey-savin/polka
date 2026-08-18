import { log } from '@/lib/logger'

/**
 * Журнал одного поиска.
 *
 * У всей подсистемы один scope — `find`, и общий короткий id: несколько
 * поисков идут параллельно, и без него строки в журнале не разделить.
 * Уровни: info — ход дела, warn — ступень не справилась (поиск продолжается),
 * error — сломалось то, что ломаться не должно.
 */
export interface Trace {
  id: string
  info: (message: string, fields?: Record<string, unknown>) => void
  warn: (message: string, fields?: Record<string, unknown>) => void
  error: (message: string, fields?: Record<string, unknown>) => void
  /** Сколько миллисекунд идёт этот поиск. */
  ms: () => number
}

export function startTrace(isbn13: string, userId: string): Trace {
  const id = Math.random().toString(36).slice(2, 8)
  const started = performance.now()
  const base = { find: id, isbn: isbn13, user: userId }
  const ms = () => Math.round(performance.now() - started)
  return {
    id,
    ms,
    info: (message, fields) =>
      log.info('find', message, { ...base, ...fields }),
    warn: (message, fields) =>
      log.warn('find', message, { ...base, ...fields }),
    error: (message, fields) =>
      log.error('find', message, { ...base, ...fields }),
  }
}
