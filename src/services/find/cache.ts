import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { lookupCache } from '@/db/schema/circulation'
import { log } from '@/lib/logger'
import type { FindResult, SourceKey } from './types'

/**
 * Кэш поиска, привязанный к настройкам (M32).
 *
 * Раньше кэш хранил результат без отметки, при каком составе источников он
 * получен: выключаешь Google — а кэш продолжает отдавать его данные, и
 * настройка не работает задним числом. Теперь ключ кэша — номер плюс
 * отпечаток цепочки.
 */

const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 дней
/** Версия формата записи: при смене структуры старое просто промахивается. */
const VERSION = 3

/** Отпечаток цепочки: состав и порядок. */
export function chainFingerprint(order: Array<SourceKey>): string {
  return `v${VERSION}:${order.join('>')}`
}

export async function readCache(
  isbn13: string,
  fingerprint: string,
): Promise<FindResult | null> {
  const [row] = await db
    .select()
    .from(lookupCache)
    .where(eq(lookupCache.isbn13, isbn13))
  if (!row || row.chain !== fingerprint) return null
  if (Date.now() - row.fetchedAt.getTime() > TTL_MS) return null
  try {
    const parsed = JSON.parse(row.rawJson) as FindResult
    return { ...parsed, cached: true }
  } catch (error) {
    // битая запись — аномалия: поиск переживёт, но знать о ней надо
    log.warn('find', 'битая запись кэша', {
      isbn: isbn13,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function writeCache(
  isbn13: string,
  fingerprint: string,
  result: FindResult,
): Promise<void> {
  // оборванная по бюджету цепочка — не ответ: закэшировав её, мы бы навсегда
  // лишили книгу платных ступеней
  if (result.truncated) return
  const rawJson = JSON.stringify({ ...result, cached: false })
  const values = {
    source: result.found.join(','),
    chain: fingerprint,
    rawJson,
    fetchedAt: new Date(),
  }
  await db
    .insert(lookupCache)
    .values({ isbn13, ...values })
    .onConflictDoUpdate({ target: lookupCache.isbn13, set: values })
}
