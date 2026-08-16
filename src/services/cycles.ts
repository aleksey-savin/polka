import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import {
  author as authorTable,
  book,
  bookPersonal,
  library,
  refBookWork,
  refWork,
  refWorkAuthor,
  refWorkLink,
  shelf,
} from '@/db/schema/catalog'
import { listsForTargets } from './lists'
import { memberLibraryIds } from './members'

/**
 * Циклы произведений (M16): вычисляются из эталона, в книге не хранятся.
 * Цикл — тот же ref_work с workType 'cycle', состав — ref_work_link по порядку
 * чтения. Издательская серия к циклам отношения не имеет.
 *
 * В строке цикла две независимые оси: чтение (прочитана/читаю) и наличие
 * (на полке / в «Хочу» / нет). Прочитать книгу можно и не владея ею —
 * поэтому «В Хочу» статусом чтения не блокируется.
 */

/** Связь цикл → произведение (идемпотентно, порядок обновляем). */
export async function linkCycleChild(
  parentId: string,
  childId: string,
  position: number,
): Promise<void> {
  if (parentId === childId) return
  await db
    .insert(refWorkLink)
    .values({ parentId, childId, position })
    .onConflictDoUpdate({
      target: [refWorkLink.parentId, refWorkLink.childId],
      set: { position },
    })
}

export interface CycleMember {
  workId: string
  title: string
  year: number | null
  /** Номер по порядку чтения, 1-based. */
  position: number
  /** Моя книга этого произведения (если есть) — тап ведёт в её карточку. */
  bookId: string | null
  /** Наличие: «полка «Детективы»» / «в «Хочу»» / «подарена» / null. */
  place: string | null
  owned: boolean
  /** Уже в каком-нибудь моём списке (вишлист или подборка). */
  listed: boolean
  reading: 'read' | 'reading' | null
  current: boolean
}

export interface CycleView {
  cycleId: string
  title: string
  authorName: string | null
  total: number
  readCount: number
  ownedCount: number
  listedCount: number
  currentWorkId: string | null
  currentPosition: number | null
  members: Array<CycleMember>
}

/** Произведения, которые «покрывает» книга: связь издания, прямая ссылка, название. */
async function workIdsForBook(row: {
  refBookId: string | null
  refWorkId: string | null
  titleNorm: string
}): Promise<Array<string>> {
  const ids = new Set<string>()
  if (row.refWorkId) ids.add(row.refWorkId)
  if (row.refBookId) {
    const covered = await db
      .select({ workId: refBookWork.workId })
      .from(refBookWork)
      .where(eq(refBookWork.refBookId, row.refBookId))
    for (const c of covered) ids.add(c.workId)
  }
  if (ids.size === 0) {
    const byTitle = await db
      .select({ id: refWork.id })
      .from(refWork)
      .where(eq(refWork.titleNorm, row.titleNorm))
      .limit(5)
    for (const w of byTitle) ids.add(w.id)
  }
  return [...ids]
}

/** Цикл книги: первая найденная связь произведений книги с циклом. */
export async function bookCycle(
  userId: string,
  bookId: string,
): Promise<CycleView | null> {
  const [row] = await db
    .select({
      id: book.id,
      titleNorm: book.titleNorm,
      refBookId: book.refBookId,
      refWorkId: book.refWorkId,
    })
    .from(book)
    .where(eq(book.id, bookId))
  if (!row) return null

  const workIds = await workIdsForBook(row)
  if (workIds.length === 0) return null

  const [link] = await db
    .select({ parentId: refWorkLink.parentId, childId: refWorkLink.childId })
    .from(refWorkLink)
    .where(inArray(refWorkLink.childId, workIds))
    .orderBy(asc(refWorkLink.position))
    .limit(1)
  if (!link) return null

  return getCycleView(userId, link.parentId, link.childId)
}

