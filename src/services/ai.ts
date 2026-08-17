import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/db'
import { aiSetting, aiUsage } from '@/db/schema/moderation'
import { log } from '@/lib/logger'
import { open, seal } from '@/lib/secretbox'
import { AppError } from './errors'

/**
 * Подключение ИИ (M24). Этот слой — единственная дверь к модели: таймаут,
 * суточный лимит на пользователя, запись в журнал. Функции появятся дальше и
 * будут ходить только сюда.
 *
 * Провайдер по умолчанию — Yandex AI Studio: зарубежные модели до российских
 * книжных источников не дотягиваются.
 */

export type AiProvider = 'yandex' | 'openai'

const YANDEX_URL =
  'https://llm.api.cloud.yandex.net/foundationModels/v1/completion'

/** Известные модели Яндекса — показываем, когда список не удалось получить. */
const YANDEX_FALLBACK = [
  'yandexgpt/latest',
  'yandexgpt-lite/latest',
  'yandexgpt-32k/latest',
  'llama/latest',
]

export interface AiSettingsView {
  enabled: boolean
  provider: AiProvider
  folderId: string
  model: string
  endpoint: string
  dailyLimit: number
  hasKey: boolean
  configured: boolean
  lastResult: string | null
  lastResultAt: Date | null
}

const ROW_ID = 'default'

async function row() {
  const [found] = await db
    .select()
    .from(aiSetting)
    .where(eq(aiSetting.id, ROW_ID))
  return found ?? null
}

export async function getAiSettings(): Promise<AiSettingsView> {
  const found = await row()
  const provider = found?.provider ?? 'yandex'
  return {
    enabled: found?.enabled ?? false,
    provider,
    folderId: found?.folderId ?? '',
    model: found?.model ?? '',
    endpoint: found?.endpoint ?? '',
    dailyLimit: found?.dailyLimit ?? 30,
    hasKey: Boolean(found?.apiKeyEnc),
    configured: Boolean(
      found?.apiKeyEnc &&
      found.model &&
      (provider === 'openai' ? found.endpoint : found.folderId),
    ),
    lastResult: found?.lastResult ?? null,
    lastResultAt: found?.lastResultAt ?? null,
  }
}

export interface AiSettingsInput {
  enabled: boolean
  provider: AiProvider
  /** Пустая строка — оставить прежний ключ. */
  apiKey?: string
  folderId: string
  model: string
  endpoint: string
  dailyLimit: number
}

export async function saveAiSettings(input: AiSettingsInput): Promise<void> {
  const patch: Record<string, unknown> = {
    enabled: input.enabled,
    provider: input.provider,
    folderId: input.folderId.trim() || null,
    model: input.model.trim() || null,
    endpoint: input.endpoint.trim() || null,
    dailyLimit: input.dailyLimit,
    updatedAt: new Date(),
  }
  if (input.apiKey?.trim()) patch.apiKeyEnc = await seal(input.apiKey.trim())
  await db
    .insert(aiSetting)
    .values({ id: ROW_ID, ...patch })
    .onConflictDoUpdate({ target: aiSetting.id, set: patch })
  log.info('ai', 'настройки ИИ изменены', {
    provider: input.provider,
    model: input.model,
    enabled: input.enabled,
  })
}

const today = () => new Date().toISOString().slice(0, 10)

export interface AiUsage {
  used: number
  limit: number
  left: number
}

export async function usageToday(userId: string): Promise<AiUsage> {
  const settings = await getAiSettings()
  const [used] = await db
    .select({ calls: aiUsage.calls })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, today())))
  const calls = used?.calls ?? 0
  return {
    used: calls,
    limit: settings.dailyLimit,
    left: Math.max(0, settings.dailyLimit - calls),
  }
}

