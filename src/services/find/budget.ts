/**
 * Бюджет времени на всю цепочку поиска.
 *
 * Глубина задаётся одним числом, а не списком разрешённых источников: при
 * маленьком бюджете цепочка сама останавливается после бесплатных каталогов,
 * и никаких «профилей» и исключений заводить не нужно. Заодно это лечит
 * разнобой таймаутов (4 / 6 / 7 / 12 / 15 / 30 с), из-за которого один поиск
 * мог тянуться дольше минуты.
 */
export interface Deadline {
  /** Осталось миллисекунд; 0 — время вышло. */
  left: () => number
  expired: () => boolean
  /** Хватит ли остатка на ступень, которая может занять `needMs`. */
  enoughFor: (needMs: number) => boolean
  /** Сколько миллисекунд уже потрачено. */
  spent: () => number
}

export function deadline(budgetMs: number): Deadline {
  const started = performance.now()
  const spent = () => Math.round(performance.now() - started)
  const left = () => Math.max(0, budgetMs - spent())
  return {
    spent,
    left,
    expired: () => left() <= 0,
    // ступень с длинным таймаутом не начинаем, если она заведомо не успеет:
    // лучше честно сказать «не успели», чем оборвать её на середине
    enoughFor: (needMs) => left() >= needMs,
  }
}
