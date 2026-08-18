import { describe, expect, test } from 'bun:test'

import { safely } from './safely'
import { startTrace } from './trace'

const trace = startTrace('9785000000000', 'tester')

describe('safely', () => {
  test('удачный вызов отдаёт значение и не жалуется', async () => {
    const r = await safely('проба', trace, async () => 42)
    expect(r.value).toBe(42)
    expect(r.failure).toBeNull()
  })

  test('брошенная ошибка не выходит наружу', async () => {
    const r = await safely('проба', trace, async () => {
      throw new Error('источник лёг')
    })
    expect(r.value).toBeNull()
    expect(r.failure).toBe('источник лёг')
  })

  test('брошенная не-ошибка тоже переживается', async () => {
    const r = await safely('проба', trace, async () => {
      throw 'строка вместо ошибки'
    })
    expect(r.value).toBeNull()
    expect(r.failure).toBe('строка вместо ошибки')
  })

  test('зависший вызов обрывается по таймауту', async () => {
    const r = await safely(
      'проба',
      trace,
      () => new Promise((resolve) => setTimeout(() => resolve('поздно'), 500)),
      50,
    )
    expect(r.value).toBeNull()
    expect(r.failure).toMatch(/не уложил/i)
  })

  test('время работы измеряется', async () => {
    const r = await safely('проба', trace, async () => {
      await new Promise((res) => setTimeout(res, 30))
      return 'ok'
    })
    expect(r.ms).toBeGreaterThanOrEqual(25)
  })
})
