import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import {
  book,
  bookList,
  bookListItem,
  library,
  refBook,
  refBookWork,
  refWork,
  refWorkAuthor,
  author as authorTable,
  shelf,
} from '@/db/schema/catalog'
import { share } from '@/db/schema/circulation'
import { AppError } from './errors'
import { memberLibraryIds } from './members'

/**
 * Вишлисты и подборки (M17): одна сущность, два вида.
 * Элемент ссылается на мою книгу, произведение или издание эталона —
 * подборка «Китайская классика» состоит из книг, которых дома нет,
 * а каталог хранит только мои книги.
 */

export type ListKind = 'wishlist' | 'collection'

/** Куда указывает элемент списка — ровно одна ссылка. */
export type ItemTarget =
  | { bookId: string }
  | { refWorkId: string }
  | { refBookId: string }

const targetCondition = (target: ItemTarget) =>
  'bookId' in target
    ? eq(bookListItem.bookId, target.bookId)
    : 'refWorkId' in target
      ? eq(bookListItem.refWorkId, target.refWorkId)
      : eq(bookListItem.refBookId, target.refBookId)

export interface ListRow {
  id: string
  kind: ListKind
  title: string
  description: string | null
  itemCount: number
  /** Цвета обложек первых книг — стопка на карточке. */
  covers: Array<string>
  shared: boolean
}

async function requireOwnList(userId: string, listId: string) {
  const [row] = await db
    .select()
    .from(bookList)
    .where(eq(bookList.id, listId))
  if (!row) throw new AppError('Список не найден', 'not_found')
  if (row.ownerId !== userId) throw new AppError('Список чужой', 'forbidden')
  return row
}

/** Мои списки с числом книг и стопкой обложек. */
export async function listMyLists(userId: string): Promise<Array<ListRow>> {
  const lists = await db
    .select()
    .from(bookList)
    .where(eq(bookList.ownerId, userId))
    .orderBy(asc(bookList.position), desc(bookList.createdAt))
  if (lists.length === 0) return []

  const ids = lists.map((l) => l.id)
  const items = await db
    .select({
      listId: bookListItem.listId,
      position: bookListItem.position,
      bookColor: book.coverColor,
      refColor: refBook.coverColor,
    })
    .from(bookListItem)
    .leftJoin(book, eq(book.id, bookListItem.bookId))
    .leftJoin(refBook, eq(refBook.id, bookListItem.refBookId))
    .where(inArray(bookListItem.listId, ids))
    .orderBy(desc(bookListItem.position))

  const shares = await db
    .select({ listId: share.listId })
    .from(share)
    .where(and(eq(share.scope, 'list'), isNull(share.revokedAt)))
  const sharedIds = new Set(shares.map((s) => s.listId))

  return lists.map((l) => {
    const own = items.filter((i) => i.listId === l.id)
    return {
      id: l.id,
      kind: l.kind,
      title: l.title,
      description: l.description,
      itemCount: own.length,
      covers: own
        .slice(0, 3)
        .map((i) => i.bookColor ?? i.refColor ?? '#D9CDB8'),
      shared: sharedIds.has(l.id),
    }
  })
}

export interface ListItemView {
  id: string
  title: string
  authors: string
  year: number | null
  note: string | null
  /** Обложка: моя книга, эталонное издание или ничего. */
  coverUrl: string | null
  coverColor: string | null
  /** Моя книга — строка ведёт в карточку и помечается «на полке». */
  myBookId: string | null
  place: string | null
  /** Куда вести, если своей книги нет. */
  refWorkId: string | null
  refBookId: string | null
}

export interface ListView {
  id: string
  kind: ListKind
  title: string
  description: string | null
  items: Array<ListItemView>
  shareToken: string | null
}

/** Состав списка с резолвом «есть ли эта книга у меня». */
export async function getList(
  userId: string,
  listId: string,
): Promise<ListView> {
  const row = await requireOwnList(userId, listId)
  const items = await listItems(userId, listId)
  const [openShare] = await db
    .select({ token: share.token })
    .from(share)
    .where(
      and(
        eq(share.scope, 'list'),
        eq(share.listId, listId),
        isNull(share.revokedAt),
      ),
    )
    .limit(1)
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    items,
    shareToken: openShare?.token ?? null,
  }
}

