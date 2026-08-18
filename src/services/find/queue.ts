import { asc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { book, findTask } from '@/db/schema/catalog'
import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import { applyDraftToBook } from '@/services/bookWriter'
import { findEdition } from './core'
import { FULL_BUDGET_MS } from './types'
import type { FindOptions } from './types'

/**
 * Доигровка оборванного поиска (M32).
 *
 * В быстром режиме сканирования цепочка обрывается по бюджету, не дойдя до
 * платных ступеней. Книга сохраняется тем, что нашли каталоги, а остаток
 * доигрывает воркер — и сам дописывает карточку. Функция поиска при этом одна
 * и та же: меняется только то, кто её вызывает.
 */

const TICK_MS = 30_000
const MAX_ATTEMPTS = 3

export async function enqueueFind(
  bookId: string,
  userId: string,
  isbn13: string,
): Promise<void> {
  await db
    .insert(findTask)
    .values({ bookId, userId, isbn13 })
    // одна задача на книгу: повторное сканирование не плодит очередь
    .onConflictDoNothing()
  log.info('find', 'книга поставлена на доигровку', { bookId, isbn: isbn13 })
}

export async function runNextFind(options: FindOptions = {}): Promise<void> {
  const [task] = await db
    .select()
    .from(findTask)
    .where(eq(findTask.status, 'pending'))
    .orderBy(asc(findTask.scheduledAt))
    .limit(1)
  if (!task) return

  const attempts = task.attempts + 1
  try {
    const found = await findEdition(task.userId, task.isbn13, {
      ...options,
      budgetMs: FULL_BUDGET_MS,
    })
    if (found.draft.title) {
      // «только пустое»: пока задача ждала, человек мог заполнить карточку сам
      await applyDraftToBook(task.bookId, found.draft, {
        mode: 'fill',
        userId: task.userId,
      })
      if (found.draft.coverUrl) {
        const [row] = await db
          .select({ coverPath: book.coverPath })
          .from(book)
          .where(eq(book.id, task.bookId))
        if (row && !row.coverPath) {
          try {
            const { saveCoverFromUrl } = await import('@/services/covers')
            const saved = await saveCoverFromUrl(
              task.bookId,
              found.draft.coverUrl,
            )
            await db
              .update(book)
              .set({ coverPath: saved.path, coverColor: saved.color })
              .where(eq(book.id, task.bookId))
          } catch (error) {
            // обложка — best-effort, но отказ записываем
            log.warn('find', 'обложка не сохранилась', {
              bookId: task.bookId,
              message: error instanceof Error ? error.message : String(error),
            })
          }
        }
      }
    }
    await db
      .update(findTask)
      .set({ status: 'done', attempts, doneAt: new Date() })
      .where(eq(findTask.id, task.id))
    log.info('find', 'доигровка закончена', {
      bookId: task.bookId,
      isbn: task.isbn13,
      title: found.draft.title ?? 'ничего',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(findTask)
      .set({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        error: message,
      })
      .where(eq(findTask.id, task.id))
    log.error('find', 'доигровка не удалась', {
      bookId: task.bookId,
      isbn: task.isbn13,
      attempt: attempts,
      error: error instanceof Error ? error : new Error(message),
    })
  }
}

declare global {
  var __polkaFindWorkerStarted: boolean | undefined
}

/** Запуск воркера: одна инстанция на процесс, guard от dev-перезагрузок. */
export function startFindWorker(): void {
  if (env.CRAWL_ENABLED !== '1') {
    log.info('find', 'воркер доигровки выключен (CRAWL_ENABLED != 1)')
    return
  }
  if (globalThis.__polkaFindWorkerStarted) return
  globalThis.__polkaFindWorkerStarted = true
  log.info('find', 'воркер доигровки запущен', { tickMs: TICK_MS })

  const tick = async () => {
    try {
      await runNextFind()
    } catch (error) {
      // воркер не должен ронять процесс, но и молчать ему нельзя
      log.error('find', 'тик воркера упал', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), TICK_MS).unref()
  }, 15_000).unref()
}
