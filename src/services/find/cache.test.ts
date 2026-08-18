import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'
import type { FindResult } from './types'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-findcache-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-find-cache'

const { chainFingerprint, readCache, writeCache } = await import('./cache')

const result: FindResult = {
  isbn13: '9785171636951',
  isbn10: null,
  draft: { title: 'Зона' },
  found: ['fantlab'],
  probes: [],
  findings: [],
  proof: null,
  refBookId: null,
  workId: null,
  covers: [],
  cached: false,
  truncated: false,
  exhausted: false,
}

describe('кэш поиска', () => {
  test('отпечаток зависит от состава и порядка', () => {
    expect(chainFingerprint(['fantlab', 'google'])).toBe(
      chainFingerprint(['fantlab', 'google']),
    )
    expect(chainFingerprint(['fantlab', 'google'])).not.toBe(
      chainFingerprint(['google', 'fantlab']),
    )
    expect(chainFingerprint(['fantlab'])).not.toBe(
      chainFingerprint(['fantlab', 'google']),
    )
  })

  test('записанное читается тем же отпечатком', async () => {
    const print = chainFingerprint(['reference', 'fantlab'])
    await writeCache('9785171636951', print, result)
    const back = await readCache('9785171636951', print)
    expect(back?.draft.title).toBe('Зона')
    expect(back?.cached).toBe(true)
  })

  test('другой отпечаток — промах', async () => {
    await writeCache(
      '9785171636952',
      chainFingerprint(['reference', 'fantlab']),
      result,
    )
    const back = await readCache(
      '9785171636952',
      chainFingerprint(['reference', 'google']),
    )
    expect(back).toBeNull()
  })

  test('незнакомый номер — промах', async () => {
    expect(
      await readCache('9780000000002', chainFingerprint(['fantlab'])),
    ).toBeNull()
  })

  test('оборванная цепочка не кэшируется', async () => {
    const print = chainFingerprint(['reference'])
    await writeCache('9785171636953', print, { ...result, truncated: true })
    expect(await readCache('9785171636953', print)).toBeNull()
  })
})
