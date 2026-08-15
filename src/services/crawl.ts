import { and, asc, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm'

import { db } from '@/db'
import { author, crawlTask, refWorkAuthor } from '@/db/schema/catalog'
import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import { saveAuthorPhotoFromUrl } from './covers'
import { linkCycleChild } from './cycles'
import { stripBb } from './metadata/fantlab'
import { stripHtml } from './metadata/types'
import { ensureRefWork, linkWorkAuthor } from './reference'
import { POLKA_USER_AGENT } from './userAgent'

/**
 * Фоновое наполнение эталона: медленный воркер в server-процессе.
 * Щадим источники: одна задача за тик, паузы с джиттером между запросами,
 * ретраи с бэкофом. Выключатель — env CRAWL_ENABLED=0.
 */

const TICK_MS = 75_000
const MAX_ATTEMPTS = 3
const NON_WORK_TYPES =
  /стать|эссе|предислов|послеслов|коммент|интервью|примечан|отрыв|микрорассказ|прочие|антолог/i

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const pause = () => sleep(4000 + Math.random() * 2500)

async function fetchJson(url: string): Promise<unknown | null> {
  const started = performance.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': POLKA_USER_AGENT },
      signal: AbortSignal.timeout(12_000),
    })
    const ms = Math.round(performance.now() - started)
    if (!res.ok) {
      log.warn('crawl', 'источник ответил ошибкой', {
        url,
        status: res.status,
        ms,
      })
      return null
    }
    const text = await res.text()
    if (!text.trim()) {
      log.warn('crawl', 'источник ответил пустотой', { url, ms })
      return null
    }
    log.debug('crawl', 'ответ получен', { url, ms, bytes: text.length })
    return JSON.parse(text) as unknown
  } catch (error) {
    log.warn('crawl', 'запрос не удался', {
      url,
      error: error instanceof Error ? error : new Error(String(error)),
      ms: Math.round(performance.now() - started),
    })
    return null
  }
}

/** Постановщик: авторам с внешними ID — по задаче на библиографию. */
async function ensureCrawlTasks(): Promise<void> {
  const flAuthors = await db
    .select({ id: author.id })
    .from(author)
    .where(
      and(
        isNotNull(author.fantlabId),
        sql`not exists (select 1 from ${crawlTask} where ${crawlTask.authorId} = ${author.id} and ${crawlTask.source} = 'fantlab')`,
      ),
    )
  for (const a of flAuthors) {
    await db
      .insert(crawlTask)
      .values({
        kind: 'author-bibliography',
        source: 'fantlab',
        authorId: a.id,
      })
      .onConflictDoNothing()
  }
  // OpenLibrary — только для авторов, которых FantLab не знает
  const olAuthors = await db
    .select({ id: author.id })
    .from(author)
    .where(
      and(
        isNotNull(author.openlibraryId),
        isNull(author.fantlabId),
        sql`not exists (select 1 from ${crawlTask} where ${crawlTask.authorId} = ${author.id} and ${crawlTask.source} = 'openlibrary')`,
      ),
    )
  for (const a of olAuthors) {
    await db
      .insert(crawlTask)
      .values({
        kind: 'author-bibliography',
        source: 'openlibrary',
        authorId: a.id,
      })
      .onConflictDoNothing()
  }
}

/** Узел дерева циклов FantLab (cycles_blocks). */
export interface CycleNode {
  work_id?: number
  work_name?: string
  work_year?: number
  work_type_name?: string
  children?: Array<CycleNode>
}

/** Состав цикла по порядку чтения; вложенные подциклы разворачиваем в плоский
    список, произведения без русского названия пропускаем. */
export function flattenCycle(
  nodes: Array<CycleNode> | undefined,
): Array<CycleNode> {
  const out: Array<CycleNode> = []
  for (const node of nodes ?? []) {
    if (node.work_type_name === 'cycle') {
      out.push(...flattenCycle(node.children))
      continue
    }
    if (!node.work_id || !node.work_name?.trim()) continue
    out.push(node)
  }
  return out
}

const yearOf = (value: unknown): number | null => {
  if (typeof value !== 'string') return null
  const m = /(1[5-9]|20)\d{2}/.exec(value)
  return m ? Number(m[0]) : null
}

