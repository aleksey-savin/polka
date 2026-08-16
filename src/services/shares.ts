import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm'

import { db } from '@/db'
import { user } from '@/db/schema/auth'
import { book, library, libraryMember, shelf } from '@/db/schema/catalog'
import { borrowRequest, share } from '@/db/schema/circulation'
import { AppError } from './errors'
import { activeLoansFor } from './loans'
import { assertMember } from './members'
import { randomToken } from './random'
import { shelfTint } from './shelfTint'
import type { ShelfTint } from './shelfTint'

export async function createShare(
  userId: string,
  target:
    | { scope: 'library'; libraryId: string }
    | { scope: 'shelf'; shelfId: string },
): Promise<{ token: string }> {
  let libraryId: string | null = null
  let shelfId: string | null = null
  if (target.scope === 'library') {
    libraryId = target.libraryId
  } else {
    const [found] = await db
      .select({ libraryId: shelf.libraryId })
      .from(shelf)
      .where(eq(shelf.id, target.shelfId))
    if (!found) throw new AppError('Полка не найдена', 'not_found')
    libraryId = found.libraryId
    shelfId = target.shelfId
  }
  await assertMember(userId, libraryId)
  const { assertCanPublish, enqueue } = await import('./moderation')
  await assertCanPublish(userId)
  const token = randomToken()
  const [created] = await db
    .insert(share)
    .values({
      createdBy: userId,
      token,
      scope: target.scope,
      libraryId: target.scope === 'library' ? libraryId : null,
      shelfId,
    })
    .returning({ id: share.id })
  if (created) await enqueue('share', created.id, userId)
  return { token }
}

export interface MyShareRow {
  id: string
  token: string
  scope: 'library' | 'shelf'
  targetName: string
  libraryName: string
  pendingRequests: number
  createdAt: Date
}

/** Мои исходящие ссылки (по библиотекам, где я участник). */
export async function listMyShares(userId: string): Promise<Array<MyShareRow>> {
  const rows = await db
    .select({
      id: share.id,
      token: share.token,
      scope: share.scope,
      libraryId: share.libraryId,
      shelfId: share.shelfId,
      shelfLibraryId: shelf.libraryId,
      libraryName: library.name,
      shelfName: shelf.name,
      createdAt: share.createdAt,
      pendingRequests: count(borrowRequest.id),
    })
    .from(share)
    .leftJoin(shelf, eq(shelf.id, share.shelfId))
    .leftJoin(
      library,
      eq(library.id, sql`coalesce(${share.libraryId}, ${shelf.libraryId})`),
    )
    .leftJoin(
      borrowRequest,
      and(
        eq(borrowRequest.shareId, share.id),
        eq(borrowRequest.status, 'pending'),
      ),
    )
    .where(
      and(isNull(share.revokedAt), inArray(share.scope, ['library', 'shelf'])),
    )
    .groupBy(share.id)
    .orderBy(asc(share.createdAt))
  const memberLibs = new Set(
    (
      await db
        .select({ libraryId: libraryMember.libraryId })
        .from(libraryMember)
        .where(eq(libraryMember.userId, userId))
    ).map((r) => r.libraryId),
  )
  return rows
    .filter((r) => {
      const libId = r.libraryId ?? r.shelfLibraryId
      return libId !== null && memberLibs.has(libId)
    })
    .map((r) => ({
      id: r.id,
      token: r.token,
      scope: r.scope as 'library' | 'shelf',
      targetName:
        r.scope === 'library' ? (r.libraryName ?? '?') : (r.shelfName ?? '?'),
      libraryName: r.libraryName ?? '',
      pendingRequests: r.pendingRequests,
      createdAt: r.createdAt,
    }))
}

export async function revokeShare(
  userId: string,
  shareId: string,
): Promise<void> {
  const [row] = await db
    .select({
      id: share.id,
      libraryId: share.libraryId,
      shelfId: share.shelfId,
    })
    .from(share)
    .where(eq(share.id, shareId))
  if (!row) throw new AppError('Ссылка не найдена', 'not_found')
  const libraryId =
    row.libraryId ??
    (row.shelfId
      ? ((
          await db
            .select({ libraryId: shelf.libraryId })
            .from(shelf)
            .where(eq(shelf.id, row.shelfId))
        )[0]?.libraryId ?? null)
      : null)
  if (!libraryId) throw new AppError('Ссылка повреждена', 'invalid')
  await assertMember(userId, libraryId)
  await db
    .update(share)
    .set({ revokedAt: new Date() })
    .where(eq(share.id, shareId))
}

// ── Публичная витрина ──────────────────────────────────────────────────

/** ПУБЛИЧНЫЙ allowlist полей книги — ничего личного наружу. */
export interface PublicBook {
  id: string
  title: string
  authors: string
  year: number | null
  pages: number | null
  annotation: string | null
  seriesName: string | null
  seriesNumber: string | null
  hasCover: boolean
  /** Занята сейчас (без имени должника). */
  onLoan: boolean
}

