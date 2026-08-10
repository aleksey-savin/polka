import { and, asc, eq, max } from 'drizzle-orm'

import { db } from '@/db'
import { book, library, shelf } from '@/db/schema/catalog'
import { AppError } from './errors'
import { assertMember } from './members'
import { shelfTint } from './shelfTint'
import type { ShelfTint } from './shelfTint'

export async function createShelf(
  userId: string,
  input: { libraryId: string; name: string },
): Promise<{ id: string }> {
  await assertMember(userId, input.libraryId)
  const [posRow] = await db
    .select({ maxPos: max(shelf.position) })
    .from(shelf)
    .where(eq(shelf.libraryId, input.libraryId))
  const existing = await db
    .select({ id: shelf.id })
    .from(shelf)
    .where(
      and(eq(shelf.libraryId, input.libraryId), eq(shelf.name, input.name)),
    )
  if (existing.length > 0)
    throw new AppError('Полка с таким названием уже есть в этой библиотеке')
  const [created] = await db
    .insert(shelf)
    .values({
      libraryId: input.libraryId,
      name: input.name,
      position: (posRow?.maxPos ?? 0) + 1,
    })
    .returning({ id: shelf.id })
  if (!created) throw new AppError('Не удалось создать полку')
  return created
}

export async function updateShelf(
  userId: string,
  shelfId: string,
  patch: { name?: string; accentColor?: string | null },
): Promise<void> {
  const found = await requireShelf(userId, shelfId)
  await db
    .update(shelf)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.accentColor !== undefined
        ? { accentColor: patch.accentColor }
        : {}),
    })
    .where(eq(shelf.id, found.id))
}

export async function deleteShelf(
  userId: string,
  shelfId: string,
): Promise<void> {
  const found = await requireShelf(userId, shelfId)
  // Книги полки остаются в библиотеке: FK set null → «Неразобранное».
  await db.delete(shelf).where(eq(shelf.id, found.id))
}

async function requireShelf(userId: string, shelfId: string) {
  const [found] = await db
    .select({ id: shelf.id, libraryId: shelf.libraryId })
    .from(shelf)
    .where(eq(shelf.id, shelfId))
  if (!found) throw new AppError('Полка не найдена', 'not_found')
  await assertMember(userId, found.libraryId)
  return found
}

export interface ShelfView {
  id: string
  name: string
  accentColor: string | null
  libraryId: string
  libraryName: string
  tint: ShelfTint
  books: Array<{
    id: string
    title: string
    authors: string
    year: number | null
    pages: number | null
    seriesId: string | null
    seriesNumber: string | null
    coverPath: string | null
  }>
}

export async function getShelfView(
  userId: string,
  shelfId: string,
): Promise<ShelfView> {
  const found = await requireShelf(userId, shelfId)
  const [meta] = await db
    .select({
      id: shelf.id,
      name: shelf.name,
      accentColor: shelf.accentColor,
      libraryName: library.name,
    })
    .from(shelf)
    .innerJoin(library, eq(library.id, shelf.libraryId))
    .where(eq(shelf.id, shelfId))
  if (!meta) throw new AppError('Полка не найдена', 'not_found')
  const books = await db
    .select({
      id: book.id,
      title: book.title,
      authors: book.authors,
      year: book.year,
      pages: book.pages,
      seriesId: book.seriesId,
      seriesNumber: book.seriesNumber,
      coverPath: book.coverPath,
    })
    .from(book)
    .where(and(eq(book.shelfId, shelfId), eq(book.status, 'in_library')))
    .orderBy(asc(book.createdAt))
  return {
    id: meta.id,
    name: meta.name,
    accentColor: meta.accentColor,
    libraryId: found.libraryId,
    libraryName: meta.libraryName,
    tint: shelfTint(books.map((b) => b.year)),
    books,
  }
}
