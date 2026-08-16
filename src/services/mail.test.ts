import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-mail-'))
process.env.BETTER_AUTH_SECRET = '0123456789012345678901234567890123'

const { db } = await import('@/db')
const { sql } = await import('drizzle-orm')
const { seal, open } = await import('@/lib/secretbox')
const { getMailSettings, mailReady, saveMailSettings, sendMail, sendTestMail } =
  await import('./mail')

/** Фиктивный SMTP: отвечает как настоящий и запоминает диалог. */
const dialogue: Array<string> = []
const server = createServer((socket) => {
  socket.write('220 test ESMTP\r\n')
  socket.on('data', (chunk) => {
    const text = chunk.toString()
    dialogue.push(text)
    for (const line of text.split('\r\n')) {
      if (line.startsWith('EHLO') || line.startsWith('HELO'))
        socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n')
      else if (line.startsWith('AUTH')) socket.write('235 OK\r\n')
      else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO'))
        socket.write('250 OK\r\n')
      else if (line.startsWith('DATA')) socket.write('354 go\r\n')
      else if (line === '.') socket.write('250 2.0.0 Ok: queued as TEST\r\n')
      else if (line.startsWith('QUIT')) {
        socket.write('221 Bye\r\n')
        socket.end()
      }
    }
  })
})
const PORT = 2597
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r))
afterAll(() => server.close())

const BASE = {
  host: '127.0.0.1',
  port: PORT,
  secure: 'none' as const,
  username: 'polka',
  fromName: 'Полка',
  fromEmail: 'polka@test.local',
  sendReset: true,
  sendInvites: true,
  sendEmailChange: true,
  sendNotifications: false,
}

describe('секреты', () => {
  test('пароль шифруется и расшифровывается', async () => {
    const sealed = await seal('пароль приложения')
    expect(sealed).not.toContain('пароль')
    expect(await open(sealed)).toBe('пароль приложения')
  })

  test('чужой шифротекст не расшифровывается молча', async () => {
    expect(await open('не-база64-и-не-шифр')).toBeNull()
  })
})

describe('почта', () => {
  test('настройки сохраняются, пароль наружу не отдаётся', async () => {
    await saveMailSettings({ ...BASE, password: 'секрет-почты' })

    const view = await getMailSettings()
    expect(view).toMatchObject({ host: '127.0.0.1', configured: true })
    expect(view.hasPassword).toBe(true)
    expect(JSON.stringify(view)).not.toContain('секрет-почты')

    const rows = await db.all<{ password_enc: string }>(
      sql`select password_enc from mail_setting`,
    )
    expect(rows[0]?.password_enc).not.toContain('секрет-почты')
  })

  test('пустой пароль не затирает сохранённый', async () => {
    await saveMailSettings({ ...BASE, password: '' })
    expect((await getMailSettings()).hasPassword).toBe(true)
  })

  test('тестовое письмо доходит и показывает ответ сервера', async () => {
    const result = await sendTestMail('aleksey@test.local')
    expect(result.ok).toBe(true)
    expect(result.message).toContain('250')
    expect(dialogue.join('')).toContain('AUTH')

    const view = await getMailSettings()
    expect(view.lastResult).toContain('ok:')
  })

  test('выключенный вид писем не отправляется', async () => {
    expect(await mailReady('notification')).toBe(false)
    const sent = await sendMail('notification', 'a@test.local', 'Тема', {
      text: 'т',
      html: '<p>т</p>',
    })
    expect(sent).toBe(false)
  })

  test('без настроек письма не уходят, но и не падают', async () => {
    await db.run(sql`update mail_setting set host = null`)
    expect(await mailReady('reset')).toBe(false)
    expect(
      await sendMail('reset', 'a@test.local', 'Тема', {
        text: 'т',
        html: '<p>т</p>',
      }),
    ).toBe(false)
  })
})
