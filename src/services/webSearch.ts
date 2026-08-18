import { and, eq, sql } from 'drizzle-orm'

import { db } from '@/db'
import { aiUsage, sourceSetting } from '@/db/schema/moderation'
import { log } from '@/lib/logger'
import { aiCredentials } from './ai'
import { AppError } from './errors'

/**
 * Поиск в интернете по ISBN (M26).
 *
 * Языковая модель номеров не знает — номер лежит на страницах магазинов и
 * библиотек. Поэтому сначала ищем страницу, а потом просим модель прочитать
 * найденное. Принимаем результат только если сам номер встретился в тексте:
 * тогда у нас есть ссылка, по которой можно проверить.
 *
 * Инструмент — Yandex Search API v2 (услуга включается в консоли, сервисному
 * аккаунту нужна роль search-api.webSearch.user). Ключ и каталог — те же, что
 * у настроек ИИ.
 */

const SEARCH_HOST = 'https://searchapi.api.cloud.yandex.net'
const OPERATION_HOST = 'https://operation.api.cloud.yandex.net'

export type WebMode = 'extract' | 'generative'

export interface WebHit {
  url: string
  title: string
  text: string
}

const ROW = 'default'

async function settingsRow() {
  const [found] = await db
    .select()
    .from(sourceSetting)
    .where(eq(sourceSetting.id, ROW))
  return found ?? null
}

export interface WebSearchSettings {
  enabled: boolean
  mode: WebMode
  /** Платный генеративный поиск — вторым заходом, когда бесплатный пуст. */
  paidFallback: boolean
  dailyLimit: number
  lastResult: string | null
  lastResultAt: Date | null
}

export async function webSettings(): Promise<WebSearchSettings> {
  const found = await settingsRow()
  return {
    enabled: found?.webEnabled ?? false,
    mode: found?.webMode ?? 'extract',
    paidFallback: found?.webPaidFallback ?? false,
    dailyLimit: found?.webDailyLimit ?? 100,
    lastResult: found?.webLastResult ?? null,
    lastResultAt: found?.webLastResultAt ?? null,
  }
}

const today = () => new Date().toISOString().slice(0, 10)

export interface SearchQuota {
  used: number
  limit: number
  left: number
}

export async function searchesToday(userId: string): Promise<SearchQuota> {
  const settings = await webSettings()
  const [row] = await db
    .select({ searches: aiUsage.searches })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, today())))
  const used = row?.searches ?? 0
  return {
    used,
    limit: settings.dailyLimit,
    left: Math.max(0, settings.dailyLimit - used),
  }
}

async function countSearch(userId: string): Promise<void> {
  await db
    .insert(aiUsage)
    .values({ userId, day: today(), searches: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day],
      set: { searches: sql`${aiUsage.searches} + 1` },
    })
}

async function remember(result: string): Promise<void> {
  await db
    .update(sourceSetting)
    .set({ webLastResult: result, webLastResultAt: new Date() })
    .where(eq(sourceSetting.id, ROW))
}

