import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  like,
  lte,
  or,
  sql,
} from 'drizzle-orm'

import { db } from '@/db'
import {
  book,
  bookPersonal,
  bookTag,
  library,
  refBook as refBookTable,
  series,
  shelf,
  tag,
} from '@/db/schema/catalog'
import { loan } from '@/db/schema/circulation'
import { deleteCover, saveCoverFromUrl } from './covers'
import { AppError } from './errors'
import { assertMember, memberLibraryIds } from './members'
import { normalizeForSearch } from './search'
import { resolveSeriesByName, sanitizeLike } from './series'
import { bookAuthorLinks, syncBookAuthors } from './authors'
import { listsForOne } from './lists'
import { bestRefBookIdForIsbn } from './reference'
import { setBookTags } from './tags'
import type { ListBadge } from './lists'

export interface BookInput {
  title: string
  authors?: string
  isbn10?: string
  isbn13?: string
  publisher?: string
  year?: number | null
  pages?: number | null
  language?: string
  annotation?: string
  notes?: never // личные заметки живут в book_personal (M5)
  seriesName?: string
  seriesNumber?: string
  tags?: Array<string>
  libraryId?: string | null
  shelfId?: string | null
  wishlist?: boolean
  /** URL обложки из метаданных — скачается на диск при сохранении (best-effort). */
  coverUrl?: string
  coverType?: 'soft' | 'hard' | null
  giftEdition?: boolean
  heightMm?: number | null
  /** Зацепки FantLab-авторов из lookup — проставляют author.fantlabId. */
  fantlabAuthors?: Array<{ name: string; id: number }>
  /** Желание уровня произведения («Хочу» из библиографии). */
  refWorkId?: string | null
  /** Книги нет дома — кладём сразу в этот список (M17). */
  listId?: string | null
  /** Болванка из сканера: только ISBN, название заполним потом (M18). */
  unrecognized?: boolean
}

async function assertShelfInLibrary(
  shelfId: string,
  libraryId: string,
): Promise<void> {
  const [found] = await db
    .select({ libraryId: shelf.libraryId })
    .from(shelf)
    .where(eq(shelf.id, shelfId))
  if (!found || found.libraryId !== libraryId) {
    throw new AppError('Полка не из этой библиотеки', 'invalid')
  }
}

async function placementFor(
  userId: string,
  input: Pick<BookInput, 'libraryId' | 'shelfId' | 'wishlist'>,
): Promise<{
  libraryId: string | null
  shelfId: string | null
  status: 'in_library' | 'wishlist'
}> {
  if (input.wishlist)
    return { libraryId: null, shelfId: null, status: 'wishlist' }
  if (!input.libraryId)
    throw new AppError('Выберите библиотеку или отметьте «Хочу»', 'invalid')
  await assertMember(userId, input.libraryId)
  if (input.shelfId) await assertShelfInLibrary(input.shelfId, input.libraryId)
  return {
    libraryId: input.libraryId,
    shelfId: input.shelfId ?? null,
    status: 'in_library',
  }
}