async function countCall(userId: string, tokens: number): Promise<void> {
  await db
    .insert(aiUsage)
    .values({ userId, day: today(), calls: 1, tokens })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day],
      set: {
        calls: sql`${aiUsage.calls} + 1`,
        tokens: sql`${aiUsage.tokens} + ${tokens}`,
      },
    })
}

export interface AskResult {
  text: string
  tokens: number
  ms: number
}

interface YandexResponse {
  result?: {
    alternatives?: Array<{ message?: { text?: string } }>
    usage?: { totalTokens?: string }
  }
  message?: string
}

interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: { total_tokens?: number }
  error?: { message?: string }
}

/**
 * Единственная точка обращения к модели.
 * Бросает понятную ошибку: выключено, не настроено, лимит исчерпан, отказ API.
 */
export async function ask(
  userId: string,
  prompt: string,
  options: { system?: string; maxTokens?: number; temperature?: number } = {},
): Promise<AskResult> {
  const found = await row()
  if (!found?.enabled) throw new AppError('ИИ выключен', 'invalid')
  const key = found.apiKeyEnc ? await open(found.apiKeyEnc) : null
  if (!key || !found.model) {
    throw new AppError('ИИ не настроен: нужен ключ и модель', 'invalid')
  }

  const usage = await usageToday(userId)
  if (usage.left <= 0) {
    throw new AppError(
      `Дневной лимит запросов исчерпан (${usage.limit}). Счётчик обнулится завтра.`,
      'invalid',
    )
  }

  const started = performance.now()
  const isYandex = found.provider === 'yandex'
  const url = isYandex ? YANDEX_URL : `${found.endpoint ?? ''}/chat/completions`
  const body = isYandex
    ? {
        modelUri: found.model.startsWith('gpt://')
          ? found.model
          : `gpt://${found.folderId ?? ''}/${found.model}`,
        completionOptions: {
          stream: false,
          temperature: options.temperature ?? 0.3,
          maxTokens: String(options.maxTokens ?? 800),
        },
        messages: [
          ...(options.system ? [{ role: 'system', text: options.system }] : []),
          { role: 'user', text: prompt },
        ],
      }
    : {
        model: found.model,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 800,
        messages: [
          ...(options.system
            ? [{ role: 'system', content: options.system }]
            : []),
          { role: 'user', content: prompt },
        ],
      }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: isYandex ? `Api-Key ${key}` : `Bearer ${key}`,
        ...(isYandex && found.folderId
          ? { 'x-folder-id': found.folderId }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await remember(`ошибка: ${message}`)
    log.error('ai', 'запрос к модели не дошёл', { url, message })
    throw new AppError(`Не удалось связаться с моделью: ${message}`, 'invalid')
  }

  const raw = await response.text()
  if (!response.ok) {
    // ответ сервиса показываем дословно: гадать про 401 и квоты бессмысленно
    const short = raw.slice(0, 300)
    await remember(`ошибка ${response.status}: ${short}`)
    log.warn('ai', 'модель ответила ошибкой', {
      status: response.status,
      body: short,
    })
    throw new AppError(
      `Модель ответила ${response.status}: ${short}`,
      'invalid',
    )
  }

  const parsed = JSON.parse(raw) as YandexResponse & OpenAiResponse
  const text = isYandex
    ? (parsed.result?.alternatives?.[0]?.message?.text ?? '')
    : (parsed.choices?.[0]?.message?.content ?? '')
  const tokens = isYandex
    ? Number(parsed.result?.usage?.totalTokens ?? 0)
    : (parsed.usage?.total_tokens ?? 0)
  const ms = Math.round(performance.now() - started)

  await countCall(userId, tokens)
  await remember(`ok: ответ за ${ms} мс, токенов ${tokens || '—'}`)
  log.info('ai', 'ответ модели', { model: found.model, tokens, ms })
  return { text, tokens, ms }
}

async function remember(result: string): Promise<void> {
  await db
    .update(aiSetting)
    .set({ lastResult: result, lastResultAt: new Date() })
    .where(eq(aiSetting.id, ROW_ID))
}