/** Состав цикла с моими отметками по обеим осям. */
export async function getCycleView(
  userId: string,
  cycleId: string,
  currentWorkId?: string,
): Promise<CycleView | null> {
  const [cycle] = await db
    .select({ id: refWork.id, title: refWork.title })
    .from(refWork)
    .where(eq(refWork.id, cycleId))
  if (!cycle) return null

  const rows = await db
    .select({
      workId: refWork.id,
      title: refWork.title,
      titleNorm: refWork.titleNorm,
      year: refWork.year,
      position: refWorkLink.position,
    })
    .from(refWorkLink)
    .innerJoin(refWork, eq(refWork.id, refWorkLink.childId))
    .where(eq(refWorkLink.parentId, cycleId))
    .orderBy(asc(refWorkLink.position), asc(refWork.year))
  if (rows.length === 0) return null

  const [authorRow] = await db
    .select({ name: authorTable.name })
    .from(refWorkAuthor)
    .innerJoin(authorTable, eq(authorTable.id, refWorkAuthor.authorId))
    .where(eq(refWorkAuthor.workId, cycleId))
    .limit(1)
  const [childAuthorRow] = authorRow
    ? []
    : await db
        .select({ name: authorTable.name })
        .from(refWorkAuthor)
        .innerJoin(authorTable, eq(authorTable.id, refWorkAuthor.authorId))
        .where(
          inArray(
            refWorkAuthor.workId,
            rows.map((r) => r.workId),
          ),
        )
        .limit(1)

  const workIds = rows.map((r) => r.workId)
  const titleNorms = rows.map((r) => r.titleNorm)

  // издания, покрывающие произведения цикла → чтобы найти мои экземпляры
  const covers = await db
    .select({ refBookId: refBookWork.refBookId, workId: refBookWork.workId })
    .from(refBookWork)
    .where(inArray(refBookWork.workId, workIds))
  const worksByRefBook = new Map<string, Array<string>>()
  for (const c of covers) {
    const list = worksByRefBook.get(c.refBookId) ?? []
    list.push(c.workId)
    worksByRefBook.set(c.refBookId, list)
  }

  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    eq(book.addedBy, userId),
  )
  const refBookIds = [...worksByRefBook.keys()]
  const mine = await db
    .select({
      id: book.id,
      titleNorm: book.titleNorm,
      refBookId: book.refBookId,
      refWorkId: book.refWorkId,
      status: book.status,
      shelfName: shelf.name,
      libraryName: library.name,
      readingStatus: bookPersonal.readingStatus,
    })
    .from(book)
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(
      bookPersonal,
      and(
        eq(bookPersonal.bookId, book.id),
        eq(bookPersonal.userId, userId),
      ),
    )
    .where(
      and(
        accessible,
        or(
          inArray(book.titleNorm, titleNorms),
          inArray(book.refWorkId, workIds),
          refBookIds.length > 0
            ? inArray(book.refBookId, refBookIds)
            : undefined,
        ),
      ),
    )

  type Mine = (typeof mine)[number]
  const byWork = new Map<string, Array<Mine>>()
  const push = (workId: string, b: Mine) => {
    const list = byWork.get(workId) ?? []
    if (!list.some((x) => x.id === b.id)) list.push(b)
    byWork.set(workId, list)
  }
  const workByTitleNorm = new Map(rows.map((r) => [r.titleNorm, r.workId]))
  for (const b of mine) {
    const covered = b.refBookId ? worksByRefBook.get(b.refBookId) : undefined
    if (covered) for (const w of covered) push(w, b)
    if (b.refWorkId && workIds.includes(b.refWorkId)) push(b.refWorkId, b)
    const byTitle = workByTitleNorm.get(b.titleNorm)
    if (byTitle) push(byTitle, b)
  }

  const inLists = await listsForTargets(
    userId,
    rows.map((r) => ({ refWorkId: r.workId })),
  )

  const PLACE_BY_STATUS: Record<string, string> = {
    wishlist: 'в «Хочу»',
    gifted: 'подарена',
    lost: 'потеряна',
  }

  const members = rows.map((r, i) => {
    const candidates = byWork.get(r.workId) ?? []
    // наличие — только книга на полке: подаренная и потерянная не в счёт,
    // поэтому по ним «В Хочу» снова доступно (чтение тут ни при чём)
    const owned = candidates.find((b) => b.status === 'in_library')
    const wishRow = candidates.find((b) => b.status === 'wishlist')
    const chosen = owned ?? wishRow ?? candidates[0] ?? null
    const readingStatus = candidates.find(
      (b) => b.readingStatus === 'read' || b.readingStatus === 'reading',
    )?.readingStatus
    const place = owned
      ? (owned.shelfName ?? owned.libraryName ?? PLACE_BY_STATUS[owned.status])
      : chosen
        ? PLACE_BY_STATUS[chosen.status]
        : null
    return {
      workId: r.workId,
      title: r.title,
      year: r.year,
      position: r.position || i + 1,
      bookId: chosen?.id ?? null,
      place: place ?? null,
      owned: Boolean(owned),
      listed:
        (inLists.get(`work:${r.workId}`)?.length ?? 0) > 0 ||
        Boolean(wishRow),
      reading:
        readingStatus === 'read' || readingStatus === 'reading'
          ? readingStatus
          : null,
      current: r.workId === currentWorkId,
    } satisfies CycleMember
  })

  const current = members.find((m) => m.current) ?? null
  return {
    cycleId: cycle.id,
    title: cycle.title,
    authorName: authorRow?.name ?? childAuthorRow?.name ?? null,
    total: members.length,
    readCount: members.filter((m) => m.reading === 'read').length,
    ownedCount: members.filter((m) => m.owned).length,
    listedCount: members.filter((m) => m.listed).length,
    currentWorkId: current?.workId ?? null,
    currentPosition: current?.position ?? null,
    members,
  }
}

/** Есть ли у автора размеченные циклы (для страницы автора). */
export async function authorCycles(
  authorId: string,
): Promise<Array<{ id: string; title: string; count: number }>> {
  const rows = await db
    .select({
      id: refWork.id,
      title: refWork.title,
      count: sql<number>`count(${refWorkLink.childId})`,
    })
    .from(refWork)
    .innerJoin(refWorkAuthor, eq(refWorkAuthor.workId, refWork.id))
    .innerJoin(refWorkLink, eq(refWorkLink.parentId, refWork.id))
    .where(and(eq(refWorkAuthor.authorId, authorId), eq(refWork.workType, 'cycle')))
    .groupBy(refWork.id)
    .orderBy(asc(refWork.title))
  return rows
}