/** FantLab: обогащение автора + произведения из works_blocks. */
async function crawlFantlabAuthor(authorRow: {
  id: string
  fantlabId: number | null
  photoPath: string | null
}): Promise<void> {
  const data = (await fetchJson(
    `https://api.fantlab.ru/autor/${authorRow.fantlabId}/extended`,
  )) as {
    biography?: string
    birthday?: string
    deathday?: string
    country_name?: string
    image?: string
    works_blocks?: Record<
      string,
      {
        list?: Array<{
          work_id?: number
          work_name?: string
          work_year?: number
          work_type_name?: string
          lang_id?: number
        }>
      }
    >
    cycles_blocks?: Record<string, { list?: Array<CycleNode> }>
  } | null
  if (!data) throw new Error('fantlab: пустой ответ')

  const patch: Record<string, unknown> = {}
  if (typeof data.biography === 'string' && data.biography.trim())
    patch.bio = stripHtml(stripBb(data.biography))
  const birth = yearOf(data.birthday)
  const death = yearOf(data.deathday)
  if (birth) patch.birthYear = birth
  if (death) patch.deathYear = death
  if (typeof data.country_name === 'string' && data.country_name)
    patch.country = data.country_name
  if (
    !authorRow.photoPath &&
    typeof data.image === 'string' &&
    data.image.startsWith('/')
  ) {
    await pause()
    const photoPath = await saveAuthorPhotoFromUrl(
      authorRow.id,
      `https://fantlab.ru${data.image}`,
    )
    if (photoPath) patch.photoPath = photoPath
  }
  if (Object.keys(patch).length > 0) {
    await db.update(author).set(patch).where(eq(author.id, authorRow.id))
  }

  for (const block of Object.values(data.works_blocks ?? {})) {
    for (const w of block.list ?? []) {
      if (!w.work_id || !w.work_name) continue
      // языкового фильтра здесь нет: lang_id — язык оригинала произведения
      // (у переводных авторов не русский); русскоязычность отбирается на
      // уровне изданий при ленивой загрузке
      if (w.work_type_name && NON_WORK_TYPES.test(w.work_type_name)) continue
      const workId = await ensureRefWork(
        'fantlab',
        String(w.work_id),
        w.work_name,
        w.work_year ?? null,
        w.work_type_name ?? null,
      )
      await linkWorkAuthor(workId, authorRow.id)
    }
  }

  // циклы: «Харри Холе», а не издательская серия «Несбё (новое оформление)».
  // Безымянные технические циклы (межавторские проекты) пропускаем.
  for (const block of Object.values(data.cycles_blocks ?? {})) {
    for (const node of block.list ?? []) {
      if (node.work_type_name !== 'cycle') continue
      const name = node.work_name?.trim()
      if (!node.work_id || !name) continue
      const children = flattenCycle(node.children)
      if (children.length < 2) continue
      const cycleId = await ensureRefWork(
        'fantlab',
        String(node.work_id),
        name,
        null,
        'cycle',
      )
      await linkWorkAuthor(cycleId, authorRow.id)
      let position = 0
      for (const child of children) {
        const childId = await ensureRefWork(
          'fantlab',
          String(child.work_id),
          child.work_name ?? '',
          child.work_year ?? null,
          child.work_type_name ?? null,
        )
        await linkWorkAuthor(childId, authorRow.id)
        await linkCycleChild(cycleId, childId, ++position)
      }
    }
  }
}

