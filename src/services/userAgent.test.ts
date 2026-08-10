import { describe, expect, test } from 'bun:test'

import { POLKA_USER_AGENT } from './userAgent'

describe('POLKA_USER_AGENT', () => {
  test('строго ASCII — иначе fetch падает с TypeError на каждом запросе', () => {
    expect(POLKA_USER_AGENT).toMatch(/^[\x20-\x7E]+$/)
  })

  test('fetch принимает такой заголовок', () => {
    expect(() => new Headers({ 'User-Agent': POLKA_USER_AGENT })).not.toThrow()
  })
})
