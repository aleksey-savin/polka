import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, test } from 'bun:test'
import type { SourceAdapter, SourceKey } from './types'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-chain-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-chain'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { bookSource, userAccount } = await import('@/db/schema/moderation')
const { resolveChain } = await import('./chain')
const { setEnabled, moveSource } = await import('@/services/bookSources')

const ME = 'chain-admin'
await db.insert(user).values({
  id: ME,
  name: 'Админ',
  email: 'chain@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
await db.insert(userAccount).values({ userId: ME, role: 'admin' })

/** Пустышка: цепочку проверяем по составу и порядку, не по походам в сеть. */
const stub = (key: SourceKey, paid = false): SourceAdapter => ({
  key,
  paid,
  timeoutMs: 100,
  probe: async () => [],
})

const REGISTRY: Record<SourceKey, SourceAdapter> = {
  reference: stub('reference'),
  fantlab: stub('fantlab'),
  google: stub('google'),
  openlibrary: stub('openlibrary'),
  web: stub('web', true),
  neuro: stub('neuro', true),
}

const keysOf = async () =>
  (await resolveChain(ME, REGISTRY))
    .filter((step) => step.enabled)
    .map((step) => step.adapter.key)

beforeEach(async () => {
  await db.delete(bookSource)
})

describe('цепочка из настроек', () => {
  test('по умолчанию всё, кроме Нейропоиска', async () => {
    expect(await keysOf()).toEqual([
      'reference',
      'fantlab',
      'google',
      'openlibrary',
      'web',
    ])
  })

  test('выключенный источник в цепочку не попадает', async () => {
    await setEnabled(ME, 'google', false)
    expect(await keysOf()).not.toContain('google')
  })

  test('выключенный отмечен причиной, а не выброшен молча', async () => {
    await setEnabled(ME, 'google', false)
    const chain = await resolveChain(ME, REGISTRY)
    const google = chain.find((step) => step.adapter.key === 'google')
    expect(google?.enabled).toBe(false)
    expect(google?.reason).toMatch(/выключен/i)
  })

  test('перестановка меняет порядок цепочки', async () => {
    await moveSource(ME, 'google', 'up')
    const keys = await keysOf()
    expect(keys.indexOf('google')).toBeLessThan(keys.indexOf('fantlab'))
  })

  test('эталон всегда первый и не выключается', async () => {
    await setEnabled(ME, 'reference', false)
    const keys = await keysOf()
    expect(keys[0]).toBe('reference')
  })
})
