import { and, eq, inArray, like, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import {
  author as authorTable,
  book,
  library,
  refWork,
  refWorkAuthor,
  shelf,
} from '@/db/schema/catalog'
import { memberLibraryIds } from './members'
import { normalizeForSearch } from './search'
import { sanitizeLike } from './series'
import { ensureRefWork, linkWorkAuthor } from './reference'
import { ensureAuthor } from './authors'
import { log } from '@/lib/logger'
import { POLKA_USER_AGENT } from './userAgent'

/**
 * Поиск книги по названию (M20) — для изданий без ISBN: у советских и ранних
 * постсоветских книг номера нет вовсе, сканер им не поможет.
 *
 * Слои по возрастанию цены: свои книги → эталон Полки (без сети) → FantLab.
 */

export interface TitleHitMine {
  bookId: string
  title: string
  authors: string
  year: number | null
  place: string | null
}

export interface TitleHitWork {
  /** Уже в эталоне — id произведения; у внешних появится после выбора. */
  workId: string | null
  source: 'reference' | 'fantlab'
  sourceId: string | null
  title: string
  authors: string
  year: number | null
  workType: string | null
}

export interface TitleSearchResult {
  mine: Array<TitleHitMine>
  reference: Array<TitleHitWork>
  external: Array<TitleHitWork>
}

const LIMIT = 10

/** Слова запроса: «карамазовы достоевский» — это название плюс автор,
    целиком такая строка не встречается нигде. */
const words = (query: string): Array<string> =>
  normalizeForSearch(query)
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 5)

/** Свои книги — чтобы сразу увидеть дубль и не заводить вторую. */
async function searchMine(
  userId: string,
  query: string,
): Promise<Array<TitleHitMine>> {
  const parts = words(query)
  if (parts.length === 0) return []
  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    eq(book.addedBy, userId),
  )
  const rows = await db
    .select({
      bookId: book.id,
      title: book.title,
      authors: book.authors,
      year: book.year,
      shelfName: shelf.name,
      libraryName: library.name,
      status: book.status,
    })
    .from(book)
    .leftJoin(shelf, eq(shelf.id, book.shelfId))
    .leftJoin(library, eq(library.id, book.libraryId))
    .where(
      and(
        accessible,
        // каждое слово должно найтись в названии или у автора
        ...parts.map((w) =>
          or(like(book.titleNorm, `%${sanitizeLike(w)}%`), like(book.authorsNorm, `%${sanitizeLike(w)}%`)),
        ),
      ),
    )
    .limit(LIMIT)
  return rows.map((r) => ({
    bookId: r.bookId,
    title: r.title,
    authors: r.authors,
    year: r.year,
    place:
      r.status === 'in_library'
        ? (r.shelfName ?? r.libraryName ?? 'в библиотеке')
        : r.status === 'wishlist'
          ? 'в «Хочу»'
          : null,
  }))
}

/** Эталон Полки — мгновенно и без запросов в сеть. */
async function searchReference(query: string): Promise<Array<TitleHitWork>> {
  const parts = words(query)
  if (parts.length === 0) return []
  const rows = await db
    .select({
      workId: refWork.id,
      title: refWork.title,
      year: refWork.year,
      workType: refWork.workType,
      authorName: authorTable.name,
    })
    .from(refWork)
    .leftJoin(refWorkAuthor, eq(refWorkAuthor.workId, refWork.id))
    .leftJoin(authorTable, eq(authorTable.id, refWorkAuthor.authorId))
    .where(
      and(
        // слово ищем и в названии произведения, и в имени автора
        ...parts.map(
          (w) =>
            sql`(${refWork.titleNorm} like ${`%${sanitizeLike(w)}%`} or ${authorTable.nameNorm} like ${`%${sanitizeLike(w)}%`})`,
        ),
        sql`(${refWork.workType} is null or ${refWork.workType} != 'cycle')`,
      ),
    )
    .limit(LIMIT)
  return rows.map((r) => ({
    workId: r.workId,
    source: 'reference' as const,
    sourceId: null,
    title: r.title,
    authors: r.authorName ?? '',
    year: r.year,
    workType: r.workType,
  }))
}

interface FantlabMatch {
  work_id?: number
  rusname?: string
  name?: string
  year?: number
  work_type_name?: string
  autor1_rusname?: string
  all_autor_rusname?: string
}

/** FantLab: он хорошо знает русскую классику, в том числе издания 90-х. */
async function searchFantlab(query: string): Promise<Array<TitleHitWork>> {
  const started = performance.now()
  try {
    const url = `https://api.fantlab.ru/search-works?q=${encodeURIComponent(query)}&page=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': POLKA_USER_AGENT },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) {
      log.warn('search', 'fantlab ответил ошибкой', {
        status: res.status,
        query,
      })
      return []
    }
    const data = (await res.json()) as { matches?: Array<FantlabMatch> }
    log.debug('search', 'fantlab ответил', {
      query,
      found: data.matches?.length ?? 0,
      ms: Math.round(performance.now() - started),
    })
    return (data.matches ?? [])
      .filter((m) => m.work_id && (m.rusname ?? m.name))
      .slice(0, LIMIT)
      .map((m) => ({
        workId: null,
        source: 'fantlab' as const,
        sourceId: String(m.work_id),
        title: (m.rusname || m.name) ?? '',
        authors: m.all_autor_rusname || m.autor1_rusname || '',
        year: m.year ?? null,
        workType: m.work_type_name ?? null,
      }))
  } catch (error) {
    log.warn('search', 'fantlab недоступен', {
      query,
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return []
  }
}

export async function searchByTitle(
  userId: string,
  query: string,
): Promise<TitleSearchResult> {
  const trimmed = query.trim()
  if (trimmed.length < 3) return { mine: [], reference: [], external: [] }

  const [mine, reference] = await Promise.all([
    searchMine(userId, trimmed),
    searchReference(trimmed),
  ])
  const external = await searchFantlab(trimmed)

  // то, что уже лежит в эталоне, второй раз из источника не показываем
  const known = new Set(reference.map((r) => normalizeForSearch(r.title)))
  return {
    mine,
    reference,
    external: external.filter((e) => !known.has(normalizeForSearch(e.title))),
  }
}

/** Выбор внешнего результата: заводим произведение в эталоне и связываем с автором. */
export async function adoptExternalWork(
  sourceId: string,
  title: string,
  authors: string,
  year: number | null,
  workType: string | null,
): Promise<string> {
  const workId = await ensureRefWork(
    'fantlab',
    sourceId,
    title,
    year,
    workType,
  )
  const first = authors.split(/[,;]/)[0]?.trim()
  if (first) {
    const authorId = await ensureAuthor(first)
    await linkWorkAuthor(workId, authorId)
  }
  return workId
}
