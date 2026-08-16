import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-prefs-'))

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { getPrefs, setPrefs } = await import('./prefs')

const ALEX = 'u-prefs'

await db.insert(user).values({
  id: ALEX,
  name: 'Алексей',
  email: 'prefs@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})

describe('настройки пользователя', () => {
  test('по умолчанию «Пропустить» спрашивает', async () => {
    expect(await getPrefs(ALEX)).toMatchObject({ skipAction: 'ask' })
  })

  test('выбор запоминается и переписывается', async () => {
    await setPrefs(ALEX, { skipAction: 'save-isbn' })
    expect(await getPrefs(ALEX)).toMatchObject({ skipAction: 'save-isbn' })

    await setPrefs(ALEX, { skipAction: 'discard' })
    expect(await getPrefs(ALEX)).toMatchObject({ skipAction: 'discard' })
  })

  test('у другого пользователя свои настройки', async () => {
    await db.insert(user).values({
      id: 'u-prefs-2',
      name: 'Оля',
      email: 'prefs2@test.local',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    expect(await getPrefs('u-prefs-2')).toMatchObject({ skipAction: 'ask' })
  })
})
