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
  /** Форма элемента: моя книга, произведение или издание эталона. */
  form: 'book' | 'work' | 'edition'
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
        form: 'book' as const,
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
      form: r.refWorkId ? ('work' as const) : ('edition' as const),
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

export interface ListMatch {
  itemId: string
  form: 'book' | 'work' | 'edition'
  /** «как произведение» / «издание 2017 года» / «книга с полки». */
  formLabel: string
  /** Для ссылки «к изданию →» при конфликте форм. */
  refBookId: string | null
}

export interface ListPick {
  id: string
  kind: ListKind
  title: string
  itemCount: number
  /** Книга уже в этом списке (в любой форме). */
  contains: boolean
  /** Какой именно элемент там лежит — тап убирает его. */
  match: ListMatch | null
  /** Конфликт форм: цель-издание поверх произведения или наоборот. */
  conflict: 'work-behind' | 'edition-behind' | null
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

/** Связанные сущности цели: та же книга во всех трёх формах. */
interface TargetLinks {
  books: Set<string>
  works: Set<string>
  editions: Set<string>
}

/**
 * Сквозной резолв «это одна и та же книга»: моя книга ↔ произведение ↔
 * издание связываются через book.refBookId / book.refWorkId / ref_book_work
 * и совпадение названий — тот же механизм, что «есть» в библиографии.
 */
async function expandTargets(
  userId: string,
  targets: Array<ItemTarget>,
): Promise<Map<string, TargetLinks>> {
  const out = new Map<string, TargetLinks>()
  const targetBookIds = targets.flatMap((t) => ('bookId' in t ? [t.bookId] : []))
  const targetWorkIds = targets.flatMap((t) =>
    'refWorkId' in t ? [t.refWorkId] : [],
  )
  const targetEditionIds = targets.flatMap((t) =>
    'refBookId' in t ? [t.refBookId] : [],
  )

  // мои книги-цели: их связи с эталоном
  const targetBooks =
    targetBookIds.length > 0
      ? await db
          .select({
            id: book.id,
            refBookId: book.refBookId,
            refWorkId: book.refWorkId,
            titleNorm: book.titleNorm,
          })
          .from(book)
          .where(inArray(book.id, targetBookIds))
      : []

  // произведения книг без прямой связи — по названию (fallback, как в циклах)
  const orphanNorms = targetBooks
    .filter((b) => !b.refBookId && !b.refWorkId)
    .map((b) => b.titleNorm)
  const worksByNorm =
    orphanNorms.length > 0
      ? await db
          .select({ id: refWork.id, titleNorm: refWork.titleNorm })
          .from(refWork)
          .where(inArray(refWork.titleNorm, orphanNorms))
      : []

  // все затронутые издания и произведения (цели + связи книг)
  const editionPool = new Set([
    ...targetEditionIds,
    ...targetBooks.flatMap((b) => (b.refBookId ? [b.refBookId] : [])),
  ])
  const workPool = new Set([
    ...targetWorkIds,
    ...targetBooks.flatMap((b) => (b.refWorkId ? [b.refWorkId] : [])),
    ...worksByNorm.map((w) => w.id),
  ])

  // связка изданий и произведений — в обе стороны
  const coverRows =
    editionPool.size > 0 || workPool.size > 0
      ? await db
          .select({
            refBookId: refBookWork.refBookId,
            workId: refBookWork.workId,
          })
          .from(refBookWork)
          .where(
            or(
              editionPool.size > 0
                ? inArray(refBookWork.refBookId, [...editionPool])
                : undefined,
              workPool.size > 0
                ? inArray(refBookWork.workId, [...workPool])
                : undefined,
            ),
          )
      : []
  const worksOfEdition = new Map<string, Array<string>>()
  const editionsOfWork = new Map<string, Array<string>>()
  for (const c of coverRows) {
    worksOfEdition.set(c.refBookId, [
      ...(worksOfEdition.get(c.refBookId) ?? []),
      c.workId,
    ])
    editionsOfWork.set(c.workId, [
      ...(editionsOfWork.get(c.workId) ?? []),
      c.refBookId,
    ])
  }

  // названия произведений — для поиска моих книг по совпадению
  const allWorkIds = new Set([
    ...workPool,
    ...coverRows.map((c) => c.workId),
  ])
  const workRows =
    allWorkIds.size > 0
      ? await db
          .select({ id: refWork.id, titleNorm: refWork.titleNorm })
          .from(refWork)
          .where(inArray(refWork.id, [...allWorkIds]))
      : []
  const normOfWork = new Map(workRows.map((w) => [w.id, w.titleNorm]))

  // мои книги, связанные с затронутыми произведениями и изданиями
  const allEditionIds = new Set([
    ...editionPool,
    ...coverRows.map((c) => c.refBookId),
  ])
  const norms = new Set(workRows.map((w) => w.titleNorm))
  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    eq(book.addedBy, userId),
  )
  const myBooks =
    allWorkIds.size > 0 || allEditionIds.size > 0
      ? await db
          .select({
            id: book.id,
            refBookId: book.refBookId,
            refWorkId: book.refWorkId,
            titleNorm: book.titleNorm,
          })
          .from(book)
          .where(
            and(
              accessible,
              or(
                allWorkIds.size > 0
                  ? inArray(book.refWorkId, [...allWorkIds])
                  : undefined,
                allEditionIds.size > 0
                  ? inArray(book.refBookId, [...allEditionIds])
                  : undefined,
                norms.size > 0
                  ? inArray(book.titleNorm, [...norms])
                  : undefined,
              ),
            ),
          )
      : []