/** Проверка связи: короткий запрос, ответ показываем дословно. */
export async function checkAi(
  userId: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await ask(userId, 'Ответь одним словом: работает?', {
      maxTokens: 20,
    })
    return {
      ok: true,
      message: `${result.text.trim() || 'пустой ответ'} · ${result.ms} мс`,
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Список моделей — спрашиваем у самого провайдера.
 *
 * У Yandex AI Studio есть OpenAI-совместимый слой, поэтому пробуем несколько
 * известных адресов подряд: какой ответит — тот и берём. Что именно ответили,
 * показываем дословно: гадать про права сервисного аккаунта бессмысленно.
 */
export async function listModels(): Promise<{
  models: Array<string>
  note: string | null
}> {
  const found = await row()
  const key = found?.apiKeyEnc ? await open(found.apiKeyEnc) : null
  if (!key) {
    return { models: [], note: 'Сначала сохраните ключ' }
  }

  const isYandex = (found?.provider ?? 'yandex') === 'yandex'
  const folder = found?.folderId ?? ''
  const candidates = isYandex
    ? [
        {
          url: `https://llm.api.cloud.yandex.net/v1/models${folder ? `?folderId=${folder}` : ''}`,
          auth: `Api-Key ${key}`,
        },
        {
          url: `https://llm.api.cloud.yandex.net/foundationModels/v1/models${folder ? `?folderId=${folder}` : ''}`,
          auth: `Api-Key ${key}`,
        },
      ]
    : [
        {
          url: `${found?.endpoint ?? ''}/models`,
          auth: `Bearer ${key}`,
        },
      ]

  const failures: Array<string> = []
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate.url, {
        headers: {
          authorization: candidate.auth,
          ...(isYandex && folder ? { 'x-folder-id': folder } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      })
      const raw = await res.text()
      if (!res.ok) {
        failures.push(`${res.status}: ${raw.slice(0, 160)}`)
        continue
      }
      const models = parseModelList(raw, folder)
      if (models.length > 0) {
        log.info('ai', 'список моделей получен', {
          url: candidate.url.split('?')[0],
          count: models.length,
        })
        return { models, note: null }
      }
      failures.push(`пустой список: ${raw.slice(0, 160)}`)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  log.warn('ai', 'список моделей не пришёл', { failures })
  return {
    models: isYandex ? YANDEX_FALLBACK : [],
    note: `Провайдер не отдал список (${failures.join(' · ')}). Ниже — известные модели, можно вписать свою.`,
  }
}

/** Форма ответа у провайдеров разная: data[].id, models[].uri, models[].name. */
export function parseModelList(raw: string, folder = ''): Array<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const o = parsed as Record<string, unknown>
  const rows = [o.data, o.models, o.modelSpecs, o.foundationModels].find(
    (v): v is Array<unknown> => Array.isArray(v),
  )
  if (!rows) return []

  const names = rows
    .map((item) => {
      if (typeof item === 'string') return item
      if (typeof item !== 'object' || item === null) return null
      const r = item as Record<string, unknown>
      const value = [r.id, r.uri, r.modelUri, r.name].find(
        (v): v is string => typeof v === 'string' && v.length > 0,
      )
      return value ?? null
    })
    .filter((v): v is string => v !== null)
    // gpt://<каталог>/<модель> сокращаем до имени: каталог уже задан отдельно
    .map((v) => {
      const short = v.replace(/^gpt:\/\//, '')
      return folder && short.startsWith(`${folder}/`)
        ? short.slice(folder.length + 1)
        : short
    })

  return [...new Set(names)].sort()
}

/** Доступен ли ИИ прямо сейчас — от этого зависят кнопки в интерфейсе. */
export async function aiReady(): Promise<boolean> {
  const view = await getAiSettings()
  return view.enabled && view.configured
}
