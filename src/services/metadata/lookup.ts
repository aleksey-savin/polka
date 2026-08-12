import { eq, inArray, or, and } from 'drizzle-orm'

import { db } from '@/db'
import { book } from '@/db/schema/catalog'
import { lookupCache } from '@/db/schema/circulation'
import { AppError } from '@/services/errors'
import { parseIsbn } from '@/services/isbn'
import { persistLookup, refLookup } from '@/services/reference'
import { memberLibraryIds } from '@/services/members'
import { fetchFantlab } from './fantlab'
import { fetchGoogleBooks } from './googleBooks'
import { mergeResults } from './merge'
import { fetchOpenLibrary } from './openLibrary'
import type { MergedLookup } from './merge'

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 дней
// v2: аннотация FantLab берётся из произведения, а не из примечаний издания
const CACHE_VERSION = 2

export interface LookupResult extends MergedLookup {
  isbn13: string
  isbn10: string | null
  found: boolean
  /** Уже есть в доступных книгах — предупреждение о дубле (дубль сохранить можно). */
  duplicates: Array<{ id: string; title: string }>
}

async function readCache(isbn13: string): Promise<MergedLookup | null> {
  const [row] = await db
    .select()
    .from(lookupCache)
    .where(eq(lookupCache.isbn13, isbn13))
  if (!row) return null
  if (Date.now() - row.fetchedAt.getTime() > CACHE_TTL_MS) return null
  try {
    const parsed = JSON.parse(row.rawJson) as MergedLookup & { v?: number }
    if (parsed.v !== CACHE_VERSION) return null
    return parsed
  } catch {
    return null
  }
}

async function writeCache(isbn13: string, merged: MergedLookup): Promise<void> {
  const rawJson = JSON.stringify({ ...merged, v: CACHE_VERSION })
  await db
    .insert(lookupCache)
    .values({
      isbn13,
      source: merged.sources.join(','),
      rawJson,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: lookupCache.isbn13,
      set: { source: merged.sources.join(','), rawJson, fetchedAt: new Date() },
    })
}

async function findDuplicates(userId: string, isbn13: string) {
  const libIds = await memberLibraryIds(userId)
  return db
    .select({ id: book.id, title: book.title })
    .from(book)
    .where(
      and(
        eq(book.isbn13, isbn13),
        or(
          libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
          eq(book.addedBy, userId),
        ),
      ),
    )
    .limit(5)
}

/** Поиск метаданных по ISBN: кэш → три источника параллельно → merge. */
export async function lookupIsbn(
  userId: string,
  rawIsbn: string,
): Promise<LookupResult> {
  const parsed = parseIsbn(rawIsbn)
  if (!parsed) {
    throw new AppError(
      'Это не похоже на ISBN — проверьте цифры или заполните карточку вручную',
    )
  }

  const duplicates = await findDuplicates(userId, parsed.isbn13)

  // эталонный каталог — первый и вечный источник (независимость от API)
  const refResults = await refLookup(parsed.isbn13)
  if (refResults && refResults.length > 0) {
    const merged = mergeResults(refResults)
    return {
      ...merged,
      ...parsed,
      found: Boolean(merged.draft.title),
      duplicates,
    }
  }

  const cached = await readCache(parsed.isbn13)
  if (cached) {
    return {
      ...cached,
      ...parsed,
      found: Boolean(cached.draft.title),
      duplicates,
    }
  }

  const settled = await Promise.allSettled([
    fetchFantlab(parsed.isbn13),
    fetchGoogleBooks(parsed.isbn13),
    fetchOpenLibrary(parsed.isbn13),
  ])
  const sourceResults = settled.map((s) =>
    s.status === 'fulfilled' ? s.value : null,
  )
  const merged = mergeResults(sourceResults)
  if (merged.sources.length > 0) {
    await writeCache(parsed.isbn13, merged)
    try {
      await persistLookup(parsed.isbn13, parsed.isbn10, sourceResults)
    } catch {
      // эталон — best-effort: неудача записи не ломает добавление книги
    }
  }

  return {
    ...merged,
    ...parsed,
    found: Boolean(merged.draft.title),
    duplicates,
  }
}
