import { describe, expect, test } from 'bun:test'

import { spineFor } from './spine'

describe('spineFor', () => {
  test('детерминирован по названию', () => {
    const a = spineFor('Пикник на обочине', 384)
    const b = spineFor('Пикник на обочине', 384)
    expect(a).toEqual(b)
  })
  test('ширина растёт с толщиной книги', () => {
    expect(spineFor('X', 100).width).toBe(22)
    expect(spineFor('X', 200).width).toBe(28)
    expect(spineFor('X', 300).width).toBe(34)
    expect(spineFor('X', 400).width).toBe(42)
    expect(spineFor('X', 900).width).toBe(52)
  })
  test('без страниц — средняя ширина', () => {
    expect(spineFor('X', null).width).toBe(34)
  })
})
