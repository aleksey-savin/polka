import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'

import { db } from '@/db'
import { book, library, shelf } from '@/db/schema/catalog'
import { loan } from '@/db/schema/circulation'
import { requireBookAccess } from './books'
import { AppError } from './errors'
import { memberLibraryIds } from './members'

export interface ActiveLoanInfo {
  loanId: string
  borrowerName: string
  lentAt: Date
  dueAt: Date | null
  overdue: boolean
}

function toInfo(row: {
  id: string
  borrowerName: string
  lentAt: Date
  dueAt: Date | null
}): ActiveLoanInfo {
  return {
    loanId: row.id,
    borrowerName: row.borrowerName,
    lentAt: row.lentAt,
    dueAt: row.dueAt,
    overdue: row.dueAt !== null && row.dueAt.getTime() < Date.now(),
  }
}

/** «Дал почитать»: одна активная выдача на книгу (частичный уникальный индекс — страховка). */
export async function lendBook(
  userId: string,
  bookId: string,
  input: { borrowerName: string; dueAt?: Date | null; note?: string },
): Promise<{ id: string }> {
  const row = await requireBookAccess(userId, bookId)
  if (row.status !== 'in_library') {
    throw new AppError(
      'Дать почитать можно только книгу, которая сейчас в библиотеке',
    )
  }
  const [active] = await db
    .select({ id: loan.id, borrowerName: loan.borrowerName })
    .from(loan)
    .where(and(eq(loan.bookId, bookId), isNull(loan.returnedAt)))
  if (active) {
    throw new AppError(
      `Книга уже на руках у «${active.borrowerName}» — сначала отметьте возврат`,
    )
  }
  try {
    const [created] = await db
      .insert(loan)
      .values({
        bookId,
        borrowerName: input.borrowerName.trim(),
        dueAt: input.dueAt ?? null,
        note: input.note?.trim() || null,
      })
      .returning({ id: loan.id })
    if (!created) throw new AppError('Не удалось записать выдачу')
    return created
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('Книга уже на руках — обновите страницу') // гонка: сработал индекс
  }
}

export async function returnLoan(
  userId: string,
  loanId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: loan.id, bookId: loan.bookId, returnedAt: loan.returnedAt })
    .from(loan)
    .where(eq(loan.id, loanId))
  if (!row) throw new AppError('Выдача не найдена', 'not_found')
  await requireBookAccess(userId, row.bookId)
  if (row.returnedAt) return // идемпотентно
  await db
    .update(loan)
    .set({ returnedAt: new Date() })
    .where(eq(loan.id, loanId))
}

/** Активные выдачи для набора книг: bookId → информация (штампы в списках). */
export async function activeLoansFor(
  bookIds: Array<string>,
): Promise<Map<string, ActiveLoanInfo>> {
  if (bookIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: loan.id,
      bookId: loan.bookId,
      borrowerName: loan.borrowerName,
      lentAt: loan.lentAt,
      dueAt: loan.dueAt,
    })
    .from(loan)
    .where(and(inArray(loan.bookId, bookIds), isNull(loan.returnedAt)))
  return new Map(rows.map((r) => [r.bookId, toInfo(r)]))
}

export interface LoanListRow {
  loanId: string
  bookId: string
  bookTitle: string
  bookAuthors: string
  bookPages: number | null
  place: string | null
  borrowerName: string
  note: string | null
  lentAt: Date
  dueAt: Date | null
  returnedAt: Date | null
  overdue: boolean
}

/** Выдачи по всем моим библиотекам: активные или история. */
export async function listLoans(
  userId: string,
  kind: 'active' | 'history',
): Promise<Array<LoanListRow>> {
  const libIds = await memberLibraryIds(userId)
  if (libIds.length === 0) return []
  const rows = await db
    .select({
      loanId: loan.id,
      bookId: loan.bookId,
      bookTitle: book.title,
      bookAuthors: book.authors,
      bookPages: book.pages,
      libraryName: library.name,
      shelfName: shelf.name,
      borrowerName: loan.borrowerName,
      note: loan.note,
      lentAt: loan.lentAt,
      dueAt: loan.dueAt,
      returnedAt: loan.returnedAt,
    })
    .from(loan)
    .innerJoin(book, eq(book.id, loan.bookId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .where(
      and(
        inArray(book.libraryId, libIds),
        kind === 'active'
          ? isNull(loan.returnedAt)
          : isNotNull(loan.returnedAt),
      ),
    )
    .orderBy(desc(loan.lentAt))
    .limit(kind === 'history' ? 200 : 1000)
  return rows.map((r) => ({
    loanId: r.loanId,
    bookId: r.bookId,
    bookTitle: r.bookTitle,
    bookAuthors: r.bookAuthors,
    bookPages: r.bookPages,
    place: r.libraryName
      ? `${r.libraryName} · ${r.shelfName ?? 'Неразобранное'}`
      : null,
    borrowerName: r.borrowerName,
    note: r.note,
    lentAt: r.lentAt,
    dueAt: r.dueAt,
    returnedAt: r.returnedAt,
    overdue:
      r.returnedAt === null &&
      r.dueAt !== null &&
      r.dueAt.getTime() < Date.now(),
  }))
}

/** История выдач одной книги (для формуляра на карточке). */
export async function bookLoanHistory(userId: string, bookId: string) {
  await requireBookAccess(userId, bookId)
  return db
    .select({
      loanId: loan.id,
      borrowerName: loan.borrowerName,
      note: loan.note,
      lentAt: loan.lentAt,
      dueAt: loan.dueAt,
      returnedAt: loan.returnedAt,
    })
    .from(loan)
    .where(eq(loan.bookId, bookId))
    .orderBy(desc(loan.lentAt))
    .limit(50)
}
