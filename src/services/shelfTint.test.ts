import { describe, expect, test } from 'bun:test'

import { SHELF_NEUTRAL, medianYear, shelfTint } from './shelfTint'

describe('medianYear', () => {
  test('нечётное количество — середина', () => {
    expect(medianYear([1990, 1960, 2020])).toBe(1990)
  })
  test('чётное — округлённое среднее двух середин', () => {
    expect(medianYear([1980, 1990, 2000, 2010])).toBe(1995)
  })
  test('null и мусор не участвуют', () => {
    expect(medianYear([null, undefined, 0, -5, 1987])).toBe(1987)
  })
  test('пусто — null', () => {
    expect(medianYear([])).toBeNull()
  })
})

describe('shelfTint', () => {
  test('без данных — нейтральная полка', () => {
    expect(shelfTint([]).color).toBe(SHELF_NEUTRAL)
  })
  test('старые книги — старый лак (кламп ниже 1960)', () => {
    expect(shelfTint([1930]).color).toBe('oklch(0.810 0.075 84.0)')
  })
  test('новые книги — свежая краска (кламп выше 2020)', () => {
    expect(shelfTint([2024, 2025]).color).toBe('oklch(0.955 0.005 100.0)')
  })
  test('середина шкалы — промежуточный тон', () => {
    const { color, medianYear: median } = shelfTint([1990])
    expect(median).toBe(1990)
    expect(color).toBe('oklch(0.883 0.040 92.0)')
  })
})
