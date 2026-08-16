import { and, count, desc, eq, inArray, isNotNull, or } from 'drizzle-orm'

import { db } from '@/db'
import { book, library, shelf } from '@/db/schema/catalog'
import { AppError } from './errors'
import { memberLibraryIds } from './members'
import { normalizeForSearch } from './search'
import { syncBookAuthors } from './authors'

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
  return rows
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

  const { lookupIsbn } = await import('./metadata/lookup')
  const { saveCoverFromUrl } = await import('./covers')
  const { resolveSeriesByName } = await import('./series')

  let resolved = 0
  let missed = 0
  for (const row of rows) {
    const result = await lookupIsbn(userId, row.isbn13!)
    const draft = result.draft
    if (!draft.title?.trim()) {
      missed++
      continue
    }
    const seriesId = draft.seriesName
      ? await resolveSeriesByName(userId, draft.seriesName)
      : null
    await db
      .update(book)
      .set({
        title: draft.title.trim(),
        titleNorm: normalizeForSearch(draft.title),
        authors: draft.authors ?? '',
        authorsNorm: normalizeForSearch(draft.authors ?? ''),
        publisher: draft.publisher ?? null,
        year: draft.year ?? null,
        pages: draft.pages ?? null,
        annotation: draft.annotation ?? null,
        language: draft.language ?? 'ru',
        coverType: draft.coverType ?? null,
        heightMm: draft.heightMm ?? null,
        seriesId,
        unrecognized: false,
        updatedAt: new Date(),
      })
      .where(eq(book.id, row.id))
    await syncBookAuthors(row.id, draft.authors ?? '', draft.fantlabAuthors)
    if (!row.coverPath && draft.coverUrl) {
      try {
        const saved = await saveCoverFromUrl(row.id, draft.coverUrl)
        await db
          .update(book)
          .set({ coverPath: saved.path, coverColor: saved.color })
          .where(eq(book.id, row.id))
      } catch {
        // обложка — best-effort, карточка уже дозаполнена
      }
    }
    resolved++
  }
  return { resolved, missed }
}