  const booksOfWork = (workId: string): Array<string> => {
    const norm = normOfWork.get(workId)
    const editions = new Set(editionsOfWork.get(workId) ?? [])
    return myBooks
      .filter(
        (b) =>
          b.refWorkId === workId ||
          (b.refBookId !== null && editions.has(b.refBookId)) ||
          (norm !== undefined && b.titleNorm === norm),
      )
      .map((b) => b.id)
  }

  for (const target of targets) {
    const links: TargetLinks = {
      books: new Set(),
      works: new Set(),
      editions: new Set(),
    }
    if ('bookId' in target) {
      links.books.add(target.bookId)
      const row = targetBooks.find((b) => b.id === target.bookId)
      if (row) {
        if (row.refWorkId) links.works.add(row.refWorkId)
        if (row.refBookId) {
          links.editions.add(row.refBookId)
          for (const w of worksOfEdition.get(row.refBookId) ?? [])
            links.works.add(w)
        }
        if (!row.refBookId && !row.refWorkId) {
          for (const w of worksByNorm.filter(
            (x) => x.titleNorm === row.titleNorm,
          ))
            links.works.add(w.id)
        }
        // другие издания тех же произведений — та же книга по смыслу
        for (const w of links.works)
          for (const e of editionsOfWork.get(w) ?? []) links.editions.add(e)
      }
    } else if ('refWorkId' in target) {
      links.works.add(target.refWorkId)
      for (const e of editionsOfWork.get(target.refWorkId) ?? [])
        links.editions.add(e)
      for (const b of booksOfWork(target.refWorkId)) links.books.add(b)
    } else {
      links.editions.add(target.refBookId)
      for (const w of worksOfEdition.get(target.refBookId) ?? []) {
        links.works.add(w)
        for (const b of booksOfWork(w)) links.books.add(b)
      }
      for (const b of myBooks.filter((x) => x.refBookId === target.refBookId))
        links.books.add(b.id)
    }
    out.set(targetKey(target), links)
  }
  return out
}

interface FoundItem {
  itemId: string
  listId: string
  kind: ListKind
  listTitle: string
  form: 'book' | 'work' | 'edition'
  bookId: string | null
  refWorkId: string | null
  refBookId: string | null
  editionYear: number | null
}

/** Элементы всех моих списков, задевающие связанные сущности целей. */
async function findRelatedItems(
  userId: string,
  linksByKey: Map<string, TargetLinks>,
): Promise<Array<FoundItem>> {
  const allBooks = new Set<string>()
  const allWorks = new Set<string>()
  const allEditions = new Set<string>()
  for (const links of linksByKey.values()) {
    for (const b of links.books) allBooks.add(b)
    for (const w of links.works) allWorks.add(w)
    for (const e of links.editions) allEditions.add(e)
  }
  if (allBooks.size + allWorks.size + allEditions.size === 0) return []

  const rows = await db
    .select({
      itemId: bookListItem.id,
      listId: bookList.id,
      kind: bookList.kind,
      listTitle: bookList.title,
      bookId: bookListItem.bookId,
      refWorkId: bookListItem.refWorkId,
      refBookId: bookListItem.refBookId,
      editionYear: refBook.year,
    })
    .from(bookListItem)
    .innerJoin(bookList, eq(bookList.id, bookListItem.listId))
    .leftJoin(refBook, eq(refBook.id, bookListItem.refBookId))
    .where(
      and(
        eq(bookList.ownerId, userId),
        or(
          allBooks.size > 0
            ? inArray(bookListItem.bookId, [...allBooks])
            : undefined,
          allWorks.size > 0
            ? inArray(bookListItem.refWorkId, [...allWorks])
            : undefined,
          allEditions.size > 0
            ? inArray(bookListItem.refBookId, [...allEditions])
            : undefined,
        ),
      ),
    )
    .orderBy(asc(bookList.title))

  return rows.map((r) => ({
    itemId: r.itemId,
    listId: r.listId,
    kind: r.kind,
    listTitle: r.listTitle,
    form: r.bookId ? 'book' : r.refWorkId ? 'work' : 'edition',
    bookId: r.bookId,
    refWorkId: r.refWorkId,
    refBookId: r.refBookId,
    editionYear: r.editionYear,
  }))
}

