/**
 * «Живые полки»: цвет доски — интерполяция по медианному году изданий
 * стоящих на ней книг. Конечные точки и нейтраль — docs/ux-ui-guideline.md.
 */
const OLD = { l: 0.81, c: 0.075, h: 84 } // старый лак #DDBE8A, медиана ≤ 1960
const FRESH = { l: 0.955, c: 0.005, h: 100 } // свежая краска #F2F1EC, медиана ≥ 2020
const YEAR_OLD = 1960
const YEAR_FRESH = 2020

export const SHELF_NEUTRAL = 'oklch(0.936 0.008 95)'

export function medianYear(
  years: Array<number | null | undefined>,
): number | null {
  const valid = years
    .filter(
      (y): y is number => typeof y === 'number' && Number.isFinite(y) && y > 0,
    )
    .sort((a, b) => a - b)
  if (valid.length === 0) return null
  const at = (i: number): number => valid[i] ?? 0 // длина проверена — fallback не срабатывает
  const mid = Math.floor(valid.length / 2)
  return valid.length % 2 === 1
    ? at(mid)
    : Math.round((at(mid - 1) + at(mid)) / 2)
}

export interface ShelfTint {
  color: string
  medianYear: number | null
}

export function shelfTint(years: Array<number | null | undefined>): ShelfTint {
  const median = medianYear(years)
  if (median === null) return { color: SHELF_NEUTRAL, medianYear: null }
  const t = Math.min(
    1,
    Math.max(0, (median - YEAR_OLD) / (YEAR_FRESH - YEAR_OLD)),
  )
  const lerp = (a: number, b: number) => a + (b - a) * t
  const l = lerp(OLD.l, FRESH.l).toFixed(3)
  const c = lerp(OLD.c, FRESH.c).toFixed(3)
  const h = lerp(OLD.h, FRESH.h).toFixed(1)
  return { color: `oklch(${l} ${c} ${h})`, medianYear: median }
}
