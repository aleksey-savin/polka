import { eq } from 'drizzle-orm'
import nodemailer from 'nodemailer'

import { db } from '@/db'
import { mailSetting } from '@/db/schema/moderation'
import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import { open, seal } from '@/lib/secretbox'
import { AppError } from './errors'

/**
 * Почта (M22). Настраивается в приложении: хост, порт, шифрование, логин,
 * пароль (хранится зашифрованным), отправитель.
 *
 * Если почта не настроена или сломалась — приложение работает как раньше,
 * просто без писем; ошибка уходит в журнал с ответом сервера.
 */

export type MailKind = 'reset' | 'invite' | 'email-change' | 'notification'

export interface MailSettingsView {
  host: string
  port: number | null
  secure: 'none' | 'starttls' | 'tls'
  username: string
  fromName: string
  fromEmail: string
  /** Пароль наружу не отдаём — только факт, что он есть. */
  hasPassword: boolean
  configured: boolean
  sendReset: boolean
  sendInvites: boolean
  sendEmailChange: boolean
  sendNotifications: boolean
  lastResult: string | null
  lastResultAt: Date | null
}

const ROW_ID = 'default'

async function row() {
  const [found] = await db
    .select()
    .from(mailSetting)
    .where(eq(mailSetting.id, ROW_ID))
  return found ?? null
}

export async function getMailSettings(): Promise<MailSettingsView> {
  const found = await row()
  return {
    host: found?.host ?? '',
    port: found?.port ?? null,
    secure: found?.secure ?? 'tls',
    username: found?.username ?? '',
    fromName: found?.fromName ?? 'Полка',
    fromEmail: found?.fromEmail ?? '',
    hasPassword: Boolean(found?.passwordEnc),
    configured: Boolean(found?.host && found.fromEmail),
    sendReset: found?.sendReset ?? true,
    sendInvites: found?.sendInvites ?? true,
    sendEmailChange: found?.sendEmailChange ?? true,
    sendNotifications: found?.sendNotifications ?? false,
    lastResult: found?.lastResult ?? null,
    lastResultAt: found?.lastResultAt ?? null,
  }
}

export interface MailSettingsInput {
  host: string
  port: number
  secure: 'none' | 'starttls' | 'tls'
  username: string
  /** Пустая строка — оставить прежний пароль. */
  password?: string
  fromName: string
  fromEmail: string
  sendReset: boolean
  sendInvites: boolean
  sendEmailChange: boolean
  sendNotifications: boolean
}

export async function saveMailSettings(
  input: MailSettingsInput,
): Promise<void> {
  const patch: Record<string, unknown> = {
    host: input.host.trim() || null,
    port: input.port,
    secure: input.secure,
    username: input.username.trim() || null,
    fromName: input.fromName.trim() || 'Полка',
    fromEmail: input.fromEmail.trim() || null,
    sendReset: input.sendReset,
    sendInvites: input.sendInvites,
    sendEmailChange: input.sendEmailChange,
    sendNotifications: input.sendNotifications,
    updatedAt: new Date(),
  }
  if (input.password?.trim()) {
    patch.passwordEnc = await seal(input.password.trim())
  }
  await db
    .insert(mailSetting)
    .values({ id: ROW_ID, ...patch })
    .onConflictDoUpdate({ target: mailSetting.id, set: patch })
  log.info('mail', 'настройки почты изменены', {
    host: input.host,
    port: input.port,
    secure: input.secure,
  })
}

async function transportFor() {
  const found = await row()
  if (!found?.host || !found.fromEmail) return null
  const password = found.passwordEnc ? await open(found.passwordEnc) : null
  const port = found.port ?? (found.secure === 'tls' ? 465 : 587)
  return {
    from: `${found.fromName ?? 'Полка'} <${found.fromEmail}>`,
    settings: found,
    transport: nodemailer.createTransport({
      host: found.host,
      port,
      secure: found.secure === 'tls',
      requireTLS: found.secure === 'starttls',
      ignoreTLS: found.secure === 'none',
      auth:
        found.username && password
          ? { user: found.username, pass: password }
          : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    }),
  }
}

