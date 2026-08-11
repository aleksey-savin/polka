import { and, eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { user } from '@/db/schema/auth'
import { bookPersonal, libraryMember } from '@/db/schema/catalog'
import { requireBookAccess } from './books'
import { AppError } from './errors'

export type ReadingStatus = 'unread' | 'reading' | 'read' | 'abandoned'

export interface PersonalPatch {
  readingStatus?: ReadingStatus
  readAt?: Date | null
  rating?: number | null
  review?: string | null
  notes?: string | null
}

/** Мой личный слой по книге: чтение, оценка, рецензия, заметки. */
export async function upsertPersonal(
  userId: string,
  bookId: string,
  patch: PersonalPatch,
): Promise<void> {
  await requireBookAccess(userId, bookId)
  if (patch.rating !== undefined && patch.rating !== null) {
    if (patch.rating < 1 || patch.rating > 5)
      throw new AppError('Оценка — от 1 до 5')
  }
  const values = {
    userId,
    bookId,
    readingStatus: patch.readingStatus ?? ('unread' as const),
    readAt: patch.readAt ?? null,
    rating: patch.rating ?? null,
    review: patch.review?.trim() || null,
    reviewedAt: patch.review?.trim() ? new Date() : null,
    notes: patch.notes?.trim() || null,
  }
  const set: Record<string, unknown> = {}
  if (patch.readingStatus !== undefined) set.readingStatus = patch.readingStatus
  if (patch.readAt !== undefined) set.readAt = patch.readAt
  if (patch.rating !== undefined) set.rating = patch.rating
  if (patch.review !== undefined) {
    set.review = patch.review?.trim() || null
    set.reviewedAt = patch.review?.trim() ? new Date() : null
  }
  if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null
  await db
    .insert(bookPersonal)
    .values(values)
    .onConflictDoUpdate({
      target: [bookPersonal.userId, bookPersonal.bookId],
      set,
    })
}

export interface BookPersonalView {
  userId: string
  userName: string
  isMe: boolean
  readingStatus: ReadingStatus
  readAt: Date | null
  rating: number | null
  review: string | null
  /** Заметки видит только автор. */
  notes: string | null
}

/** Личные слои всех участников библиотеки книги (заметки — только свои). */
export async function listBookPersonal(
  userId: string,
  bookId: string,
): Promise<Array<BookPersonalView>> {
  const row = await requireBookAccess(userId, bookId)
  const rows = await db
    .select({
      userId: bookPersonal.userId,
      userName: user.name,
      readingStatus: bookPersonal.readingStatus,
      readAt: bookPersonal.readAt,
      rating: bookPersonal.rating,
      review: bookPersonal.review,
      notes: bookPersonal.notes,
    })
    .from(bookPersonal)
    .innerJoin(user, eq(user.id, bookPersonal.userId))
    .where(
      and(
        eq(bookPersonal.bookId, bookId),
        row.libraryId
          ? inArray(
              bookPersonal.userId,
              db
                .select({ userId: libraryMember.userId })
                .from(libraryMember)
                .where(eq(libraryMember.libraryId, row.libraryId)),
            )
          : eq(bookPersonal.userId, userId),
      ),
    )
  return rows
    .map((r) => ({
      ...r,
      isMe: r.userId === userId,
      notes: r.userId === userId ? r.notes : null,
    }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe))
}