const itemMatchesLinks = (item: FoundItem, links: TargetLinks): boolean =>
  (item.bookId !== null && links.books.has(item.bookId)) ||
  (item.refWorkId !== null && links.works.has(item.refWorkId)) ||
  (item.refBookId !== null && links.editions.has(item.refBookId))

const formLabelOf = (item: FoundItem): string =>
  item.form === 'work'
    ? 'как произведение'
    : item.form === 'edition'
      ? item.editionYear
        ? `издание ${item.editionYear} года`
        : 'как издание'
      : 'книга из каталога'

/**
 * В каких списках состоят указанные книги — сквозно по всем формам.
 * Одна пачка запросов на весь набор целей (карточка, библиография, цикл).
 */
export async function listsForTargets(
  userId: string,
  targets: Array<ItemTarget>,
): Promise<Map<string, Array<ListBadge>>> {
  const out = new Map<string, Array<ListBadge>>()
  if (targets.length === 0) return out
  const linksByKey = await expandTargets(userId, targets)
  const items = await findRelatedItems(userId, linksByKey)

  for (const [key, links] of linksByKey) {
    const seen = new Set<string>()
    const badges: Array<ListBadge> = []
    for (const item of items) {
      if (seen.has(item.listId) || !itemMatchesLinks(item, links)) continue
      seen.add(item.listId)
      badges.push({ id: item.listId, kind: item.kind, title: item.listTitle })
    }
    if (badges.length > 0) out.set(key, badges)
  }
  return out
}

/** Списки одной книги — для чипов на карточке и страницах эталона. */
export async function listsForOne(
  userId: string,
  target: ItemTarget,
): Promise<Array<ListBadge>> {
  const found = await listsForTargets(userId, [target])
  return found.get(targetKey(target)) ?? []
}

/** Прямое членство изданий (без сквозного резолва) — отметки в строках изданий. */
export async function editionsInLists(
  userId: string,
  editionIds: Array<string>,
): Promise<Map<string, Array<ListBadge>>> {
  const out = new Map<string, Array<ListBadge>>()
  if (editionIds.length === 0) return out
  const rows = await db
    .select({
      listId: bookList.id,
      kind: bookList.kind,
      title: bookList.title,
      refBookId: bookListItem.refBookId,
    })
    .from(bookListItem)
    .innerJoin(bookList, eq(bookList.id, bookListItem.listId))
    .where(
      and(
        eq(bookList.ownerId, userId),
        inArray(bookListItem.refBookId, editionIds),
      ),
    )
    .orderBy(asc(bookList.title))
  for (const r of rows) {
    if (!r.refBookId) continue
    const list = out.get(r.refBookId) ?? []
    list.push({ id: r.listId, kind: r.kind, title: r.title })
    out.set(r.refBookId, list)
  }
  return out
}

/** Шторка «+»: все мои списки, членство сквозное, с конфликтами форм. */
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

  const linksByKey = await expandTargets(userId, [target])
  const links = linksByKey.get(targetKey(target))
  const items = links ? await findRelatedItems(userId, linksByKey) : []

  return lists.map((l) => {
    const related = items.filter(
      (i) => i.listId === l.id && links && itemMatchesLinks(i, links),
    )
    // точная форма цели важнее связанной: тап убирает именно её
    const exact = related.find(
      (i) =>
        ('bookId' in target && i.bookId === target.bookId) ||
        ('refWorkId' in target && i.refWorkId === target.refWorkId) ||
        ('refBookId' in target && i.refBookId === target.refBookId),
    )
    const match = exact ?? related[0] ?? null
    // конфликт только когда точной формы нет, а связанная — есть
    const conflict =
      exact || !match
        ? null
        : 'refBookId' in target && match.form === 'work'
          ? ('work-behind' as const)
          : 'refWorkId' in target && match.form === 'edition'
            ? ('edition-behind' as const)
            : null
    return {
      id: l.id,
      kind: l.kind,
      title: l.title,
      itemCount: countByList.get(l.id) ?? 0,
      contains: match !== null,
      match: match
        ? {
            itemId: match.itemId,
            form: match.form,
            formLabel: formLabelOf(match),
            refBookId: match.refBookId,
          }
        : null,
      conflict,
    }
  })
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
