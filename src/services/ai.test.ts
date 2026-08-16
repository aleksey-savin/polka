import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-ai-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-ai'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { aiSetting } = await import('@/db/schema/moderation')
const { eq } = await import('drizzle-orm')
const { ask, aiReady, checkAi, getAiSettings, saveAiSettings, usageToday } =
  await import('./ai')

const ME = 'ai-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'ai@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})

/** Подставной OpenAI-совместимый сервис: отвечает или ломается по команде. */
let mode: 'ok' | 'fail' = 'ok'
let seenAuth = ''
const server = Bun.serve({
  port: 0,
  fetch(request) {
    seenAuth = request.headers.get('authorization') ?? ''
    if (mode === 'fail') {
      return new Response('{"error":{"message":"нет доступа"}}', {
        status: 401,
      })
    }
    return Response.json({
      choices: [{ message: { content: 'работает' } }],
      usage: { total_tokens: 7 },
    })
  },
})
const base = `http://localhost:${server.port}/v1`
afterAll(() => server.stop(true))

const settings = (patch: Partial<Parameters<typeof saveAiSettings>[0]> = {}) =>
  saveAiSettings({
    enabled: true,
    provider: 'openai',
    apiKey: 'secret-key',
    folderId: '',
    model: 'test-model',
    endpoint: base,
    dailyLimit: 3,
    ...patch,
  })

describe('подключение ИИ', () => {
  test('ключ хранится зашифрованным и наружу не отдаётся', async () => {
    await settings()
    const [row] = await db
      .select()
      .from(aiSetting)
      .where(eq(aiSetting.id, 'default'))
    expect(row?.apiKeyEnc).toBeTruthy()
    expect(row?.apiKeyEnc).not.toContain('secret-key')

    const view = await getAiSettings()
    expect(view.hasKey).toBe(true)
    expect(JSON.stringify(view)).not.toContain('secret-key')
    expect(view.configured).toBe(true)
    expect(await aiReady()).toBe(true)
  })

  test('пустой ключ не затирает прежний', async () => {
    await settings({ apiKey: '' })
    expect((await getAiSettings()).hasKey).toBe(true)
    mode = 'ok'
    const result = await ask(ME, 'привет')
    expect(seenAuth).toBe('Bearer secret-key')
    expect(result.text).toBe('работает')
    expect(result.tokens).toBe(7)
  })

  test('запросы считаются по человеку и упираются в лимит', async () => {
    await settings({ dailyLimit: 2 })
    await db.delete((await import('@/db/schema/moderation')).aiUsage)

    await ask(ME, 'раз')
    expect((await usageToday(ME)).left).toBe(1)
    await ask(ME, 'два')
    expect((await usageToday(ME)).left).toBe(0)
    await expect(ask(ME, 'три')).rejects.toThrow(/лимит/i)
  })

  test('отказ сервиса показывается дословно, запрос не засчитывается', async () => {
    await settings({ dailyLimit: 5 })
    mode = 'fail'
    const before = (await usageToday(ME)).used

    const check = await checkAi(ME)
    expect(check.ok).toBe(false)
    expect(check.message).toContain('401')
    expect(check.message).toContain('нет доступа')
    expect((await usageToday(ME)).used).toBe(before)
    expect((await getAiSettings()).lastResult).toContain('ошибка 401')

    mode = 'ok'
  })

  test('выключенный ИИ не ходит в сеть', async () => {
    await settings({ enabled: false })
    expect(await aiReady()).toBe(false)
    await expect(ask(ME, 'привет')).rejects.toThrow(/выключен/i)
  })

  test('без ключа и модели подключение не считается настроенным', async () => {
    await db.delete(aiSetting)
    const view = await getAiSettings()
    expect(view.configured).toBe(false)
    expect(view.hasKey).toBe(false)
    expect(view.provider).toBe('yandex')
    expect(view.dailyLimit).toBe(30)
    await expect(ask(ME, 'привет')).rejects.toThrow(/выключен/i)
  })
})
