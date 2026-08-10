import { and, eq } from 'drizzle-orm'

import { db } from '@/db'
import { libraryMember } from '@/db/schema/catalog'
import { AppError } from './errors'

export type Membership = typeof libraryMember.$inferSelect

export async function getMembership(
  userId: string,
  libraryId: string,
): Promise<Membership | null> {
  const rows = await db
    .select()
    .from(libraryMember)
    .where(
      and(
        eq(libraryMember.libraryId, libraryId),
        eq(libraryMember.userId, userId),
      ),
    )
  return rows[0] ?? null
}

/** Доступ к каталогу библиотеки — только для участников. */
export async function assertMember(
  userId: string,
  libraryId: string,
): Promise<Membership> {
  const membership = await getMembership(userId, libraryId)
  if (!membership)
    throw new AppError('Нет доступа к этой библиотеке', 'forbidden')
  return membership
}

/** Управление библиотекой (участники, удаление) — только создатель. */
export async function assertOwner(
  userId: string,
  libraryId: string,
): Promise<Membership> {
  const membership = await assertMember(userId, libraryId)
  if (membership.role !== 'owner') {
    throw new AppError(
      'Это может сделать только создатель библиотеки',
      'forbidden',
    )
  }
  return membership
}

/** Список id библиотек, где пользователь состоит. */
export async function memberLibraryIds(userId: string): Promise<Array<string>> {
  const rows = await db
    .select({ libraryId: libraryMember.libraryId })
    .from(libraryMember)
    .where(eq(libraryMember.userId, userId))
  return rows.map((r) => r.libraryId)
}
