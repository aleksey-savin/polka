import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { sourceSetting } from '@/db/schema/moderation'
import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import { open, seal } from '@/lib/secretbox'
import { requireAdmin } from './moderation'

/**
 * Внешние источники метаданных (M25.1).
 *
 * Google Books без ключа отвечает 429 — общая анонимная квота давно исчерпана,
 * и для человека это выглядит как «книга не нашлась». Поэтому ключ настраивается
 * в приложении, а не только через переменную окружения.
 */

const ROW = 'default'

async function row() {
  const [found] = await db
    .select()
    .from(sourceSetting)
    .where(eq(sourceSetting.id, ROW))
  return found ?? null
}

/** Ключ: сначала из настроек, потом из окружения (совместимость). */
export async function googleBooksKey(): Promise<string | null> {
  const found = await row()
  if (found?.googleKeyEnc) {
    const key = await open(found.googleKeyEnc)
    if (key) return key
  }
  return env.GOOGLE_BOOKS_API_KEY ?? null
}

export interface SourceSettingsView {
  hasGoogleKey: boolean
  web: {
    enabled: boolean
    paidFallback: boolean
    dailyLimit: number
    lastResult: string | null
    lastResultAt: Date | null
    used: number
    /** Поиску нужны ключ и каталог из настроек ИИ. */
    ready: boolean
  }
  /** Ключ пришёл из переменной окружения, поменять его можно только там. */
  fromEnv: boolean
  lastCheck: string | null
  lastCheckAt: Date | null
}

export async function getSourceSettings(
  userId: string,
): Promise<SourceSettingsView> {
  await requireAdmin(userId)
  const found = await row()
  const { webSettings, searchesToday } = await import('./webSearch')
  const { aiCredentials } = await import('./ai')
  const [web, quota, creds] = await Promise.all([
    webSettings(),
    searchesToday(userId),
    aiCredentials(),
  ])
  return {
    web: { ...web, used: quota.used, ready: creds !== null },
    hasGoogleKey:
      Boolean(found?.googleKeyEnc) || Boolean(env.GOOGLE_BOOKS_API_KEY),
    fromEnv: !found?.googleKeyEnc && Boolean(env.GOOGLE_BOOKS_API_KEY),
    lastCheck: found?.lastCheck ?? null,
    lastCheckAt: found?.lastCheckAt ?? null,
  }
}

export async function saveSourceSettings(
  userId: string,
  googleKey: string,
): Promise<void> {
  await requireAdmin(userId)
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  // пустое поле — оставить прежний ключ, как в почте и настройках ИИ
  if (googleKey.trim()) patch.googleKeyEnc = await seal(googleKey.trim())
  await db
    .insert(sourceSetting)
    .values({ id: ROW, ...patch })
    .onConflictDoUpdate({ target: sourceSetting.id, set: patch })
  log.info('lookup', 'ключ Google Books изменён')
}

export interface SourceProbe {
  name: string
  ok: boolean
  message: string
}

/** Заведомо существующий номер: по нему и проверяем, живы ли источники. */
const PROBE_ISBN = '9785171636951'

const RETRY_STATUS = new Set([429, 500, 502, 503, 504])

/** Повторяем на «временно недоступен»: и Google, и OpenLibrary этим грешат. */
async function fetchRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let last: Response | null = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      last = await fetch(url, init)
      if (last.ok || !RETRY_STATUS.has(last.status)) return last
    } catch (error) {
      if (attempt === attempts) throw error
    }
    await new Promise((r) => setTimeout(r, attempt * 400))
  }
  if (!last) throw new Error('нет ответа')
  return last
}

/** Проверка источников: показываем дословно, кто что ответил. */
export async function probeSources(
  userId: string,
): Promise<Array<SourceProbe>> {
  await requireAdmin(userId)
  const key = await googleBooksKey()
  const out: Array<SourceProbe> = []

  // Google Books
  try {
    const res = await fetchRetry(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${PROBE_ISBN}&country=RU${key ? `&key=${key}` : ''}`,
      {
        headers: { referer: `${env.APP_URL}/` },
        signal: AbortSignal.timeout(8000),
      },
    )
    const raw = await res.text()
    if (!res.ok) {
      out.push({
        name: 'Google Books',
        ok: false,
        message:
          res.status === 503
            ? '503 — Google временно занят, попробуйте ещё раз'
            : res.status === 403
              ? '403 — ключ ограничен: разрешите домен приложения или IP сервера'
              : `${res.status}: ${raw.slice(0, 140)}`,
      })
    } else {
      const items = (JSON.parse(raw) as { items?: Array<unknown> }).items
      out.push({
        name: 'Google Books',
        ok: Boolean(items?.length),
        message: items?.length
          ? `отвечает${key ? ' (с ключом)' : ' без ключа — квота скоро кончится'}`
          : 'отвечает, но этот номер не знает',
      })
    }
  } catch (error) {
    out.push({
      name: 'Google Books',
      ok: false,
      message: error instanceof Error ? error.message : 'не ответил',
    })
  }

  // FantLab
  try {
    const res = await fetch(
      `https://api.fantlab.ru/search-editions?q=${PROBE_ISBN}`,
      { signal: AbortSignal.timeout(8000) },
    )
    out.push({
      name: 'FantLab',
      ok: res.ok,
      message: res.ok ? 'отвечает' : `${res.status}`,
    })
  } catch (error) {
    out.push({
      name: 'FantLab',
      ok: false,
      message: error instanceof Error ? error.message : 'не ответил',
    })
  }

  // OpenLibrary
  try {
    const res = await fetchRetry(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${PROBE_ISBN}&format=json&jscmd=data`,
      { signal: AbortSignal.timeout(12_000) },
      2,
    )
    out.push({
      name: 'OpenLibrary',
      ok: res.ok,
      message: res.ok ? 'отвечает' : `${res.status}`,
    })
  } catch {
    // из российских сетей openlibrary.org часто недоступен; на поиск это не
    // влияет — FantLab и Google работают, поэтому не пугаем красным текстом
    out.push({
      name: 'OpenLibrary',
      ok: false,
      message: 'не отвечает из этой сети — на поиск книг почти не влияет',
    })
  }

  const summary = out
    .map((p) => `${p.name}: ${p.ok ? 'ок' : p.message}`)
    .join(' · ')
  await db
    .update(sourceSetting)
    .set({ lastCheck: summary, lastCheckAt: new Date() })
    .where(eq(sourceSetting.id, ROW))
  log.info('lookup', 'проверка источников', { summary })
  return out
}
