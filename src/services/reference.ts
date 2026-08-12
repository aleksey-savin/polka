import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import {
  book,
  refBook,
  refBookAuthor,
  refBookWork,
  refWork,
  refWorkAuthor,
} from '@/db/schema/catalog'
import { ensureAuthor, parseAuthors } from './authors'
import { memberLibraryIds } from './members'
import { normalizeForSearch } from './search'
import type {
  MetadataDraft,
  MetadataSource,
  SourceResult,
} from './metadata/types'

/**
 * Эталонный каталог: неизменяемые справочные записи со своими ID;
 * source/sourceRef — только метки происхождения для дедупа.
 */

const SOURCE_PRIORITY: Array<MetadataSource> = [
  'fantlab',
  'google',
  'openlibrary',
]

/** Издания эталона по ISBN → SourceResult'ы для обычного merge. */
export async function refLookup(
  isbn13: string,
): Promise<Array<SourceResult> | null> {
  const rows = await db.select().from(refBook).where(eq(refBook.isbn13, isbn13))
  if (rows.length === 0) return null
  return rows.map((r) => ({
    source: r.source,
    draft: {
      title: r.title,
      authors: r.authors || undefined,
      publisher: r.publisher ?? undefined,
      year: r.year ?? undefined,
      pages: r.pages ?? undefined,
      annotation: r.annotation ?? undefined,
      seriesName: r.seriesName ?? undefined,
      language: r.language,
      coverUrl: r.coverUrl ?? undefined,
      heightMm: r.heightMm ?? undefined,
      coverType: r.coverType ?? undefined,
      sourceRef: r.sourceRef,
    } satisfies MetadataDraft,
  }))
}

/** Сохранение ответов внешних источников в эталон (после сетевого lookup). */
export async function persistLookup(
  isbn13: string,
  isbn10: string | null,
  results: Array<SourceResult | null>,
): Promise<void> {
  for (const r of results) {
    if (!r?.draft.title) continue
    const sourceRef = r.draft.sourceRef ?? `isbn:${isbn13}`
    const [existing] = await db
      .select({ id: refBook.id })
      .from(refBook)
      .where(
        and(eq(refBook.source, r.source), eq(refBook.sourceRef, sourceRef)),
      )
    let refBookId = existing?.id
    if (!refBookId) {
      const [created] = await db
        .insert(refBook)
        .values({
          source: r.source,
          sourceRef,
          isbn13,
          isbn10,
          title: r.draft.title,
          titleNorm: normalizeForSearch(r.draft.title),
          authors: r.draft.authors ?? '',
          publisher: r.draft.publisher ?? null,
          year: r.draft.year ?? null,
          pages: r.draft.pages ?? null,
          heightMm: r.draft.heightMm ?? null,
          coverType: r.draft.coverType ?? null,
          language: r.draft.language ?? 'ru',
          annotation: r.draft.annotation ?? null,
          seriesName: r.draft.seriesName ?? null,
          coverUrl: r.draft.coverUrl ?? null,
          rawJson: JSON.stringify(r.draft),
        })
        .onConflictDoNothing()
        .returning({ id: refBook.id })
      refBookId = created?.id
    }
    if (!refBookId) continue

    // авторы издания
    const names = parseAuthors(r.draft.authors ?? '')
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      if (!name) continue
      const authorId = await ensureAuthor(name)
      await db
        .insert(refBookAuthor)
        .values({ refBookId, authorId, position: i })
        .onConflictDoNothing()
    }

    // произведения (FantLab): свои записи + связи со сборником и авторами
    if (r.source === 'fantlab' && r.draft.fantlabWorks) {
      for (const w of r.draft.fantlabWorks) {
        const workId = await ensureRefWork('fantlab', String(w.id), w.title)
        await db
          .insert(refBookWork)
          .values({ refBookId, workId })
          .onConflictDoNothing()
        if (w.author) {
          const authorId = await ensureAuthor(w.author)
          await db
            .insert(refWorkAuthor)
            .values({ workId, authorId, position: 0 })
            .onConflictDoNothing()
        }
      }
    }
  }
}

async function ensureRefWork(
  source: 'fantlab' | 'openlibrary',
  sourceId: string,
  title: string,
  year?: number | null,
): Promise<string> {
  const [existing] = await db
    .select({ id: refWork.id })
    .from(refWork)
    .where(and(eq(refWork.source, source), eq(refWork.sourceId, sourceId)))
  if (existing) return existing.id
  const [created] = await db
    .insert(refWork)
    .values({
      source,
      sourceId,
      title,
      titleNorm: normalizeForSearch(title),
      year: year ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: refWork.id })
  if (created) return created.id
  const [raced] = await db
    .select({ id: refWork.id })
    .from(refWork)
    .where(and(eq(refWork.source, source), eq(refWork.sourceId, sourceId)))
  if (!raced) throw new Error('ref_work upsert failed')
  return raced.id
}

/** Эталонное издание для связи book.refBookId (приоритет FantLab). */
export async function bestRefBookIdForIsbn(
  isbn13: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: refBook.id, source: refBook.source })
    .from(refBook)
    .where(eq(refBook.isbn13, isbn13))
  for (const source of SOURCE_PRIORITY) {
    const hit = rows.find((r) => r.source === source)
    if (hit) return hit.id
  }
  return null
}

export interface BibliographyRow {
  id: string
  title: string
  year: number | null
  have: boolean
}

/** Библиография автора из эталона: произведения + покрытие моими книгами. */
export async function authorBibliography(
  userId: string,
  authorId: string,
): Promise<Array<BibliographyRow>> {
  const works = await db
    .select({
      id: refWork.id,
      title: refWork.title,
      year: refWork.year,
      titleNorm: refWork.titleNorm,
    })
    .from(refWork)
    .innerJoin(refWorkAuthor, eq(refWorkAuthor.workId, refWork.id))
    .where(eq(refWorkAuthor.authorId, authorId))
    .orderBy(asc(refWork.year), asc(refWork.titleNorm))
  if (works.length === 0) return []

  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    eq(book.addedBy, userId),
  )

  // покрытие через связку экземпляр → издание → произведения
  const covered = await db
    .select({ workId: refBookWork.workId })
    .from(book)
    .innerJoin(refBookWork, eq(refBookWork.refBookId, book.refBookId))
    .where(and(accessible, sql`${book.refBookId} is not null`))
  const coveredIds = new Set(covered.map((c) => c.workId))

  // fallback для книг без связи с эталоном — совпадение названий
  const myTitles = await db
    .select({ titleNorm: book.titleNorm })
    .from(book)
    .where(accessible)
  const myTitleSet = new Set(myTitles.map((t) => t.titleNorm))

  return works.map((w) => ({
    id: w.id,
    title: w.title,
    year: w.year,
    have: coveredIds.has(w.id) || myTitleSet.has(w.titleNorm),
  }))
}

/** Дата последнего наполнения эталона по автору (для подписи в UI). */
export async function authorRefUpdatedAt(
  authorId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ fetchedAt: refWork.fetchedAt })
    .from(refWork)
    .innerJoin(refWorkAuthor, eq(refWorkAuthor.workId, refWork.id))
    .where(eq(refWorkAuthor.authorId, authorId))
    .orderBy(desc(refWork.fetchedAt))
    .limit(1)
  return row?.fetchedAt ?? null
}
