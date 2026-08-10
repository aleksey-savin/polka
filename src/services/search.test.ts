import { describe, expect, test } from 'bun:test'

import { normalizeForSearch } from './search'

describe('normalizeForSearch', () => {
  test('сворачивает регистр кириллицы', () => {
    expect(normalizeForSearch('Стругацкие')).toBe('стругацкие')
    expect(normalizeForSearch('ПИКНИК НА ОБОЧИНЕ')).toBe('пикник на обочине')
  })

  test('приводит ё к е', () => {
    expect(normalizeForSearch('Алёша Пешков')).toBe('алеша пешков')
  })

  test('схлопывает пробелы и обрезает края', () => {
    expect(normalizeForSearch('  Мастер   и \n Маргарита ')).toBe(
      'мастер и маргарита',
    )
  })
})
