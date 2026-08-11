import { describe, expect, test } from 'bun:test'

import { spineFor } from './spine'

describe('spineFor', () => {
  test('детерминирован по названию', () => {
    const a = spineFor('Пикник на обочине', 384)
    const b = spineFor('Пикник на обочине', 384)
    expect(a).toEqual(b)
  })
  test('толщина растёт со страницами непрерывно', () => {
    expect(spineFor('X', 100).width).toBe(21)
    expect(spineFor('X', 300).width).toBe(35)
    expect(spineFor('X', 640).width).toBe(56) // Довлатов, кламп сверху
    expect(spineFor('X', 40).width).toBe(18) // кламп снизу
  })
  test('без страниц — средняя толщина', () => {
    expect(spineFor('X', null).width).toBe(35)
  })
  test('высота из мм: ×0.62 с клампом', () => {
    expect(spineFor('X', 300, { heightMm: 215 }).height).toBe(133)
    expect(spineFor('X', 300, { heightMm: 165 }).height).toBe(102)
    expect(spineFor('X', 300, { heightMm: 500 }).height).toBe(168)
  })
  test('без мм — фолбэк по переплёту', () => {
    expect(spineFor('X', 300, { coverType: 'soft' }).height).toBe(118)
    expect(spineFor('X', 300, { coverType: 'hard' }).height).toBe(138)
    expect(spineFor('X', 300, { coverType: 'gift' }).height).toBe(152)
  })
  test('совсем без данных — детерминированная вариация', () => {
    const h = spineFor('Пикник на обочине', 384).height
    expect([124, 132, 138, 148]).toContain(h)
  })
})