/** Элементы списка; ownerId — чей каталог считаем «моим» (для витрины гостя null). */
export async function listItems(
  userId: string | null,
  listId: string,
): Promise<Array<ListItemView>> {
  const rows = await db
    .select({
      id: bookListItem.id,
      note: bookListItem.note,
      position: bookListItem.position,
      bookId: bookListItem.bookId,
      refWorkId: bookListItem.refWorkId,
      refBookId: bookListItem.refBookId,
      bookTitle: book.title,
      bookAuthors: book.authors,
      bookYear: book.year,
      bookCover: book.coverPath,
      bookColor: book.coverColor,
      bookStatus: book.status,
      shelfName: shelf.name,
      libraryName: library.name,
      workTitle: refWork.title,
      workYear: refWork.year,
      editionTitle: refBook.title,
      editionAuthors: refBook.authors,
      editionYear: refBook.year,
      editionCover: refBook.coverPath,
      editionColor: refBook.coverColor,
    })
    .from(bookListItem)
    .leftJoin(book, eq(book.id, bookListItem.bookId))
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(refWork, eq(refWork.id, bookListItem.refWorkId))
    .leftJoin(refBook, eq(refBook.id, bookListItem.refBookId))
    .where(eq(bookListItem.listId, listId))
    .orderBy(desc(bookListItem.position), desc(bookListItem.id))
  if (rows.length === 0) return []

  // авторы произведений эталона — отдельным запросом
  const workIds = rows.map((r) => r.refWorkId).filter((id): id is string => !!id)
  const workAuthors = new Map<string, string>()
  if (workIds.length > 0) {
    const authorRows = await db
      .select({ workId: refWorkAuthor.workId, name: authorTable.name })
      .from(refWorkAuthor)
      .innerJoin(authorTable, eq(authorTable.id, refWorkAuthor.authorId))
      .where(inArray(refWorkAuthor.workId, workIds))
    for (const a of authorRows) {
      if (!workAuthors.has(a.workId)) workAuthors.set(a.workId, a.name)
    }
  }

  // мои книги для эталонных элементов: издание → произведения → мои экземпляры
  const mine = userId ? await myBooksForWorks(userId, workIds, rows) : new Map()

  const PLACE_BY_STATUS: Record<string, string> = {
    wishlist: 'в «Хочу»',
    gifted: 'подарена',
    lost: 'потеряна',
  }

  return rows.map((r) => {
    if (r.bookId) {
      const place =
        r.bookStatus === 'in_library'
          ? (r.shelfName ?? r.libraryName ?? 'в библиотеке')
          : (PLACE_BY_STATUS[r.bookStatus ?? ''] ?? null)
      return {
        id: r.id,
        title: r.bookTitle ?? '',
        authors: r.bookAuthors ?? '',
        year: r.bookYear,
        note: r.note,
        coverUrl: r.bookCover ? `/api/covers/${r.bookId}?v=${r.bookCover}` : null,
        coverColor: r.bookColor,
        myBookId: r.bookStatus === 'in_library' ? r.bookId : null,
        place,
        refWorkId: null,
        refBookId: null,
      }
    }
    const key = r.refWorkId ?? r.refBookId ?? ''
    const found = mine.get(key) as
      | { bookId: string; place: string | null }
      | undefined
    return {
      id: r.id,
      title: r.workTitle ?? r.editionTitle ?? '',
      authors: r.refWorkId
        ? (workAuthors.get(r.refWorkId) ?? '')
        : (r.editionAuthors ?? ''),
      year: r.workYear ?? r.editionYear,
      note: r.note,
      coverUrl: r.editionCover ? `/api/ref-covers/${r.refBookId}` : null,
      coverColor: r.editionColor,
      myBookId: found?.bookId ?? null,
      place: found?.place ?? null,
      refWorkId: r.refWorkId,
      refBookId: r.refBookId,
    }
  })
}

/** Мои экземпляры для эталонных элементов списка. */
async function myBooksForWorks(
  userId: string,
  workIds: Array<string>,
  rows: Array<{ refBookId: string | null; refWorkId: string | null }>,
): Promise<Map<string, { bookId: string; place: string | null }>> {
  const editionIds = rows
    .map((r) => r.refBookId)
    .filter((id): id is string => !!id)
  const out = new Map<string, { bookId: string; place: string | null }>()
  if (workIds.length === 0 && editionIds.length === 0) return out

  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    eq(book.addedBy, userId),
  )

  // издания, покрывающие эти произведения
  const covers =
    workIds.length > 0
      ? await db
          .select({
            refBookId: refBookWork.refBookId,
            workId: refBookWork.workId,
          })
          .from(refBookWork)
          .where(inArray(refBookWork.workId, workIds))
      : []

  const mine = await db
    .select({
      id: book.id,
      refBookId: book.refBookId,
      refWorkId: book.refWorkId,
      status: book.status,
      shelfName: shelf.name,
      libraryName: library.name,
    })
    .from(book)
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .where(and(accessible, eq(book.status, 'in_library')))

  const place = (b: (typeof mine)[number]) =>
    b.shelfName ?? b.libraryName ?? 'в библиотеке'

  for (const b of mine) {
    if (b.refWorkId && workIds.includes(b.refWorkId)) {
      out.set(b.refWorkId, { bookId: b.id, place: place(b) })
    }
    if (b.refBookId) {
      if (editionIds.includes(b.refBookId)) {
        out.set(b.refBookId, { bookId: b.id, place: place(b) })
      }
      for (const c of covers.filter((x) => x.refBookId === b.refBookId)) {
        if (!out.has(c.workId))
          out.set(c.workId, { bookId: b.id, place: place(b) })
      }
    }
  }
  return out
}

