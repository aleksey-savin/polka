import { and, asc, count, eq, isNull, like, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import { user } from '@/db/schema/auth'
import {
  book,
  library,
  libraryMember,
  series,
  shelf,
} from '@/db/schema/catalog'
import { savedShare, share } from '@/db/schema/circulation'
import { AppError } from './errors'
import { activeLoansFor } from './loans'
import { getMembership } from './members'
import { normalizeForSearch } from './search'
import { sanitizeLike } from './series'

async function shareLibraryId(row: {
  libraryId: string | null
  shelfId: string | null
}) {
  if (row.libraryId) return row.libraryId
  if (!row.shelfId) return null
  const [s] = await db
    .select({ libraryId: shelf.libraryId })
    .from(shelf)
    .where(eq(shelf.id, row.shelfId))
  return s?.libraryId ?? null
}

/** «Сохранить себе» чужую ссылку — появится в «Друзьях» и в поиске «У друзей». */
export async function saveShare(userId: string, token: string): Promise<void> {
  const [row] = await db.select().from(share).where(eq(share.token, token))
  if (!row || row.revokedAt)
    throw new AppError('Ссылка не действует', 'not_found')
  const libId = await shareLibraryId(row)
  if (libId && (await getMembership(userId, libId))) {
    throw new AppError('Это ваша библиотека — она и так в «Библиотеке»')
  }
  await db
    .insert(savedShare)
    .values({ userId, shareId: row.id })
    .onConflictDoNothing()
}

export async function removeSavedShare(
  userId: string,
  shareId: string,
): Promise<void> {
  await db
    .delete(savedShare)
    .where(and(eq(savedShare.userId, userId), eq(savedShare.shareId, shareId)))
}

export interface SavedShareRow {
  shareId: string
  token: string
  title: string
  ownerNames: string
  bookCount: number
  savedAt: Date
}

/** Сохранённые полки друзей (отозванные владельцем пропадают сами). */
export async function listSavedShares(
  userId: string,
): Promise<Array<SavedShareRow>> {
  const rows = await db
    .select({
      shareId: share.id,
      token: share.token,
      scope: share.scope,
      libraryId: share.libraryId,
      shelfId: share.shelfId,
      shelfName: shelf.name,
      shelfLibraryId: shelf.libraryId,
      savedAt: savedShare.savedAt,
    })
    .from(savedShare)
    .innerJoin(share, eq(share.id, savedShare.shareId))
    .leftJoin(shelf, eq(shelf.id, share.shelfId))
    .where(and(eq(savedShare.userId, userId), isNull(share.revokedAt)))
    .orderBy(asc(savedShare.savedAt))

  const result: Array<SavedShareRow> = []
  for (const r of rows) {
    const libId = r.libraryId ?? r.shelfLibraryId
    if (!libId) continue
    const [lib] = await db
      .select({ name: library.name })
      .from(library)
      .where(eq(library.id, libId))
    const owners = await db
      .select({ name: user.name })
      .from(libraryMember)
      .innerJoin(user, eq(user.id, libraryMember.userId))
      .where(eq(libraryMember.libraryId, libId))
    const [cnt] = await db
      .select({ n: count() })
      .from(book)
      .where(
        and(
          r.scope === 'shelf' && r.shelfId
            ? eq(book.shelfId, r.shelfId)
            : eq(book.libraryId, libId),
          eq(book.status, 'in_library'),
        ),
      )
    result.push({
      shareId: r.shareId,
      token: r.token,
      title: r.scope === 'shelf' ? (r.shelfName ?? '?') : (lib?.name ?? '?'),
      ownerNames: owners.map((o) => o.name).join(' и '),
      bookCount: cnt?.n ?? 0,
      savedAt: r.savedAt,
    })
  }
  return result
}

export interface FriendBookRow {
  id: string
  title: string
  authors: string
  year: number | null
  seriesName: string | null
  ownerNames: string
  shareTitle: string
  token: string
  onLoan: boolean
}

/** Поиск по сохранённым полкам друзей: публичный allowlist + доступность. */
export async function searchFriendsBooks(
  userId: string,
  query: string,
): Promise<{ rows: Array<FriendBookRow>; shares: Array<SavedShareRow> }> {
  const saved = await listSavedShares(userId)
  if (saved.length === 0) return { rows: [], shares: [] }

  const shareRows = await db
    .select({
      id: share.id,
      libraryId: share.libraryId,
      shelfId: share.shelfId,
      shelfLibraryId: shelf.libraryId,
    })
    .from(share)
    .leftJoin(shelf, eq(shelf.id, share.shelfId))
    .where(
      and(
        isNull(share.revokedAt),
        sql`${share.id} in (select share_id from saved_share where user_id = ${userId})`,
      ),
    )

  const conditions = shareRows
    .map((s) =>
      s.libraryId
        ? eq(book.libraryId, s.libraryId)
        : s.shelfId
          ? eq(book.shelfId, s.shelfId)
          : undefined,
    )
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
  if (conditions.length === 0) return { rows: [], shares: saved }

  const q = sanitizeLike(normalizeForSearch(query))
  const rows = await db
    .select({
      id: book.id,
      title: book.title,
      authors: book.authors,
      year: book.year,
      seriesName: series.name,
      libraryId: book.libraryId,
      shelfId: book.shelfId,
    })
    .from(book)
    .leftJoin(series, eq(series.id, book.seriesId))
    .where(
      and(
        or(...conditions),
        eq(book.status, 'in_library'),
        q
          ? or(
              like(book.titleNorm, `%${q}%`),
              like(book.authorsNorm, `%${q}%`),
              like(series.nameNorm, `%${q}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(book.titleNorm))
    .limit(200)

  const lent = await activeLoansFor(rows.map((r) => r.id))
  const shareFor = (r: { libraryId: string | null; shelfId: string | null }) =>
    saved.find((s) => {
      const sr = shareRows.find((x) => x.id === s.shareId)
      if (!sr) return false
      return (
        (sr.libraryId !== null && sr.libraryId === r.libraryId) ||
        (sr.shelfId !== null && sr.shelfId === r.shelfId)
      )
    })

  return {
    shares: saved,
    rows: rows.flatMap((r) => {
      const s = shareFor(r)
      if (!s) return []
      return [
        {
          id: r.id,
          title: r.title,
          authors: r.authors,
          year: r.year,
          seriesName: r.seriesName,
          ownerNames: s.ownerNames,
          shareTitle: s.title,
          token: s.token,
          onLoan: lent.has(r.id),
        },
      ]
    }),
  }
}