/** Ответ Web Search приходит XML в base64 — вытаскиваем ссылки и сниппеты. */
export function parseSearchXml(xml: string): Array<WebHit> {
  const clean = (s: string) =>
    s
      .replace(/<\/?hlword[^>]*>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()

  const hits: Array<WebHit> = []
  for (const doc of xml.split('<doc').slice(1)) {
    const url = /<url>([\s\S]*?)<\/url>/.exec(doc)?.[1]
    if (!url) continue
    const title = /<title>([\s\S]*?)<\/title>/.exec(doc)?.[1] ?? ''
    const passages = [...doc.matchAll(/<passage>([\s\S]*?)<\/passage>/g)].map(
      (m) => clean(m[1] ?? ''),
    )
    const headline = /<headline>([\s\S]*?)<\/headline>/.exec(doc)?.[1] ?? ''
    const text = [...passages, clean(headline)].filter(Boolean).join(' · ')
    hits.push({ url: clean(url), title: clean(title), text })
  }
  return hits
}

interface OperationResponse {
  id?: string
  done?: boolean
  response?: { rawData?: string }
  error?: { message?: string }
  message?: string
}

/**
 * Веб-выдача по запросу. Синхронный метод есть не во всех регионах, поэтому
 * при отказе идём асинхронным путём и опрашиваем операцию.
 */
export async function searchWeb(query: string): Promise<Array<WebHit>> {
  const creds = await aiCredentials()
  if (!creds)
    throw new AppError('Не задан ключ ИИ — он же нужен поиску', 'invalid')

  const body = {
    query: {
      searchType: 'SEARCH_TYPE_RU',
      queryText: query,
      familyMode: 'FAMILY_MODE_NONE',
      page: '0',
      // иначе опечаточник «исправит» цифры номера на похожие
      fixTypoMode: 'FIX_TYPO_MODE_OFF',
    },
    groupSpec: {
      // строго GROUP_MODE_FLAT: близкое по смыслу имя API отвергает с 400
      groupMode: 'GROUP_MODE_FLAT',
      groupsOnPage: '10',
      docsInGroup: '1',
    },
    // без этого выдача приходит без сниппетов, и номеру негде встретиться
    maxPassages: '5',
    l10n: 'LOCALIZATION_RU',
    folderId: creds.folderId,
    responseFormat: 'FORMAT_XML',
  }
  const headers = {
    authorization: `Api-Key ${creds.key}`,
    'content-type': 'application/json',
  }

  const sync = await fetch(`${SEARCH_HOST}/v2/web/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)

  if (sync?.ok) {
    const data = (await sync.json()) as OperationResponse
    const raw = data.response?.rawData ?? (data as { rawData?: string }).rawData
    if (raw) return parseSearchXml(Buffer.from(raw, 'base64').toString('utf8'))
  } else if (sync) {
    log.info('web', 'синхронный поиск недоступен, пробуем асинхронный', {
      status: sync.status,
    })
  }

  const started = await fetch(`${SEARCH_HOST}/v2/web/searchAsync`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const startedRaw = await started.text()
  if (!started.ok) {
    throw new AppError(
      `Поиск ответил ${started.status}: ${startedRaw.slice(0, 200)}`,
    )
  }
  const operation = JSON.parse(startedRaw) as OperationResponse
  if (!operation.id) throw new AppError('Поиск не вернул идентификатор задачи')

  // операция обычно готова за 1–3 секунды
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 900 : 700))
    const res = await fetch(`${OPERATION_HOST}/operations/${operation.id}`, {
      headers: { authorization: `Api-Key ${creds.key}` },
      signal: AbortSignal.timeout(10_000),
    })
    const raw = await res.text()
    if (!res.ok) {
      throw new AppError(`Поиск ответил ${res.status}: ${raw.slice(0, 200)}`)
    }
    const done = JSON.parse(raw) as OperationResponse
    if (done.error) {
      throw new AppError(
        `Поиск отказал: ${done.error.message ?? 'без причины'}`,
      )
    }
    if (done.done && done.response?.rawData) {
      return parseSearchXml(
        Buffer.from(done.response.rawData, 'base64').toString('utf8'),
      )
    }
  }
  throw new AppError('Поиск не ответил за отведённое время')
}

export interface GenAnswer {
  text: string
  sources: Array<{ url: string; title: string; used: boolean }>
}

/** Генеративный ответ: модель ищет сама и возвращает использованные источники. */
export async function genSearch(query: string): Promise<GenAnswer> {
  const creds = await aiCredentials()
  if (!creds)
    throw new AppError('Не задан ключ ИИ — он же нужен поиску', 'invalid')

  const res = await fetch(`${SEARCH_HOST}/v2/gen/search`, {
    method: 'POST',
    headers: {
      authorization: `Api-Key ${creds.key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ content: query, role: 'ROLE_USER' }],
      folderId: creds.folderId,
      fixMisspell: false,
      enableNrfmDocs: false,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const raw = await res.text()
  if (!res.ok) {
    throw new AppError(`Поиск ответил ${res.status}: ${raw.slice(0, 200)}`)
  }
  const data = JSON.parse(raw) as {
    message?: { content?: string }
    sources?: Array<{ url?: string; title?: string; used?: boolean }>
  }
  return {
    text: data.message?.content ?? '',
    sources: (data.sources ?? [])
      .filter((s) => typeof s.url === 'string')
      .map((s) => ({
        url: s.url ?? '',
        title: s.title ?? '',
        used: s.used ?? false,
      })),
  }
}

/** Только цифры: на страницах номер печатают с дефисами и пробелами как попало. */
export const bareIsbn = (isbn: string) => isbn.replace(/[^0-9Xx]/g, '')

/**
 * Встречается ли номер в тексте. Правило приёмки: без этого данные не берём,
 * иначе получим уверенный пересказ чужой книги.
 */
export function mentionsIsbn(text: string, isbn13: string): boolean {
  const digits = bareIsbn(text.replace(/[\s‑–—-]/g, ''))
  return digits.includes(bareIsbn(isbn13))
}

/** Расход поиска: проверяем лимит, считаем и пишем результат в настройки. */
export async function spendSearch(
  userId: string,
  run: () => Promise<string>,
): Promise<void> {
  const quota = await searchesToday(userId)
  if (quota.left <= 0) {
    throw new AppError(
      `Дневной лимит поисков исчерпан (${quota.limit}). Счётчик обнулится завтра.`,
      'invalid',
    )
  }
  const started = performance.now()
  try {
    const summary = await run()
    await countSearch(userId)
    await remember(
      `ok: ${summary} за ${Math.round(performance.now() - started)} мс`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await remember(`ошибка: ${message}`)
    log.warn('web', 'поиск не удался', { message })
    throw error
  }
}

export async function saveWebSettings(input: {
  enabled: boolean
  paidFallback: boolean
  dailyLimit: number
}): Promise<void> {
  await db
    .insert(sourceSetting)
    .values({
      id: ROW,
      webEnabled: input.enabled,
      webPaidFallback: input.paidFallback,
      webDailyLimit: input.dailyLimit,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: sourceSetting.id,
      set: {
        webEnabled: input.enabled,
        webPaidFallback: input.paidFallback,
        webDailyLimit: input.dailyLimit,
        updatedAt: new Date(),
      },
    })
  log.info('web', 'настройки поиска изменены', {
    enabled: input.enabled,
    paidFallback: input.paidFallback,
  })
}

/** Проверка связи: ищем заведомо существующий номер. */
export async function checkWebSearch(
  userId: string,
): Promise<{ ok: boolean; message: string }> {
  const probe = '9785171636951'
  try {
    let found = 0
    await spendSearch(userId, async () => {
      const hits = await searchWeb(`ISBN ${probe}`)
      found = hits.length
      return `${hits.length} результатов`
    })
    return {
      ok: found > 0,
      message:
        found > 0
          ? `${found} результатов`
          : 'поиск ответил, но ничего не нашёл по тестовому номеру',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Открытые теги страницы: у магазинов там обложка и краткое описание. */
export function parseOpenGraph(html: string): {
  image: string | null
  description: string | null
} {
  const meta = (names: Array<string>): string | null => {
    for (const name of names) {
      const pattern = new RegExp(
        `<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`,
        'i',
      )
      const tag = pattern.exec(html)?.[0]
      const value = tag ? /content=["']([^"']+)["']/i.exec(tag)?.[1] : null
      if (value?.trim()) return value.trim()
    }
    return null
  }
  return {
    image: meta(['og:image', 'twitter:image']),
    description: meta(['og:description', 'description']),
  }
}

/** Читаем страницу, на которой встретился номер. Best-effort. */
export async function fetchOpenGraph(url: string): Promise<{
  image: string | null
  description: string | null
}> {
  try {
    const res = await fetch(url, {
      headers: {
        // без человекоподобного агента магазины отдают заглушку
        'user-agent':
          'Mozilla/5.0 (compatible; PolkaBot/1.0; +https://polka.saviny.ru)',
        accept: 'text/html',
      },
      signal: AbortSignal.timeout(7000),
    })
    if (!res.ok) return { image: null, description: null }
    const html = (await res.text()).slice(0, 200_000)
    return parseOpenGraph(html)
  } catch {
    return { image: null, description: null }
  }
}

/**
 * Текст страницы для чтения моделью (M32).
 *
 * Сниппет выдачи — две строки вроде «ISBN 9789859051586. Тематика.
 * Воспитание и педагогика»: ни аннотации, ни нормальных ФИО автора там нет.
 * А на самой странице лежит всё — издательство, серия, год, объём, описание.
 * Поэтому в найденную страницу проваливаемся и читаем её целиком.
 */
export function htmlToText(html: string): string {
  return (
    html
      // служебные блоки выкидываем целиком: в них нет данных о книге,
      // зато есть километры кода, которые съели бы весь контекст модели
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // таблица характеристик — главный источник: строки не должны слипаться
      .replace(/<\/(tr|li|p|div|h[1-6]|dt|dd|section)>/gi, '\n')
      .replace(/<\/(td|th|span)>/gi, ' · ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/·\s*·/g, '·')
      .replace(/\n{2,}/g, '\n')
      .trim()
  )
}

/** Скачать страницу и вычистить до читаемого текста. Best-effort. */
export async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        // без человекоподобного агента магазины отдают заглушку
        'user-agent':
          'Mozilla/5.0 (compatible; PolkaBot/1.0; +https://polka.saviny.ru)',
        accept: 'text/html',
      },
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) {
      log.info('find', 'страница не отдалась', { url, status: res.status })
      return null
    }
    const html = (await res.text()).slice(0, 400_000)
    const text = htmlToText(html)
    return text.length > 0 ? text : null
  } catch (error) {
    log.info('find', 'страница не прочиталась', {
      url,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Разбор выдачи Яндекс Картинок: ссылки на сами изображения. */
export function parseImageXml(xml: string): Array<string> {
  const urls: Array<string> = []
  for (const match of xml.matchAll(
    /<image-link>([\s\S]*?)<\/image-link>|<original[^>]*\surl="([^"]+)"/g,
  )) {
    const raw = (match[1] ?? match[2] ?? '').replace(/&amp;/g, '&').trim()
    if (raw.startsWith('http')) urls.push(raw)
  }
  return urls
}

/**
 * Обложки через Яндекс Картинки — кандидаты для свайпа. Best-effort: любая
 * ошибка — пустой список.
 */
export async function searchCoverImages(
  query: string,
  limit = 3,
): Promise<Array<string>> {
  const creds = await aiCredentials()
  if (!creds) return []
  try {
    const res = await fetch(`${SEARCH_HOST}/v2/image/search`, {
      method: 'POST',
      headers: {
        authorization: `Api-Key ${creds.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: { searchType: 'SEARCH_TYPE_RU', queryText: query, page: '0' },
        folderId: creds.folderId,
        responseFormat: 'FORMAT_XML',
      }),
      signal: AbortSignal.timeout(12_000),
    })
    const raw = await res.text()
    if (!res.ok) {
      log.info('web', 'картинки недоступны', {
        status: res.status,
        body: raw.slice(0, 160),
      })
      return []
    }
    const data = JSON.parse(raw) as {
      rawData?: string
      response?: { rawData?: string }
    }
    const xml = data.response?.rawData ?? data.rawData
    if (!xml) return []
    const urls = parseImageXml(Buffer.from(xml, 'base64').toString('utf8'))
    return urls.slice(0, limit)
  } catch (error) {
    log.info('web', 'картинки не ответили', {
      message: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}