export async function createList(
  userId: string,
  input: { kind: ListKind; title: string; description?: string },
): Promise<{ id: string }> {
  const title = input.title.trim()
  if (!title) throw new AppError('Нужно название списка', 'invalid')
  const [created] = await db
    .insert(bookList)
    .values({
      ownerId: userId,
      kind: input.kind,
      title,
      description: input.description?.trim() || null,
    })
    .returning({ id: bookList.id })
  if (!created) throw new AppError('Не получилось создать список', 'invalid')
  return created
}

export async function updateList(
  userId: string,
  listId: string,
  patch: { title?: string; description?: string | null; kind?: ListKind },
): Promise<void> {
  await requireOwnList(userId, listId)
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title) throw new AppError('Нужно название списка', 'invalid')
    set.title = title
  }
  if (patch.description !== undefined)
    set.description = patch.description?.trim() || null
  if (patch.kind !== undefined) set.kind = patch.kind
  await db.update(bookList).set(set).where(eq(bookList.id, listId))
}

export async function deleteList(
  userId: string,
  listId: string,
): Promise<void> {
  await requireOwnList(userId, listId)
  await db.delete(bookList).where(eq(bookList.id, listId))
}

/** Добавить книгу в список; новое встаёт сверху. */
export async function addToList(
  userId: string,
  listId: string,
  target: ItemTarget,
  note?: string,
): Promise<void> {
  await requireOwnList(userId, listId)
  const [top] = await db
    .select({ position: bookListItem.position })
    .from(bookListItem)
    .where(eq(bookListItem.listId, listId))
    .orderBy(desc(bookListItem.position))
    .limit(1)
  await db
    .insert(bookListItem)
    .values({
      listId,
      bookId: 'bookId' in target ? target.bookId : null,
      refWorkId: 'refWorkId' in target ? target.refWorkId : null,
      refBookId: 'refBookId' in target ? target.refBookId : null,
      note: note?.trim() || null,
      position: (top?.position ?? 0) + 1,
      addedBy: userId,
    })
    .onConflictDoNothing()
}

export async function removeFromList(
  userId: string,
  listId: string,
  target: ItemTarget,
): Promise<void> {
  await requireOwnList(userId, listId)
  await db
    .delete(bookListItem)
    .where(and(eq(bookListItem.listId, listId), targetCondition(target)))
}

export async function removeItem(
  userId: string,
  itemId: string,
): Promise<void> {
  const [row] = await db
    .select({ listId: bookListItem.listId })
    .from(bookListItem)
    .where(eq(bookListItem.id, itemId))
  if (!row) return
  await requireOwnList(userId, row.listId)
  await db.delete(bookListItem).where(eq(bookListItem.id, itemId))
}

export async function setItemNote(
  userId: string,
  itemId: string,
  note: string,
): Promise<void> {
  const [row] = await db
    .select({ listId: bookListItem.listId })
    .from(bookListItem)
    .where(eq(bookListItem.id, itemId))
  if (!row) throw new AppError('Книга не найдена в списке', 'not_found')
  await requireOwnList(userId, row.listId)
  await db
    .update(bookListItem)
    .set({ note: note.trim() || null })
    .where(eq(bookListItem.id, itemId))
}

export interface ListPick {
  id: string
  kind: ListKind
  title: string
  itemCount: number
  /** Книга уже в этом списке. */
  contains: boolean
}

