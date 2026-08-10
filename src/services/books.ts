import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import { book, bookTag, library, series, shelf, tag } from '@/db/schema/catalog'
import { deleteCover, saveCoverFromUrl } from './covers'
import { AppError } from './errors'
import { assertMember, memberLibraryIds } from './members'
import { normalizeForSearch } from './search'
import { resolveSeriesByName, sanitizeLike } from './series'
import { setBookTags } from './tags'

export interface BookInput {
  title: string
  authors?: string
  isbn10?: string
  isbn13?: string
  publisher?: string
  year?: number | null
  pages?: number | null
  language?: string
  annotation?: string
  notes?: never // личные заметки живут в book_personal (M5)
  seriesName?: string
  seriesNumber?: string
  tags?: Array<string>
  libraryId?: string | null
  shelfId?: string | null
  wishlist?: boolean
  /** URL обложки из метаданных — скачается на диск при сохранении (best-effort). */
  coverUrl?: string
}

async function assertShelfInLibrary(
  shelfId: string,
  libraryId: string,
): Promise<void> {
  const [found] = await db
    .select({ libraryId: shelf.libraryId })
    .from(shelf)
    .where(eq(shelf.id, shelfId))
  if (!found || found.libraryId !== libraryId) {
    throw new AppError('Полка не из этой библиотеки', 'invalid')
  }
}

async function placementFor(
  userId: string,
  input: Pick<BookInput, 'libraryId' | 'shelfId' | 'wishlist'>,
): Promise<{
  libraryId: string | null
  shelfId: string | null
  status: 'in_library' | 'wishlist'
}> {
  if (input.wishlist)
    return { libraryId: null, shelfId: null, status: 'wishlist' }
  if (!input.libraryId)
    throw new AppError('Выберите библиотеку или отметьте «Хочу»', 'invalid')
  await assertMember(userId, input.libraryId)
  if (input.shelfId) await assertShelfInLibrary(input.shelfId, input.libraryId)
  return {
    libraryId: input.libraryId,
    shelfId: input.shelfId ?? null,
    status: 'in_library',
  }
}

export async function createBook(
  userId: string,
  input: BookInput,
): Promise<{ id: string }> {
  const placement = await placementFor(userId, input)
  const seriesId = input.seriesName
    ? await resolveSeriesByName(userId, input.seriesName)
    : null
  const [created] = await db
    .insert(book)
    .values({
      addedBy: userId,
      libraryId: placement.libraryId,
      shelfId: placement.shelfId,
      status: placement.status,
      title: input.title.trim(),
      authors: input.authors?.trim() ?? '',
      isbn10: input.isbn10?.trim() || null,
      isbn13: input.isbn13?.trim() || null,
      publisher: input.publisher?.trim() || null,
      year: input.year ?? null,
      pages: input.pages ?? null,
      language: input.language?.trim() || 'ru',
      annotation: input.annotation?.trim() || null,
      seriesId,
      seriesNumber: input.seriesNumber?.trim() || null,
      titleNorm: normalizeForSearch(input.title),
      authorsNorm: normalizeForSearch(input.authors ?? ''),
    })
    .returning({ id: book.id })
  if (!created) throw new AppError('Не удалось сохранить книгу')
  if (input.tags) await setBookTags(userId, created.id, input.tags)
  if (input.coverUrl) {
    try {
      const coverPath = await saveCoverFromUrl(created.id, input.coverUrl)
      await db.update(book).set({ coverPath }).where(eq(book.id, created.id))
    } catch {
      // обложка — best-effort: карточка сохраняется и без неё
    }
  }
  return created
}

/** Книга доступна: участник её библиотеки, либо это свой виш-лист. */
export async function requireBookAccess(userId: string, bookId: string) {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  if (row.libraryId) {
    await assertMember(userId, row.libraryId)
  } else if (row.addedBy !== userId) {
    throw new AppError('Нет доступа к этой книге', 'forbidden')
  }
  return row
}

export async function updateBook(
  userId: string,
  bookId: string,
  input: BookInput,
): Promise<void> {
  const current = await requireBookAccess(userId, bookId)
  const placement = await placementFor(userId, input)
  const seriesId = input.seriesName
    ? await resolveSeriesByName(userId, input.seriesName)
    : null
  await db
    .update(book)
    .set({
      libraryId: placement.libraryId,
      shelfId: placement.shelfId,
      status:
        current.status === 'gifted' || current.status === 'lost'
          ? current.status // владельческий статус в M3 не трогаем — переходы в M5
          : placement.status,
      title: input.title.trim(),
      authors: input.authors?.trim() ?? '',
      isbn10: input.isbn10?.trim() || null,
      isbn13: input.isbn13?.trim() || null,
      publisher: input.publisher?.trim() || null,
      year: input.year ?? null,
      pages: input.pages ?? null,
      language: input.language?.trim() || 'ru',
      annotation: input.annotation?.trim() || null,
      seriesId,
      seriesNumber: input.seriesNumber?.trim() || null,
      titleNorm: normalizeForSearch(input.title),
      authorsNorm: normalizeForSearch(input.authors ?? ''),
      updatedAt: new Date(),
    })
    .where(eq(book.id, bookId))
  if (input.tags) await setBookTags(userId, bookId, input.tags)
}

