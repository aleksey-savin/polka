import { and, count, desc, eq, inArray, isNotNull, or } from 'drizzle-orm'

import { db } from '@/db'
import { book, library, shelf } from '@/db/schema/catalog'
import { log } from '@/lib/logger'
import { AppError } from './errors'
import { isbnOrigin } from './isbnPrefix'
import { memberLibraryIds } from './members'

/**
 * Книги, отсканированные пачкой: есть ISBN, названия нет (M18).
 * Названием временно служит сам номер — так книга находится поиском и
 * не выглядит пустой строкой. Флаг снимается, как только имя появилось.
 */

export interface UnrecognizedRow {
  id: string
  isbn13: string | null
  createdAt: Date
  libraryName: string | null
  shelfName: string | null
  /** Издательство из префикса номера — известно без всяких источников. */
  publisher: string | null
}

async function accessibleCondition(userId: string) {
  const libIds = await memberLibraryIds(userId)
  return or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    eq(book.addedBy, userId),
  )
}

export async function listUnrecognized(
  userId: string,
): Promise<Array<UnrecognizedRow>> {
  const accessible = await accessibleCondition(userId)
  const rows = await db
    .select({
      id: book.id,
      isbn13: book.isbn13,
      createdAt: book.createdAt,
      libraryName: library.name,
      shelfName: shelf.name,
    })
    .from(book)
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .where(and(accessible, eq(book.unrecognized, true)))
    .orderBy(desc(book.createdAt))
  return rows.map((row) => ({
    ...row,
    publisher: isbnOrigin(row.isbn13).publisher,
  }))
}

export async function countUnrecognized(userId: string): Promise<number> {
  const accessible = await accessibleCondition(userId)
  const [row] = await db
    .select({ n: count() })
    .from(book)
    .where(and(accessible, eq(book.unrecognized, true)))
  return row?.n ?? 0
}

export interface RetryResult {
  /** Сколько книг удалось дозаполнить. */
  resolved: number
  /** Сколько так и не нашлось. */
  missed: number
}

/**
 * Повторный поиск по ISBN — только по кнопке: фоновые попытки молча меняли бы
 * карточки. Возвращаемся к тем же источникам, что и при добавлении.
 */
export async function retryLookup(
  userId: string,
  bookIds: Array<string>,
): Promise<RetryResult> {
  if (bookIds.length === 0) return { resolved: 0, missed: 0 }
  const accessible = await accessibleCondition(userId)
  const rows = await db
    .select({
      id: book.id,
      isbn13: book.isbn13,
      coverPath: book.coverPath,
    })
    .from(book)
    .where(
      and(
        accessible,
        eq(book.unrecognized, true),
        isNotNull(book.isbn13),
        inArray(book.id, bookIds),
      ),
    )
  if (rows.length === 0) throw new AppError('Книги не найдены', 'not_found')

  const { findEdition } = await import('./find/core')
  const { applyDraftToBook } = await import('./bookWriter')
  const { saveCoverFromUrl } = await import('./covers')

  let resolved = 0
  let missed = 0
  for (const row of rows) {
    const found = await findEdition(userId, row.isbn13!)
    if (!found.draft.title?.trim()) {
      missed++
      continue
    }
    // единственный писатель карточки: раньше здесь был свой набор полей,
    // отличавшийся от того, что писал разбор с ИИ
    await applyDraftToBook(row.id, found.draft, { userId })
    if (!row.coverPath && found.draft.coverUrl) {
      try {
        const saved = await saveCoverFromUrl(row.id, found.draft.coverUrl)
        await db
          .update(book)
          .set({ coverPath: saved.path, coverColor: saved.color })
          .where(eq(book.id, row.id))
      } catch (error) {
        // обложка — best-effort, но молчать об отказе нельзя
        log.warn('find', 'обложка не сохранилась', {
          bookId: row.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    resolved++
  }
  return { resolved, missed }
}