/** Шторка «+»: все мои списки с отметкой, где книга уже есть. */
export async function listsForTarget(
  userId: string,
  target: ItemTarget,
): Promise<Array<ListPick>> {
  const lists = await db
    .select()
    .from(bookList)
    .where(eq(bookList.ownerId, userId))
    .orderBy(asc(bookList.position), desc(bookList.createdAt))
  if (lists.length === 0) return []
  const counts = await db
    .select({
      listId: bookListItem.listId,
      total: sql<number>`count(*)`,
    })
    .from(bookListItem)
    .where(
      inArray(
        bookListItem.listId,
        lists.map((l) => l.id),
      ),
    )
    .groupBy(bookListItem.listId)
  const countByList = new Map(counts.map((c) => [c.listId, c.total]))

  const hits = await db
    .select({ listId: bookListItem.listId })
    .from(bookListItem)
    .where(
      and(
        inArray(
          bookListItem.listId,
          lists.map((l) => l.id),
        ),
        targetCondition(target),
      ),
    )
  const hitIds = new Set(hits.map((h) => h.listId))

  return lists.map((l) => ({
    id: l.id,
    kind: l.kind,
    title: l.title,
    itemCount: countByList.get(l.id) ?? 0,
    contains: hitIds.has(l.id),
  }))
}

export interface ListBadge {
  id: string
  kind: ListKind
  title: string
}

/** Ключ элемента для батч-запроса членства в списках. */
export const targetKey = (target: ItemTarget): string =>
  'bookId' in target
    ? `book:${target.bookId}`
    : 'refWorkId' in target
      ? `work:${target.refWorkId}`
      : `edition:${target.refBookId}`

/**
 * В каких списках состоят указанные книги — одним запросом.
 * Нужно для индикации: на карточке, у произведения, в библиографии.
 */
export async function listsForTargets(
  userId: string,
  targets: Array<ItemTarget>,
): Promise<Map<string, Array<ListBadge>>> {
  const out = new Map<string, Array<ListBadge>>()
  if (targets.length === 0) return out

  const bookIds = targets.flatMap((t) => ('bookId' in t ? [t.bookId] : []))
  const workIds = targets.flatMap((t) => ('refWorkId' in t ? [t.refWorkId] : []))
  const editionIds = targets.flatMap((t) =>
    'refBookId' in t ? [t.refBookId] : [],
  )

  const rows = await db
    .select({
      listId: bookList.id,
      kind: bookList.kind,
      title: bookList.title,
      bookId: bookListItem.bookId,
      refWorkId: bookListItem.refWorkId,
      refBookId: bookListItem.refBookId,
    })
    .from(bookListItem)
    .innerJoin(bookList, eq(bookList.id, bookListItem.listId))
    .where(
      and(
        eq(bookList.ownerId, userId),
        or(
          bookIds.length > 0
            ? inArray(bookListItem.bookId, bookIds)
            : undefined,
          workIds.length > 0
            ? inArray(bookListItem.refWorkId, workIds)
            : undefined,
          editionIds.length > 0
            ? inArray(bookListItem.refBookId, editionIds)
            : undefined,
        ),
      ),
    )
    .orderBy(asc(bookList.title))

  for (const row of rows) {
    const key = row.bookId
      ? `book:${row.bookId}`
      : row.refWorkId
        ? `work:${row.refWorkId}`
        : `edition:${row.refBookId}`
    const badge = { id: row.listId, kind: row.kind, title: row.title }
    const list = out.get(key) ?? []
    list.push(badge)
    out.set(key, list)
  }
  return out
}

/** Списки одной книги — для карточки и страниц эталона. */
export async function listsForOne(
  userId: string,
  target: ItemTarget,
): Promise<Array<ListBadge>> {
  const found = await listsForTargets(userId, [target])
  return found.get(targetKey(target)) ?? []
}

/** Переезд старого виш-листа: книги со статусом wishlist → список «Хочу почитать». */
export async function backfillWishlists(): Promise<void> {
  const owners = await db
    .select({ userId: book.addedBy })
    .from(book)
    .where(eq(book.status, 'wishlist'))
    .groupBy(book.addedBy)
  for (const { userId } of owners) {
    const [existing] = await db
      .select({ id: bookList.id })
      .from(bookList)
      .where(and(eq(bookList.ownerId, userId), eq(bookList.kind, 'wishlist')))
      .orderBy(asc(bookList.createdAt))
      .limit(1)
    const listId =
      existing?.id ??
      (await createList(userId, { kind: 'wishlist', title: 'Хочу почитать' }))
        .id
    const books = await db
      .select({ id: book.id, createdAt: book.createdAt })
      .from(book)
      .where(and(eq(book.addedBy, userId), eq(book.status, 'wishlist')))
      .orderBy(asc(book.createdAt))
    for (const b of books) {
      await addToList(userId, listId, { bookId: b.id })
    }
  }
}

/** Вишлист по умолчанию — куда ведёт /wishlist. */
export async function defaultWishlistId(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: bookList.id })
    .from(bookList)
    .where(and(eq(bookList.ownerId, userId), eq(bookList.kind, 'wishlist')))
    .orderBy(asc(bookList.position), asc(bookList.createdAt))
    .limit(1)
  return row?.id ?? null
}