/** OpenLibrary: био + произведения (fallback для неизвестных FantLab). */
async function crawlOpenlibraryAuthor(authorRow: {
  id: string
  openlibraryId: string | null
  photoPath: string | null
}): Promise<void> {
  const olid = authorRow.openlibraryId?.replace(/^\/authors\//, '')
  const info = (await fetchJson(
    `https://openlibrary.org/authors/${olid}.json`,
  )) as {
    bio?: string | { value?: string }
    birth_date?: string
    death_date?: string
    photos?: Array<number>
  } | null
  if (!info) throw new Error('openlibrary: пустой ответ')

  const patch: Record<string, unknown> = {}
  const bio = typeof info.bio === 'string' ? info.bio : info.bio?.value
  if (bio?.trim()) patch.bio = stripHtml(stripBb(bio))
  const birth = yearOf(info.birth_date)
  const death = yearOf(info.death_date)
  if (birth) patch.birthYear = birth
  if (death) patch.deathYear = death
  const photoId = info.photos?.find((p) => p > 0)
  if (!authorRow.photoPath && photoId) {
    await pause()
    const photoPath = await saveAuthorPhotoFromUrl(
      authorRow.id,
      `https://covers.openlibrary.org/a/id/${photoId}-M.jpg`,
    )
    if (photoPath) patch.photoPath = photoPath
  }
  if (Object.keys(patch).length > 0) {
    await db.update(author).set(patch).where(eq(author.id, authorRow.id))
  }

  await pause()
  const works = (await fetchJson(
    `https://openlibrary.org/authors/${olid}/works.json?limit=100`,
  )) as { entries?: Array<{ key?: string; title?: string }> } | null
  for (const w of works?.entries ?? []) {
    if (!w.key || !w.title) continue
    const workId = await ensureRefWork('openlibrary', w.key, w.title)
    await linkWorkAuthor(workId, authorRow.id)
  }
}

async function runNextTask(): Promise<void> {
  const [task] = await db
    .select()
    .from(crawlTask)
    .where(
      and(
        eq(crawlTask.status, 'pending'),
        lte(crawlTask.scheduledAt, new Date()),
      ),
    )
    .orderBy(asc(crawlTask.scheduledAt))
    .limit(1)
  if (!task) return

  const [authorRow] = await db
    .select()
    .from(author)
    .where(eq(author.id, task.authorId))
  if (!authorRow) {
    await db
      .update(crawlTask)
      .set({ status: 'failed', error: 'автор удалён', doneAt: new Date() })
      .where(eq(crawlTask.id, task.id))
    return
  }

  const started = performance.now()
  log.info('crawl', 'задача взята', {
    source: task.source,
    author: authorRow.name,
    attempt: task.attempts + 1,
  })
  try {
    if (task.source === 'fantlab') await crawlFantlabAuthor(authorRow)
    else await crawlOpenlibraryAuthor(authorRow)
    await db
      .update(crawlTask)
      .set({ status: 'done', doneAt: new Date(), error: null })
      .where(eq(crawlTask.id, task.id))
    log.info('crawl', 'задача выполнена', {
      source: task.source,
      author: authorRow.name,
      ms: Math.round(performance.now() - started),
    })
  } catch (e) {
    const attempts = task.attempts + 1
    await db
      .update(crawlTask)
      .set({
        attempts,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        // бэкоф: следующая попытка через attempts × 6 часов
        scheduledAt: new Date(Date.now() + attempts * 6 * 60 * 60 * 1000),
        error: e instanceof Error ? e.message : String(e),
      })
      .where(eq(crawlTask.id, task.id))
    log.error('crawl', 'задача упала', {
      source: task.source,
      author: authorRow.name,
      attempt: attempts,
      error: e instanceof Error ? e : new Error(String(e)),
      ms: Math.round(performance.now() - started),
    })
  }
}

declare global {
  var __polkaCrawlStarted: boolean | undefined
}

/** Запуск воркера (одна инстанция на процесс, guard от dev-перезагрузок). */
export function startCrawlWorker(): void {
  if (env.CRAWL_ENABLED !== '1') {
    log.info('crawl', 'воркер выключен (CRAWL_ENABLED != 1)')
    return
  }
  if (globalThis.__polkaCrawlStarted) return
  globalThis.__polkaCrawlStarted = true
  log.info('crawl', 'воркер запущен', { tickMs: TICK_MS })

  const tick = async () => {
    try {
      await ensureCrawlTasks()
      await runNextTask()
    } catch (error) {
      // воркер не должен ронять процесс, но и молчать ему нельзя
      log.error('crawl', 'тик воркера упал', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }
  // первый тик с задержкой — не мешаем старту приложения
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), TICK_MS + Math.random() * 15_000)
  }, 20_000)
}

/** Не используется в UI — регистрация связи для crawl (реэкспорт удобства). */
export { refWorkAuthor }
