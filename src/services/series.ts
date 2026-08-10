import { and, asc, eq, inArray, like, or } from 'drizzle-orm'

import { db } from '@/db'
import { book, libraryMember, series } from '@/db/schema/catalog'
import { AppError } from './errors'
import { memberLibraryIds } from './members'
import { normalizeForSearch } from './search'

/** id пользователей, с которыми есть общие библиотеки (включая себя) — их серии видны и переиспользуются. */
export async function coMemberUserIds(userId: string): Promise<Array<string>> {
  const libIds = await memberLibraryIds(userId)
  if (libIds.length === 0) return [userId]
  const rows = await db
    .selectDistinct({ userId: libraryMember.userId })
    .from(libraryMember)
    .where(inArray(libraryMember.libraryId, libIds))
  const ids = new Set(rows.map((r) => r.userId))
  ids.add(userId)
  return [...ids]
}

/** Найти серию по имени среди своих и совладельческих, иначе создать свою. */
export async function resolveSeriesByName(
  userId: string,
  name: string,
): Promise<string | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  const nameNorm = normalizeForSearch(trimmed)
  const owners = await coMemberUserIds(userId)
  const [existing] = await db
    .select({ id: series.id })
    .from(series)
    .where(and(inArray(series.ownerId, owners), eq(series.nameNorm, nameNorm)))
  if (existing) return existing.id
  const [created] = await db
    .insert(series)
    .values({ ownerId: userId, name: trimmed, nameNorm })
    .returning({ id: series.id })
  if (!created) throw new AppError('Не удалось создать серию')
  return created.id
}

export interface SeriesListItem {
  id: string
  name: string
  bookCount: number
}

/** Серии с количеством доступных пользователю книг. */
export async function listSeries(
  userId: string,
): Promise<Array<SeriesListItem>> {
  const libIds = await memberLibraryIds(userId)
  const accessibleBook = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    eq(book.addedBy, userId),
  )
  const rows = await db
    .select({ id: series.id, name: series.name, bookId: book.id })
    .from(series)
    .leftJoin(book, and(eq(book.seriesId, series.id), accessibleBook))
    .where(inArray(series.ownerId, await coMemberUserIds(userId)))
    .orderBy(asc(series.nameNorm))
  const map = new Map<string, SeriesListItem>()
  for (const r of rows) {
    const item = map.get(r.id) ?? { id: r.id, name: r.name, bookCount: 0 }
    if (r.bookId) item.bookCount += 1
    map.set(r.id, item)
  }
  return [...map.values()]
}

export interface SeriesView {
  id: string
  name: string
  description: string | null
  books: Array<{
    id: string
    title: string
    authors: string
    year: number | null
    seriesNumber: string | null
    coverPath: string | null
    status: string
    libraryId: string | null
  }>
}

/** Числовой разбор номера тома: «3» → 3, «3.5» → 3.5, «3–4» → 3; мусор — в конец. */
export function seriesNumberSortKey(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY
  const match = /\d+(?:[.,]\d+)?/.exec(value)
  if (!match) return Number.POSITIVE_INFINITY
  return Number.parseFloat(match[0].replace(',', '.'))
}

export async function getSeriesView(
  userId: string,
  seriesId: string,
): Promise<SeriesView> {
  const owners = await coMemberUserIds(userId)
  const [meta] = await db
    .select()
    .from(series)
    .where(and(eq(series.id, seriesId), inArray(series.ownerId, owners)))
  if (!meta) throw new AppError('Серия не найдена', 'not_found')

  const libIds = await memberLibraryIds(userId)
  const rows = await db
    .select({
      id: book.id,
      title: book.title,
      authors: book.authors,
      year: book.year,
      seriesNumber: book.seriesNumber,
      coverPath: book.coverPath,
      status: book.status,
      libraryId: book.libraryId,
    })
    .from(book)
    .where(
      and(
        eq(book.seriesId, seriesId),
        or(
          libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
          eq(book.addedBy, userId),
        ),
      ),
    )
  rows.sort((a, b) => {
    const diff =
      seriesNumberSortKey(a.seriesNumber) - seriesNumberSortKey(b.seriesNumber)
    if (diff !== 0) return diff
    return a.title.localeCompare(b.title, 'ru')
  })
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    books: rows,
  }
}

/** Автокомплит серий для формы книги. */
export async function suggestSeries(
  userId: string,
  query: string,
): Promise<Array<{ id: string; name: string }>> {
  const q = sanitizeLike(normalizeForSearch(query))
  if (!q) return []
  const owners = await coMemberUserIds(userId)
  return db
    .select({ id: series.id, name: series.name })
    .from(series)
    .where(
      and(inArray(series.ownerId, owners), like(series.nameNorm, `%${q}%`)),
    )
    .orderBy(asc(series.nameNorm))
    .limit(8)
}

/** LIKE-спецсимволы в пользовательском запросе не нужны — заменяем на пробел. */
export function sanitizeLike(value: string): string {
  return value
    .replace(/[%_\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
