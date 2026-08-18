import { describe, expect, test } from 'bun:test'

import { deadline } from './budget'

describe('бюджет времени', () => {
  test('свежий бюджет не истёк и отдаёт остаток', () => {
    const d = deadline(1000)
    expect(d.expired()).toBe(false)
    expect(d.left()).toBeGreaterThan(900)
    expect(d.left()).toBeLessThanOrEqual(1000)
  })

  test('нулевой бюджет истёк сразу', () => {
    const d = deadline(0)
    expect(d.expired()).toBe(true)
    expect(d.left()).toBe(0)
  })

  test('хватает ли времени на ступень', () => {
    const d = deadline(1000)
    expect(d.enoughFor(500)).toBe(true)
    expect(d.enoughFor(5000)).toBe(false)
  })

  test('остаток не уходит в минус', async () => {
    const d = deadline(30)
    await new Promise((r) => setTimeout(r, 60))
    expect(d.left()).toBe(0)
    expect(d.expired()).toBe(true)
  })
})