export async function createBook(
  userId: string,
  input: BookInput,
): Promise<{ id: string }> {
  const placement = await placementFor(userId, input)
  // сохранить можно и по одному ISBN: названием временно служит номер —
  // так книга находится поиском и не выглядит пустой строкой.
  // Без номера название обязательно.
  const isbn = input.isbn13?.trim() ?? ''
  const title = input.title.trim() || isbn
  if (!title) {
    throw new AppError('Нужно название книги или ISBN', 'invalid')
  }
  // Без названия книга — болванка, что бы ни прислал клиент: иначе скан по
  // одному ISBN теряется в «Неразобранном» и в «Не распознано» не попадает.
  const unrecognized = !input.title.trim() || (input.unrecognized ?? false)
  const seriesId = input.seriesName
    ? await resolveSeriesByName(userId, input.seriesName)
    : null
  const refBookId = input.isbn13?.trim()
    ? await bestRefBookIdForIsbn(input.isbn13.trim())
    : null
  const [created] = await db
    .insert(book)
    .values({
      addedBy: userId,
      refBookId,
      refWorkId: input.refWorkId ?? null,
      libraryId: placement.libraryId,
      shelfId: placement.shelfId,
      status: placement.status,
      title,
      authors: input.authors?.trim() ?? '',
      isbn10: input.isbn10?.trim() || null,
      isbn13: input.isbn13?.trim() || null,
      publisher: input.publisher?.trim() || null,
      year: input.year ?? null,
      pages: input.pages ?? null,
      language: input.language?.trim() || 'ru',
      annotation: input.annotation?.trim() || null,
      seriesId,
      seriesNumber: input.seriesNumber?.trim() || null,
      coverType: input.coverType ?? null,
      giftEdition: input.giftEdition ?? false,
      heightMm: input.heightMm ?? null,
      unrecognized,
      titleNorm: normalizeForSearch(title),
      authorsNorm: normalizeForSearch(input.authors ?? ''),
    })
    .returning({ id: book.id })
  if (!created) throw new AppError('Не удалось сохранить книгу')
  await syncBookAuthors(created.id, input.authors ?? '', input.fantlabAuthors)
  // «книги нет дома» — сразу в выбранный список, без ожидания бэкфилла
  if (input.listId) {
    const { addToList } = await import('./lists')
    await addToList(userId, input.listId, { bookId: created.id })
  }
  if (input.tags) await setBookTags(userId, created.id, input.tags)
  if (input.coverUrl) {
    try {
      const saved = await saveCoverFromUrl(created.id, input.coverUrl)
      await db
        .update(book)
        .set({ coverPath: saved.path, coverColor: saved.color })
        .where(eq(book.id, created.id))
    } catch {
      // обложка — best-effort: карточка сохраняется и без неё
    }
  } else if (refBookId) {
    // обложка уже есть в эталоне — копия файла без похода в сеть
    const { copyRefCoverToBook } = await import('./covers')
    const [ref] = await db
      .select({ coverPath: refBookTable.coverPath })
      .from(refBookTable)
      .where(eq(refBookTable.id, refBookId))
    if (ref?.coverPath) {
      const saved = await copyRefCoverToBook(created.id, ref.coverPath)
      if (saved) {
        await db
          .update(book)
          .set({ coverPath: saved.path, coverColor: saved.color })
          .where(eq(book.id, created.id))
      }
    }
  }
  return created
}

/** Книга доступна: участник её библиотеки, либо это свой виш-лист. */
export async function requireBookAccess(userId: string, bookId: string) {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  if (row.libraryId) {
    await assertMember(userId, row.libraryId)
  } else if (row.addedBy !== userId) {
    throw new AppError('Нет доступа к этой книге', 'forbidden')
  }
  return row
}

export async function updateBook(
  userId: string,
  bookId: string,
  input: BookInput,
): Promise<void> {
  const current = await requireBookAccess(userId, bookId)
  const placement = await placementFor(userId, input)
  const seriesId = input.seriesName
    ? await resolveSeriesByName(userId, input.seriesName)
    : null
  const refBookId =
    !current.refBookId && input.isbn13?.trim()
      ? await bestRefBookIdForIsbn(input.isbn13.trim())
      : current.refBookId
  await db
    .update(book)
    .set({
      refBookId,
      libraryId: placement.libraryId,
      shelfId: placement.shelfId,
      status:
        current.status === 'gifted' || current.status === 'lost'
          ? current.status // владельческий статус в M3 не трогаем — переходы в M5
          : placement.status,
      title: input.title.trim(),
      authors: input.authors?.trim() ?? '',
      isbn10: input.isbn10?.trim() || null,
      isbn13: input.isbn13?.trim() || null,
      publisher: input.publisher?.trim() || null,
      year: input.year ?? null,
      pages: input.pages ?? null,
      language: input.language?.trim() || 'ru',
      annotation: input.annotation?.trim() || null,
      seriesId,
      seriesNumber: input.seriesNumber?.trim() || null,
      coverType: input.coverType ?? null,
      giftEdition: input.giftEdition ?? false,
      heightMm: input.heightMm ?? null,
      titleNorm: normalizeForSearch(input.title),
      authorsNorm: normalizeForSearch(input.authors ?? ''),
      unrecognized:
        current.unrecognized && input.title.trim() !== current.title
          ? false
          : current.unrecognized,
      updatedAt: new Date(),
    })
    .where(eq(book.id, bookId))
  await syncBookAuthors(bookId, input.authors ?? '', input.fantlabAuthors)
  if (input.tags) await setBookTags(userId, bookId, input.tags)
}

