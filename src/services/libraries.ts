import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'

import { db } from '@/db'
import { user } from '@/db/schema/auth'
import {
  book,
  library,
  libraryInvite,
  libraryMember,
  shelf,
} from '@/db/schema/catalog'
import { AppError } from './errors'
import { activeLoansFor } from './loans'
import { assertMember, assertOwner, memberLibraryIds } from './members'
import { randomToken } from './random'
import { shelfTint } from './shelfTint'
import type { ShelfTint } from './shelfTint'

export interface LibrarySummary {
  id: string
  name: string
  position: number
  bookCount: number
}

/** Библиотеки пользователя для табов. */
export async function listMyLibraries(
  userId: string,
): Promise<Array<LibrarySummary>> {
  const ids = await memberLibraryIds(userId)
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: library.id,
      name: library.name,
      position: library.position,
      bookCount: count(book.id),
    })
    .from(library)
    .leftJoin(
      book,
      and(eq(book.libraryId, library.id), eq(book.status, 'in_library')),
    )
    .where(inArray(library.id, ids))
    .groupBy(library.id)
    .orderBy(asc(library.position), asc(library.createdAt))
  return rows
}

export interface ShelfOverview {
  id: string
  name: string
  accentColor: string | null
  bookCount: number
  tint: ShelfTint
  books: Array<{
    id: string
    title: string
    authors: string
    pages: number | null
    lentTo: string | null
    coverColor: string | null
  }>
}

export interface LibraryOverview {
  id: string
  name: string
  description: string | null
  role: 'owner' | 'member'
  members: Array<{ id: string; name: string; role: string }>
  shelves: Array<ShelfOverview>
  unsorted: {
    count: number
    books: Array<{
      id: string
      title: string
      authors: string
      pages: number | null
      heightMm: number | null
      coverType: 'soft' | 'hard' | null
      giftEdition: boolean
      coverColor: string | null
    }>
  }
}

const SPINES_PER_SHELF = 40
const UNSORTED_PREVIEW = 5

/** Полный обзор библиотеки: полки с патиной и корешками, стопка «Неразобранное», участники. */
export async function getLibraryOverview(
  userId: string,
  libraryId: string,
): Promise<LibraryOverview> {
  const membership = await assertMember(userId, libraryId)
  const [lib] = await db.select().from(library).where(eq(library.id, libraryId))
  if (!lib) throw new AppError('Библиотека не найдена', 'not_found')

  const members = await db
    .select({ id: user.id, name: user.name, role: libraryMember.role })
    .from(libraryMember)
    .innerJoin(user, eq(user.id, libraryMember.userId))
    .where(eq(libraryMember.libraryId, libraryId))
    .orderBy(asc(libraryMember.joinedAt))

  const shelves = await db
    .select()
    .from(shelf)
    .where(eq(shelf.libraryId, libraryId))
    .orderBy(asc(shelf.position), asc(shelf.createdAt))

  const shelvedBooks = await db
    .select({
      id: book.id,
      title: book.title,
      authors: book.authors,
      pages: book.pages,
      year: book.year,
      shelfId: book.shelfId,
      coverColor: book.coverColor,
      heightMm: book.heightMm,
      coverType: book.coverType,
      giftEdition: book.giftEdition,
      createdAt: book.createdAt,
    })
    .from(book)
    .where(and(eq(book.libraryId, libraryId), eq(book.status, 'in_library')))
    .orderBy(asc(book.createdAt))

  const byShelf = new Map<string, Array<(typeof shelvedBooks)[number]>>()
  const unsorted: Array<(typeof shelvedBooks)[number]> = []
  for (const b of shelvedBooks) {
    if (b.shelfId === null) unsorted.push(b)
    else {
      const list = byShelf.get(b.shelfId) ?? []
      list.push(b)
      byShelf.set(b.shelfId, list)
    }
  }
  const lentMap = await activeLoansFor(shelvedBooks.map((b) => b.id))

  return {
    id: lib.id,
    name: lib.name,
    description: lib.description,
    role: membership.role,
    members,
    shelves: shelves.map((s) => {
      const books = byShelf.get(s.id) ?? []
      return {
        id: s.id,
        name: s.name,
        accentColor: s.accentColor,
        bookCount: books.length,
        tint: shelfTint(books.map((b) => b.year)),
        books: books
          .slice(0, SPINES_PER_SHELF)
          .map(
            ({
              id,
              title,
              authors,
              pages,
              heightMm,
              coverType,
              giftEdition,
              coverColor,
            }) => ({
              id,
              title,
              authors,
              pages,
              heightMm,
              coverType,
              giftEdition,
              coverColor,
              lentTo: lentMap.get(id)?.borrowerName ?? null,
            }),
          ),
      }
    }),
    unsorted: {
      count: unsorted.length,
      books: unsorted
        .slice(0, UNSORTED_PREVIEW)
        .map(
          ({
            id,
            title,
            authors,
            pages,
            heightMm,
            coverType,
            giftEdition,
            coverColor,
          }) => ({
            id,
            title,
            authors,
            pages,
            heightMm,
            coverType,
            giftEdition,
            coverColor,
          }),
        ),
    },
  }
}

