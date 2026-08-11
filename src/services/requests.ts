import { and, desc, eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { book, library, shelf } from '@/db/schema/catalog'
import { borrowRequest, share } from '@/db/schema/circulation'
import { AppError } from './errors'
import { lendBook } from './loans'
import { memberLibraryIds } from './members'

// Простейший rate-limit: не больше N заявок в час с одного ip на одну ссылку.
const RATE_LIMIT = 10
const RATE_WINDOW_MS = 60 * 60 * 1000
const rateBuckets = new Map<string, Array<number>>()

function checkRateLimit(ip: string, shareId: string): void {
  const key = `${ip}|${shareId}`
  const now = Date.now()
  const hits = (rateBuckets.get(key) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  )
  if (hits.length >= RATE_LIMIT) {
    throw new AppError('Слишком много заявок — попробуйте позже')
  }
  hits.push(now)
  rateBuckets.set(key, hits)
}

/** Заявка «хочу почитать» с публичной витрины (гость или залогиненный). */
export async function createBorrowRequest(input: {
  token: string
  bookId: string
  guestName: string
  note?: string
  requesterUserId?: string | null
  ip: string
}): Promise<void> {
  const [shareRow] = await db
    .select()
    .from(share)
    .where(eq(share.token, input.token))
  if (!shareRow || shareRow.revokedAt)
    throw new AppError('Ссылка не действует', 'not_found')
  if (!shareRow.allowRequests)
    throw new AppError('По этой ссылке заявки выключены')
  checkRateLimit(input.ip, shareRow.id)

  const [bookRow] = await db
    .select({
      id: book.id,
      libraryId: book.libraryId,
      shelfId: book.shelfId,
      status: book.status,
      hidden: book.hidden,
    })
    .from(book)
    .where(eq(book.id, input.bookId))
  const inScope =
    bookRow &&
    bookRow.status === 'in_library' &&
    !bookRow.hidden &&
    ((shareRow.libraryId !== null &&
      bookRow.libraryId === shareRow.libraryId) ||
      (shareRow.shelfId !== null && bookRow.shelfId === shareRow.shelfId))
  if (!inScope) throw new AppError('Эта книга не из этой витрины', 'invalid')

  const [existing] = await db
    .select({ id: borrowRequest.id })
    .from(borrowRequest)
    .where(
      and(
        eq(borrowRequest.bookId, input.bookId),
        eq(borrowRequest.guestName, input.guestName.trim()),
        eq(borrowRequest.status, 'pending'),
      ),
    )
  if (existing) throw new AppError('Заявка от вас на эту книгу уже ждёт ответа')

  await db.insert(borrowRequest).values({
    shareId: shareRow.id,
    bookId: input.bookId,
    guestName: input.guestName.trim(),
    requesterUserId: input.requesterUserId ?? null,
    note: input.note?.trim() || null,
  })
}

export interface RequestRow {
  id: string
  bookId: string
  bookTitle: string
  place: string | null
  guestName: string
  note: string | null
  createdAt: Date
  bookOnLoan: boolean
}

/** Ожидающие заявки по книгам моих библиотек. */
export async function listPendingRequests(
  userId: string,
): Promise<Array<RequestRow>> {
  const libIds = await memberLibraryIds(userId)
  if (libIds.length === 0) return []
  const { activeLoansFor } = await import('./loans')
  const rows = await db
    .select({
      id: borrowRequest.id,
      bookId: borrowRequest.bookId,
      bookTitle: book.title,
      libraryName: library.name,
      shelfName: shelf.name,
      guestName: borrowRequest.guestName,
      note: borrowRequest.note,
      createdAt: borrowRequest.createdAt,
    })
    .from(borrowRequest)
    .innerJoin(book, eq(book.id, borrowRequest.bookId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .where(
      and(inArray(book.libraryId, libIds), eq(borrowRequest.status, 'pending')),
    )
    .orderBy(desc(borrowRequest.createdAt))
  const lent = await activeLoansFor(rows.map((r) => r.bookId))
  return rows.map((r) => ({
    id: r.id,
    bookId: r.bookId,
    bookTitle: r.bookTitle,
    place: r.libraryName
      ? `${r.libraryName} · ${r.shelfName ?? 'Неразобранное'}`
      : null,
    guestName: r.guestName,
    note: r.note,
    createdAt: r.createdAt,
    bookOnLoan: lent.has(r.bookId),
  }))
}

export async function countPendingRequests(userId: string): Promise<number> {
  return (await listPendingRequests(userId)).length
}

async function requireRequest(userId: string, requestId: string) {
  const [row] = await db
    .select()
    .from(borrowRequest)
    .where(eq(borrowRequest.id, requestId))
  if (!row) throw new AppError('Заявка не найдена', 'not_found')
  const [bookRow] = await db
    .select({ libraryId: book.libraryId })
    .from(book)
    .where(eq(book.id, row.bookId))
  const libIds = await memberLibraryIds(userId)
  if (!bookRow?.libraryId || !libIds.includes(bookRow.libraryId)) {
    throw new AppError('Нет доступа к этой заявке', 'forbidden')
  }
  return row
}

/** Одобрить: заявка превращается в выдачу. */
export async function approveRequest(
  userId: string,
  requestId: string,
): Promise<void> {
  const row = await requireRequest(userId, requestId)
  if (row.status !== 'pending') return
  await lendBook(userId, row.bookId, { borrowerName: row.guestName })
  await db
    .update(borrowRequest)
    .set({ status: 'approved', resolvedAt: new Date() })
    .where(eq(borrowRequest.id, requestId))
  // связываем выдачу с заявкой
  const { loan } = await import('@/db/schema/circulation')
  const { isNull } = await import('drizzle-orm')
  await db
    .update(loan)
    .set({ requestId })
    .where(and(eq(loan.bookId, row.bookId), isNull(loan.returnedAt)))
}

export async function declineRequest(
  userId: string,
  requestId: string,
): Promise<void> {
  const row = await requireRequest(userId, requestId)
  if (row.status !== 'pending') return
  await db
    .update(borrowRequest)
    .set({ status: 'declined', resolvedAt: new Date() })
    .where(eq(borrowRequest.id, requestId))
}