export async function deleteBook(
  userId: string,
  bookId: string,
): Promise<void> {
  const row = await requireBookAccess(userId, bookId)
  await db.delete(book).where(eq(book.id, bookId))
  if (row.coverPath) await deleteCover(row.coverPath)
}

/** Массовое перемещение: на полку/в «Неразобранное» целевой библиотеки. Виш-лист при этом «куплен». */
export async function moveBooks(
  userId: string,
  bookIds: Array<string>,
  target: { libraryId: string; shelfId: string | null },
): Promise<void> {
  if (bookIds.length === 0) return
  await assertMember(userId, target.libraryId)
  if (target.shelfId)
    await assertShelfInLibrary(target.shelfId, target.libraryId)
  for (const id of bookIds) await requireBookAccess(userId, id)
  await db
    .update(book)
    .set({
      libraryId: target.libraryId,
      shelfId: target.shelfId,
      status: sql`CASE WHEN ${book.status} = 'wishlist' THEN 'in_library' ELSE ${book.status} END`,
      updatedAt: new Date(),
    })
    .where(inArray(book.id, bookIds))
}

export interface BookCard {
  id: string
  title: string
  authors: string
  isbn10: string | null
  isbn13: string | null
  publisher: string | null
  year: number | null
  pages: number | null
  language: string
  annotation: string | null
  coverPath: string | null
  status: string
  giftedTo: string | null
  giftedAt: Date | null
  seriesId: string | null
  seriesName: string | null
  seriesNumber: string | null
  libraryId: string | null
  libraryName: string | null
  shelfId: string | null
  shelfName: string | null
  tags: Array<string>
  addedBy: string
  createdAt: Date
  hidden: boolean
  coverType: 'soft' | 'hard' | null
  giftEdition: boolean
  heightMm: number | null
  authorLinks: Array<{ id: string; name: string }>
  /** Вишлисты и подборки, где книга состоит (M17). */
  lists: Array<ListBadge>
}