export async function deleteBook(
  userId: string,
  bookId: string,
): Promise<void> {
  const row = await requireBookAccess(userId, bookId)
  await db.delete(book).where(eq(book.id, bookId))
  if (row.coverPath) await deleteCover(row.coverPath)
}

/** Массовое перемещение: на полку/в «Неразобранное» целевой библиотеки. Виш-лист при этом «куплен». */
export async function moveBooks(
  userId: string,
  bookIds: Array<string>,
  target: { libraryId: string; shelfId: string | null },
): Promise<void> {
  if (bookIds.length === 0) return
  await assertMember(userId, target.libraryId)
  if (target.shelfId)
    await assertShelfInLibrary(target.shelfId, target.libraryId)
  for (const id of bookIds) await requireBookAccess(userId, id)
  await db
    .update(book)
    .set({
      libraryId: target.libraryId,
      shelfId: target.shelfId,
      status: sql`CASE WHEN ${book.status} = 'wishlist' THEN 'in_library' ELSE ${book.status} END`,
      updatedAt: new Date(),
    })
    .where(inArray(book.id, bookIds))
}

export interface BookCard {
  id: string
  title: string
  authors: string
  isbn10: string | null
  isbn13: string | null
  publisher: string | null
  year: number | null
  pages: number | null
  language: string
  annotation: string | null
  coverPath: string | null
  status: string
  seriesId: string | null
  seriesName: string | null
  seriesNumber: string | null
  libraryId: string | null
  libraryName: string | null
  shelfId: string | null
  shelfName: string | null
  tags: Array<string>
  addedBy: string
}

export async function getBookCard(
  userId: string,
  bookId: string,
): Promise<BookCard> {
  const row = await requireBookAccess(userId, bookId)
  const [joined] = await db
    .select({
      seriesName: series.name,
      libraryName: library.name,
      shelfName: shelf.name,
    })
    .from(book)
    .leftJoin(series, eq(series.id, book.seriesId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .where(eq(book.id, bookId))
  if (!joined) throw new AppError('Книга не найдена', 'not_found')
  const tags = await db
    .select({ name: tag.name })
    .from(bookTag)
    .innerJoin(tag, eq(tag.id, bookTag.tagId))
    .where(eq(bookTag.bookId, bookId))
    .orderBy(asc(tag.name))
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    isbn10: row.isbn10,
    isbn13: row.isbn13,
    publisher: row.publisher,
    year: row.year,
    pages: row.pages,
    language: row.language,
    annotation: row.annotation,
    coverPath: row.coverPath,
    status: row.status,
    seriesId: row.seriesId,
    seriesName: joined.seriesName,
    seriesNumber: row.seriesNumber,
    libraryId: row.libraryId,
    libraryName: joined.libraryName,
    shelfId: row.shelfId,
    shelfName: joined.shelfName,
    tags: tags.map((t) => t.name),
    addedBy: row.addedBy,
  }
}

export interface CatalogFilters {
  query?: string
  libraryId?: string
  shelfId?: string | 'unsorted'
  seriesId?: string
  tagId?: string
  status?: 'in_library' | 'wishlist' | 'gifted' | 'lost'
}

export interface CatalogRow {
  id: string
  title: string
  authors: string
  year: number | null
  pages: number | null
  status: string
  coverPath: string | null
  seriesName: string | null
  libraryName: string | null
  shelfName: string | null
}

const CATALOG_LIMIT = 500

export async function listBooks(
  userId: string,
  filters: CatalogFilters,
): Promise<{ rows: Array<CatalogRow>; total: number }> {
  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    and(eq(book.addedBy, userId), eq(book.status, 'wishlist')),
  )

  const conditions = [accessible]
  if (filters.libraryId) conditions.push(eq(book.libraryId, filters.libraryId))
  if (filters.shelfId === 'unsorted') {
    conditions.push(sql`${book.shelfId} IS NULL`, eq(book.status, 'in_library'))
  } else if (filters.shelfId) {
    conditions.push(eq(book.shelfId, filters.shelfId))
  }
  if (filters.seriesId) conditions.push(eq(book.seriesId, filters.seriesId))
  if (filters.status) conditions.push(eq(book.status, filters.status))
  if (filters.tagId) {
    conditions.push(
      sql`exists (select 1 from ${bookTag} where ${bookTag.bookId} = ${book.id} and ${bookTag.tagId} = ${filters.tagId})`,
    )
  }
  if (filters.query?.trim()) {
    const q = `%${sanitizeLike(normalizeForSearch(filters.query))}%`
    conditions.push(
      or(
        like(book.titleNorm, q),
        like(book.authorsNorm, q),
        like(series.nameNorm, q),
      ),
    )
  }

  const rows = await db
    .select({
      id: book.id,
      title: book.title,
      authors: book.authors,
      year: book.year,
      pages: book.pages,
      status: book.status,
      coverPath: book.coverPath,
      seriesName: series.name,
      libraryName: library.name,
      shelfName: shelf.name,
    })
    .from(book)
    .leftJoin(series, eq(series.id, book.seriesId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .where(and(...conditions))
    .orderBy(asc(book.titleNorm))
    .limit(CATALOG_LIMIT)
  return { rows, total: rows.length }
}