export interface PublicShelfSection {
  name: string
  tint: ShelfTint
  accentColor: string | null
  books: Array<PublicBook>
}

export interface ShareView {
  shareId: string
  token: string
  scope: 'library' | 'shelf'
  title: string
  ownerNames: string
  bookCount: number
  allowRequests: boolean
  sections: Array<PublicShelfSection>
}

async function resolveShare(token: string) {
  const [row] = await db.select().from(share).where(eq(share.token, token))
  if (!row || row.revokedAt)
    throw new AppError('Ссылка не действует', 'not_found')
  return row
}

/** Витрина по токену — для гостей, без сессии. */
export async function getShareView(token: string): Promise<ShareView> {
  const row = await resolveShare(token)
  const libraryId =
    row.libraryId ??
    (row.shelfId
      ? ((
          await db
            .select({ libraryId: shelf.libraryId })
            .from(shelf)
            .where(eq(shelf.id, row.shelfId))
        )[0]?.libraryId ?? null)
      : null)
  if (!libraryId) throw new AppError('Ссылка повреждена', 'invalid')

  const owners = await db
    .select({ name: user.name })
    .from(libraryMember)
    .innerJoin(user, eq(user.id, libraryMember.userId))
    .where(eq(libraryMember.libraryId, libraryId))

  const shelvesRows = await db
    .select()
    .from(shelf)
    .where(
      row.scope === 'shelf' && row.shelfId
        ? eq(shelf.id, row.shelfId)
        : eq(shelf.libraryId, libraryId),
    )
    .orderBy(asc(shelf.position))

  const { series } = await import('@/db/schema/catalog')
  const books = await db
    .select({
      id: book.id,
      title: book.title,
      authors: book.authors,
      year: book.year,
      pages: book.pages,
      annotation: book.annotation,
      seriesName: series.name,
      seriesNumber: book.seriesNumber,
      coverPath: book.coverPath,
      shelfId: book.shelfId,
    })
    .from(book)
    .leftJoin(series, eq(series.id, book.seriesId))
    .where(
      and(
        row.scope === 'shelf' && row.shelfId
          ? eq(book.shelfId, row.shelfId)
          : eq(book.libraryId, libraryId),
        eq(book.status, 'in_library'),
        eq(book.hidden, false), // скрытые — только для своих
      ),
    )
    .orderBy(asc(book.titleNorm))

  const lent = await activeLoansFor(books.map((b) => b.id))
  const toPublic = (b: (typeof books)[number]): PublicBook => ({
    id: b.id,
    title: b.title,
    authors: b.authors,
    year: b.year,
    pages: b.pages,
    annotation: b.annotation,
    seriesName: b.seriesName,
    seriesNumber: b.seriesNumber,
    hasCover: b.coverPath !== null,
    onLoan: lent.has(b.id),
  })

  const sections: Array<PublicShelfSection> = []
  for (const s of shelvesRows) {
    const shelfBooks = books.filter((b) => b.shelfId === s.id)
    if (shelfBooks.length === 0 && row.scope === 'library') continue
    sections.push({
      name: s.name,
      accentColor: s.accentColor,
      tint: shelfTint(shelfBooks.map((b) => b.year)),
      books: shelfBooks.map(toPublic),
    })
  }
  if (row.scope === 'library') {
    const unsorted = books.filter((b) => b.shelfId === null)
    if (unsorted.length > 0) {
      sections.push({
        name: 'Неразобранное',
        accentColor: null,
        tint: shelfTint(unsorted.map((b) => b.year)),
        books: unsorted.map(toPublic),
      })
    }
  }

  const [libRow] = await db
    .select({ name: library.name })
    .from(library)
    .where(eq(library.id, libraryId))
  const shelfName = row.scope === 'shelf' ? (shelvesRows[0]?.name ?? '') : null

  return {
    shareId: row.id,
    token,
    scope: row.scope as 'library' | 'shelf',
    title: shelfName ?? libRow?.name ?? 'Полка',
    ownerNames: owners.map((o) => o.name).join(' и '),
    bookCount: books.length,
    allowRequests: row.allowRequests,
    sections,
  }
}

/** Книга доступна по какому-нибудь активному шэру? (публичные обложки) */
export async function isBookPubliclyShared(bookId: string): Promise<boolean> {
  const [row] = await db
    .select({
      libraryId: book.libraryId,
      shelfId: book.shelfId,
      status: book.status,
      hidden: book.hidden,
    })
    .from(book)
    .where(eq(book.id, bookId))
  if (!row || row.status !== 'in_library' || !row.libraryId || row.hidden)
    return false
  const shares = await db
    .select({ libraryId: share.libraryId, shelfId: share.shelfId })
    .from(share)
    .where(isNull(share.revokedAt))
  return shares.some(
    (s) =>
      (s.libraryId !== null && s.libraryId === row.libraryId) ||
      (s.shelfId !== null && s.shelfId === row.shelfId),
  )
}