export async function getBookCard(
  userId: string,
  bookId: string,
): Promise<BookCard> {
  const row = await requireBookAccess(userId, bookId)
  const [joined] = await db
    .select({
      seriesName: series.name,
      libraryName: library.name,
      shelfName: shelf.name,
    })
    .from(book)
    .leftJoin(series, eq(series.id, book.seriesId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .where(eq(book.id, bookId))
  if (!joined) throw new AppError('Книга не найдена', 'not_found')
  const tags = await db
    .select({ name: tag.name })
    .from(bookTag)
    .innerJoin(tag, eq(tag.id, bookTag.tagId))
    .where(eq(bookTag.bookId, bookId))
    .orderBy(asc(tag.name))
  const authorLinks = await bookAuthorLinks(bookId)
  const lists = await listsForOne(userId, { bookId })
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    isbn10: row.isbn10,
    isbn13: row.isbn13,
    publisher: row.publisher,
    year: row.year,
    pages: row.pages,
    language: row.language,
    annotation: row.annotation,
    coverPath: row.coverPath,
    status: row.status,
    giftedTo: row.giftedTo,
    giftedAt: row.giftedAt,
    seriesId: row.seriesId,
    seriesName: joined.seriesName,
    seriesNumber: row.seriesNumber,
    libraryId: row.libraryId,
    libraryName: joined.libraryName,
    shelfId: row.shelfId,
    shelfName: joined.shelfName,
    tags: tags.map((t) => t.name),
    addedBy: row.addedBy,
    createdAt: row.createdAt,
    hidden: row.hidden,
    coverType: row.coverType,
    giftEdition: row.giftEdition,
    heightMm: row.heightMm,
    authorLinks,
    lists,
  }
}

export interface CatalogFilters {
  query?: string
  libraryId?: string
  shelfId?: string | 'unsorted'
  seriesId?: string
  tagId?: string
  /** «lent» и «hidden» — не статусы владения: активная выдача и скрытость. */
  status?: 'in_library' | 'wishlist' | 'gifted' | 'lost' | 'lent' | 'hidden'
  /** Фильтр по МОЕМУ статусу чтения (личный слой). */
  reading?: 'unread' | 'reading' | 'read' | 'abandoned'
  /** Подстрока по авторам (нормализованная кириллица). */
  author?: string
  yearFrom?: number
  yearTo?: number
}

export interface CatalogRow {
  id: string
  title: string
  authors: string
  year: number | null
  pages: number | null
  status: string
  coverPath: string | null
  seriesName: string | null
  /** Цикл — его и показываем бейджем в списках (издательская серия не в счёт). */
  cycleTitle: string | null
  libraryId: string | null
  libraryName: string | null
  shelfId: string | null
  shelfName: string | null
  hidden: boolean
  /** Болванка из сканера: показываем номер и штамп вместо названия. */
  unrecognized: boolean
}

const CATALOG_LIMIT = 500

export async function listBooks(
  userId: string,
  filters: CatalogFilters,
): Promise<{ rows: Array<CatalogRow>; total: number }> {
  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    and(eq(book.addedBy, userId), eq(book.status, 'wishlist')),
  )

  const conditions = [accessible]
  if (filters.libraryId) conditions.push(eq(book.libraryId, filters.libraryId))
  if (filters.shelfId === 'unsorted') {
    conditions.push(sql`${book.shelfId} IS NULL`, eq(book.status, 'in_library'))
  } else if (filters.shelfId) {
    conditions.push(eq(book.shelfId, filters.shelfId))
  }
  if (filters.seriesId) conditions.push(eq(book.seriesId, filters.seriesId))
  if (filters.status === 'lent') {
    conditions.push(
      eq(book.status, 'in_library'),
      sql`exists (select 1 from ${loan} where ${loan.bookId} = ${book.id} and ${loan.returnedAt} is null)`,
    )
  } else if (filters.status === 'hidden') {
    conditions.push(eq(book.hidden, true))
  } else if (filters.status) {
    conditions.push(eq(book.status, filters.status))
  }
  if (filters.reading === 'unread') {
    // «не читал» = нет личной записи или она в unread
    conditions.push(
      sql`not exists (select 1 from ${bookPersonal} where ${bookPersonal.bookId} = ${book.id} and ${bookPersonal.userId} = ${userId} and ${bookPersonal.readingStatus} != 'unread')`,
    )
  } else if (filters.reading) {
    conditions.push(
      sql`exists (select 1 from ${bookPersonal} where ${bookPersonal.bookId} = ${book.id} and ${bookPersonal.userId} = ${userId} and ${bookPersonal.readingStatus} = ${filters.reading})`,
    )
  }
  if (filters.tagId) {
    conditions.push(
      sql`exists (select 1 from ${bookTag} where ${bookTag.bookId} = ${book.id} and ${bookTag.tagId} = ${filters.tagId})`,
    )
  }
  if (filters.author?.trim()) {
    conditions.push(
      like(
        book.authorsNorm,
        `%${sanitizeLike(normalizeForSearch(filters.author))}%`,
      ),
    )
  }
  if (filters.yearFrom) conditions.push(gte(book.year, filters.yearFrom))
  if (filters.yearTo) conditions.push(lte(book.year, filters.yearTo))
  if (filters.query?.trim()) {
    const q = `%${sanitizeLike(normalizeForSearch(filters.query))}%`
    // издательская серия в текстовом поиске не участвует (M16) —
    // для неё есть отдельный фильтр
    conditions.push(or(like(book.titleNorm, q), like(book.authorsNorm, q)))
  }

  const rows = await db
    .select({
      id: book.id,
      title: book.title,
      authors: book.authors,
      year: book.year,
      pages: book.pages,
      status: book.status,
      coverPath: book.coverPath,
      seriesName: series.name,
      libraryId: book.libraryId,
      libraryName: library.name,
      shelfId: book.shelfId,
      shelfName: shelf.name,
      hidden: book.hidden,
      unrecognized: book.unrecognized,
    })
    .from(book)
    .leftJoin(series, eq(series.id, book.seriesId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .where(and(...conditions))
    .orderBy(asc(book.titleNorm))
    .limit(CATALOG_LIMIT)
  // бейдж цикла в списках: одним запросом на всю страницу
  const { cycleTitlesForBooks } = await import('./cycles')
  const cycles = await cycleTitlesForBooks(rows.map((r) => r.id))
  return {
    rows: rows.map((row) => ({ ...row, cycleTitle: cycles[row.id] ?? null })),
    total: rows.length,
  }
}

// ── Переходы владения ──────────────────────────────────────────────────

async function assertNotLent(bookId: string): Promise<void> {
  const { activeLoansFor } = await import('./loans')
  const active = await activeLoansFor([bookId])
  const info = active.get(bookId)
  if (info) {
    throw new AppError(
      `Книга на руках у «${info.borrowerName}» — сначала отметьте возврат`,
    )
  }
}

/** Подарена: уходит с полок (виды полок показывают только in_library), остаётся в каталоге фильтром. */
export async function giftBook(
  userId: string,
  bookId: string,
  giftedTo: string,
): Promise<void> {
  await requireBookAccess(userId, bookId)
  await assertNotLent(bookId)
  await db
    .update(book)
    .set({
      status: 'gifted',
      giftedTo: giftedTo.trim() || null,
      giftedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(book.id, bookId))
}

export async function markLost(userId: string, bookId: string): Promise<void> {
  await requireBookAccess(userId, bookId)
  await assertNotLent(bookId)
  await db
    .update(book)
    .set({ status: 'lost', updatedAt: new Date() })
    .where(eq(book.id, bookId))
}

/** «Нашлась»/«вернули подарок»: обратно в библиотеку, на прежнюю полку. */
export async function restoreToLibrary(
  userId: string,
  bookId: string,
): Promise<void> {
  const row = await requireBookAccess(userId, bookId)
  if (!row.libraryId)
    throw new AppError(
      'У книги нет библиотеки — назначьте её через «Переместить»',
    )
  await db
    .update(book)
    .set({
      status: 'in_library',
      giftedTo: null,
      giftedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(book.id, bookId))
}

/** Скрыть/показать книгу гостям: витрины, поиск у друзей, заявки, обложки. */
export async function setBookHidden(
  userId: string,
  bookId: string,
  hidden: boolean,
): Promise<void> {
  await requireBookAccess(userId, bookId)
  await db
    .update(book)
    .set({ hidden, updatedAt: new Date() })
    .where(eq(book.id, bookId))
}

/**
 * Разовая чистка издательств: источники отдают их закавыченными, и это уже
 * попало в карточки. Правим только те строки, где кавычки действительно есть.
 */
export async function backfillPublishers(): Promise<number> {
  const { cleanPublisher } = await import('./aiRecognize')
  const rows = await db
    .select({ id: book.id, publisher: book.publisher })
    .from(book)
    .where(isNotNull(book.publisher))
  let fixed = 0
  for (const row of rows) {
    const cleaned = cleanPublisher(row.publisher)
    if (cleaned !== null && cleaned !== row.publisher) {
      await db
        .update(book)
        .set({ publisher: cleaned })
        .where(eq(book.id, row.id))
      fixed++
    }
  }
  return fixed
}