async function remember(result: string): Promise<void> {
  await db
    .update(mailSetting)
    .set({ lastResult: result, lastResultAt: new Date() })
    .where(eq(mailSetting.id, ROW_ID))
}

const ENABLED: Record<MailKind, keyof typeof FLAG> = {
  reset: 'sendReset',
  invite: 'sendInvites',
  'email-change': 'sendEmailChange',
  notification: 'sendNotifications',
}
const FLAG = {
  sendReset: true,
  sendInvites: true,
  sendEmailChange: true,
  sendNotifications: true,
}

/**
 * Отправка письма. Возвращает false, если почта не настроена или вид писем
 * выключен — вызывающий код должен уметь жить без письма.
 */
export async function sendMail(
  kind: MailKind,
  to: string,
  subject: string,
  body: { text: string; html: string },
): Promise<boolean> {
  const ready = await transportFor()
  if (!ready) {
    log.info('mail', 'письмо не отправлено: почта не настроена', { kind, to })
    return false
  }
  if (!ready.settings[ENABLED[kind]]) {
    log.info('mail', 'письмо не отправлено: вид писем выключен', { kind })
    return false
  }
  try {
    const info = await ready.transport.sendMail({
      from: ready.from,
      to,
      subject,
      text: body.text,
      html: body.html,
    })
    log.info('mail', 'письмо отправлено', { kind, to, response: info.response })
    await remember(`ok: ${info.response}`)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('mail', 'письмо не ушло', {
      kind,
      to,
      error: error instanceof Error ? error : new Error(message),
    })
    await remember(`ошибка: ${message}`)
    return false
  }
}

/** Тестовое письмо: ответ сервера показываем дословно. */
export async function sendTestMail(
  to: string,
): Promise<{ ok: boolean; message: string }> {
  const ready = await transportFor()
  if (!ready) {
    return {
      ok: false,
      message: 'Заполните сервер и адрес отправителя, потом сохраните.',
    }
  }
  try {
    const info = await ready.transport.sendMail({
      from: ready.from,
      to,
      subject: 'Проверка связи · Полка',
      text: 'Если вы читаете это письмо, почта в Полке настроена верно.',
      html: layout(
        'Проверка связи',
        '<p>Если вы читаете это письмо, почта в Полке настроена верно.</p>',
      ),
    })
    const message = info.response
    await remember(`ok: ${message}`)
    log.info('mail', 'тестовое письмо отправлено', { to, response: message })
    return { ok: true, message }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await remember(`ошибка: ${message}`)
    log.warn('mail', 'тестовое письмо не ушло', { to, message })
    return { ok: false, message }
  }
}

/** Простая обёртка письма — единый вид без картинок и внешних ресурсов. */
export function layout(title: string, inner: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8" /></head>
<body style="margin:0;background:#FAFAF6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#232B38">
  <div style="max-width:520px;margin:0 auto;padding:28px 20px">
    <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em">Полка</div>
    <h1 style="margin:18px 0 12px;font-size:20px;line-height:1.3">${title}</h1>
    <div style="font-size:15px;line-height:1.6">${inner}</div>
    <p style="margin-top:24px;font-size:12.5px;color:#5C6472">
      Это письмо отправила Полка — сервис домашней библиотеки.
    </p>
  </div>
</body></html>`
}

export function button(url: string, label: string): string {
  return `<p style="margin:18px 0"><a href="${url}" style="display:inline-block;background:#2F6B4F;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">${label}</a></p>
<p style="font-size:12.5px;color:#5C6472;word-break:break-all">Если кнопка не работает: ${url}</p>`
}

/** Настроена ли почта — от этого зависит «Забыли пароль?» на входе. */
export async function mailReady(kind: MailKind): Promise<boolean> {
  const found = await row()
  return Boolean(found?.host && found.fromEmail && found[ENABLED[kind]])
}

export function appUrl(path: string): string {
  const base = env.APP_URL.replace(/\/$/, '')
  return `${base}${path}`
}

export function requireHost(view: MailSettingsView): void {
  if (!view.configured) {
    throw new AppError('Сначала настройте почту', 'invalid')
  }
}