export async function createLibrary(
  userId: string,
  input: { name: string; description?: string },
): Promise<{ id: string }> {
  const [posRow] = await db
    .select({ maxPos: count() })
    .from(libraryMember)
    .where(eq(libraryMember.userId, userId))
  const [created] = await db
    .insert(library)
    .values({
      name: input.name,
      description: input.description ?? null,
      position: posRow?.maxPos ?? 0,
      createdBy: userId,
    })
    .returning({ id: library.id })
  if (!created) throw new AppError('Не удалось создать библиотеку')
  await db
    .insert(libraryMember)
    .values({ libraryId: created.id, userId, role: 'owner' })
  return created
}

export async function renameLibrary(
  userId: string,
  libraryId: string,
  name: string,
): Promise<void> {
  await assertMember(userId, libraryId)
  await db.update(library).set({ name }).where(eq(library.id, libraryId))
}

export async function deleteLibrary(
  userId: string,
  libraryId: string,
): Promise<void> {
  await assertOwner(userId, libraryId)
  await db.delete(library).where(eq(library.id, libraryId))
}

// ── Инвайты и участники ────────────────────────────────────────────────

export async function createInvite(
  userId: string,
  libraryId: string,
): Promise<{ token: string }> {
  await assertOwner(userId, libraryId)
  const token = randomToken()
  await db.insert(libraryInvite).values({ libraryId, token, createdBy: userId })
  return { token }
}

export async function revokeInvites(
  userId: string,
  libraryId: string,
): Promise<void> {
  await assertOwner(userId, libraryId)
  await db
    .update(libraryInvite)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(libraryInvite.libraryId, libraryId),
        isNull(libraryInvite.revokedAt),
      ),
    )
}

/** Принять инвайт: идемпотентно, возвращает библиотеку. */
export async function acceptInvite(
  userId: string,
  token: string,
): Promise<{ libraryId: string; libraryName: string }> {
  const [invite] = await db
    .select({
      id: libraryInvite.id,
      libraryId: libraryInvite.libraryId,
      revokedAt: libraryInvite.revokedAt,
    })
    .from(libraryInvite)
    .where(eq(libraryInvite.token, token))
  if (!invite || invite.revokedAt) {
    throw new AppError(
      'Приглашение не действует — попросите новую ссылку',
      'not_found',
    )
  }
  const [lib] = await db
    .select({ name: library.name })
    .from(library)
    .where(eq(library.id, invite.libraryId))
  if (!lib) throw new AppError('Библиотека уже удалена', 'not_found')

  const existing = await db
    .select()
    .from(libraryMember)
    .where(
      and(
        eq(libraryMember.libraryId, invite.libraryId),
        eq(libraryMember.userId, userId),
      ),
    )
  if (existing.length === 0) {
    await db
      .insert(libraryMember)
      .values({ libraryId: invite.libraryId, userId, role: 'member' })
  }
  return { libraryId: invite.libraryId, libraryName: lib.name }
}

export async function removeMember(
  userId: string,
  libraryId: string,
  targetUserId: string,
): Promise<void> {
  await assertOwner(userId, libraryId)
  if (targetUserId === userId) {
    throw new AppError(
      'Создатель не может удалить себя — удалите библиотеку целиком',
      'invalid',
    )
  }
  await db
    .delete(libraryMember)
    .where(
      and(
        eq(libraryMember.libraryId, libraryId),
        eq(libraryMember.userId, targetUserId),
      ),
    )
}
