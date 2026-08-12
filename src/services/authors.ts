import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm'

import { db } from '@/db'
import { author, book, bookAuthor, series } from '@/db/schema/catalog'
import { AppError } from './errors'
import { memberLibraryIds } from './members'
import { authorBibliography, authorRefUpdatedAt } from './reference'
import type { BibliographyRow } from './reference'
import { normalizeForSearch } from './search'

/** Разрез строки «Фамилия Имя; Фамилия Имя» на имена. */
export function parseAuthors(value: string): Array<string> {
  return value
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Автор по имени: найдёт по nameNorm или создаст. */
export async function ensureAuthor(name: string): Promise<string> {
  const norm = normalizeForSearch(name)
  const [existing] = await db
    .select({ id: author.id })
    .from(author)
    .where(eq(author.nameNorm, norm))
  if (existing) return existing.id
  const [created] = await db
    .insert(author)
    .values({ name, nameNorm: norm })
    .onConflictDoNothing({ target: author.nameNorm })
    .returning({ id: author.id })
  if (created) return created.id
  // гонка: параллельная вставка успела первой
  const [raced] = await db
    .select({ id: author.id })
    .from(author)
    .where(eq(author.nameNorm, norm))
  if (!raced) throw new AppError('Не удалось сохранить автора')
  return raced.id
}

/** Синхронизация связок книга↔авторы из денормализованной строки. */
export async function syncBookAuthors(
  bookId: string,
  authorsString: string,
  fantlabAuthors?: Array<{ name: string; id: number }>,
): Promise<void> {
  await db.delete(bookAuthor).where(eq(bookAuthor.bookId, bookId))
  const names = parseAuthors(authorsString)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    if (!name) continue
    const authorId = await ensureAuthor(name)
    await db
      .insert(bookAuthor)
      .values({ bookId, authorId, position: i })
      .onConflictDoNothing()
    // необязательная зацепка на FantLab — для фонового наполнения (M15)
    const flId = fantlabAuthors?.find(
      (a) => normalizeForSearch(a.name) === normalizeForSearch(name),
    )?.id
    if (flId) {
      await db
        .update(author)
        .set({ fantlabId: flId })
        .where(and(eq(author.id, authorId), isNull(author.fantlabId)))
    }
  }
}

/** Бэкфилл на старте: книги без связок получают авторов из строки. */
export async function backfillAuthors(): Promise<void> {
  const rows = await db
    .select({ id: book.id, authors: book.authors })
    .from(book)
    .where(
      sql`${book.authors} != '' and not exists (select 1 from ${bookAuthor} where ${bookAuthor.bookId} = ${book.id})`,
    )
  for (const row of rows) {
    try {
      await syncBookAuthors(row.id, row.authors)
    } catch {
      // бэкфилл — best-effort, не мешаем старту
    }
  }
}

export interface AuthorPage {
  id: string
  name: string
  bio: string | null
  birthYear: number | null
  deathYear: number | null
  country: string | null
  photoPath: string | null
  myBooks: Array<{
    id: string
    title: string
    pages: number | null
    coverPath: string | null
    coverColor: string | null
    libraryName: string | null
    shelfName: string | null
    status: string
  }>
  series: Array<{ id: string; name: string; bookCount: number }>
  bibliography: Array<BibliographyRow>
  refUpdatedAt: Date | null
}

/** Страница автора: его книги на моих полках и серии. */
export async function getAuthorPage(
  userId: string,
  authorId: string,
): Promise<AuthorPage> {
  const [row] = await db.select().from(author).where(eq(author.id, authorId))
  if (!row) throw new AppError('Автор не найден', 'not_found')

  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    and(eq(book.addedBy, userId), eq(book.status, 'wishlist')),
  )
  const { library, shelf } = await import('@/db/schema/catalog')
  const myBooks = await db
    .select({
      id: book.id,
      title: book.title,
      pages: book.pages,
      coverPath: book.coverPath,
      coverColor: book.coverColor,
      libraryName: library.name,
      shelfName: shelf.name,
      status: book.status,
      seriesId: book.seriesId,
      seriesName: series.name,
    })
    .from(bookAuthor)
    .innerJoin(book, eq(book.id, bookAuthor.bookId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .leftJoin(series, eq(series.id, book.seriesId))
    .where(and(eq(bookAuthor.authorId, authorId), accessible))
    .orderBy(asc(book.titleNorm))

  const seriesMap = new Map<
    string,
    { id: string; name: string; bookCount: number }
  >()
  for (const b of myBooks) {
    if (b.seriesId && b.seriesName) {
      const cur = seriesMap.get(b.seriesId)
      if (cur) cur.bookCount += 1
      else
        seriesMap.set(b.seriesId, {
          id: b.seriesId,
          name: b.seriesName,
          bookCount: 1,
        })
    }
  }

  const [bibliography, refUpdatedAt] = await Promise.all([
    authorBibliography(userId, authorId),
    authorRefUpdatedAt(authorId),
  ])

  return {
    id: row.id,
    name: row.name,
    bio: row.bio,
    birthYear: row.birthYear,
    deathYear: row.deathYear,
    country: row.country,
    photoPath: row.photoPath,
    myBooks: myBooks.map(({ seriesId: _s, seriesName: _n, ...b }) => b),
    series: [...seriesMap.values()],
    bibliography,
    refUpdatedAt,
  }
}

export interface AuthorFacetRow {
  id: string
  name: string
  count: number
}

/** Авторы моих книг со счётчиками — фасет фильтра каталога (по таблице). */
export async function listAuthorFacet(
  userId: string,
): Promise<Array<AuthorFacetRow>> {
  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    and(eq(book.addedBy, userId), eq(book.status, 'wishlist')),
  )
  const rows = await db
    .select({ id: author.id, name: author.name, count: count(book.id) })
    .from(author)
    .innerJoin(bookAuthor, eq(bookAuthor.authorId, author.id))
    .innerJoin(book, eq(book.id, bookAuthor.bookId))
    .where(accessible)
    .groupBy(author.id)
    .orderBy(desc(count(book.id)), asc(author.name))
  return rows
}

/** Авторы книги по порядку — ссылки на карточке. */
export async function bookAuthorLinks(
  bookId: string,
): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: author.id, name: author.name })
    .from(bookAuthor)
    .innerJoin(author, eq(author.id, bookAuthor.authorId))
    .where(eq(bookAuthor.bookId, bookId))
    .orderBy(asc(bookAuthor.position))
}
