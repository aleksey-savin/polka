import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import { book, bookPersonal } from '@/db/schema/catalog'
import { listLoans } from './loans'
import { listMyLists } from './lists'
import { memberLibraryIds } from './members'
import type { LoanListRow } from './loans'
import type { ListRow } from './lists'
import { staleBooks } from './reference/sync'
import type { StaleBook } from './reference/sync'

export interface ReadingNowBook {
  id: string
  title: string
  authors: string
  pages: number | null
  coverPath: string | null
  coverColor: string | null
  hidden: boolean
  since: Date | null
}

export interface ReadingHub {
  reading: Array<ReadingNowBook>
  loans: Array<LoanListRow>
  wishlistTotal: number
  wishlistHead: Array<{ id: string; title: string; authors: string }>
  /** Вишлисты и подборки — вход в списки (M17). */
  lists: Array<ListRow>
  year: number
  yearCount: number
  yearAvgRating: number | null
  /** Книги, у которых эталон ушёл вперёд (M34). */
  stale: Array<StaleBook>
}

const WISHLIST_HEAD = 3

/** Личный хаб «Чтение»: читаю сейчас, на руках, хочу, итог года. */
export async function getReadingHub(userId: string): Promise<ReadingHub> {
  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    and(eq(book.addedBy, userId), eq(book.status, 'wishlist')),
  )

  const reading = await db
    .select({
      id: book.id,
      title: book.title,
      authors: book.authors,
      pages: book.pages,
      coverPath: book.coverPath,
      coverColor: book.coverColor,
      hidden: book.hidden,
      since: bookPersonal.readingStartedAt,
    })
    .from(bookPersonal)
    .innerJoin(book, eq(book.id, bookPersonal.bookId))
    .where(
      and(
        eq(bookPersonal.userId, userId),
        eq(bookPersonal.readingStatus, 'reading'),
        accessible,
      ),
    )
    .orderBy(desc(bookPersonal.readingStartedAt))
    .limit(20)

  const loans = await listLoans(userId, 'active')

  const wishRows = await db
    .select({ id: book.id, title: book.title, authors: book.authors })
    .from(book)
    .where(and(eq(book.addedBy, userId), eq(book.status, 'wishlist')))
    .orderBy(desc(book.createdAt))
  const wishlistHead = wishRows.slice(0, WISHLIST_HEAD)

  const year = new Date().getFullYear()
  const [yearRow] = await db
    .select({
      count: sql<number>`count(*)`,
      avg: sql<number | null>`avg(${bookPersonal.rating})`,
    })
    .from(bookPersonal)
    .where(
      and(
        eq(bookPersonal.userId, userId),
        eq(bookPersonal.readingStatus, 'read'),
        gte(bookPersonal.readAt, new Date(year, 0, 1)),
        lt(bookPersonal.readAt, new Date(year + 1, 0, 1)),
      ),
    )

  return {
    reading,
    loans,
    wishlistTotal: wishRows.length,
    wishlistHead,
    lists: await listMyLists(userId),
    year,
    yearCount: yearRow?.count ?? 0,
    yearAvgRating: yearRow?.avg ?? null,
    stale: await staleBooks(userId),
  }
}
