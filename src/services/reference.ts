import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm'

import { db } from '@/db'
import {
  author as authorTable,
  book,
  refBook,
  refBookAuthor,
  refBookWork,
  refWork,
  refWorkAuthor,
} from '@/db/schema/catalog'
import { ensureAuthor, parseAuthors } from './authors'
import { editionsInLists, listsForOne, listsForTargets } from './lists'
import { memberLibraryIds } from './members'
import { normalizeForSearch } from './search'
import type {
  MetadataDraft,
  MetadataSource,
  SourceResult,
} from './metadata/types'
import type { ListBadge } from './lists'

/**
 * Эталонный каталог: неизменяемые справочные записи со своими ID;
 * source/sourceRef — только метки происхождения для дедупа.
 */

const SOURCE_PRIORITY: Array<MetadataSource> = [
  'manual',
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

export async function ensureRefWork(
  source: 'fantlab' | 'openlibrary' | 'manual',
  sourceId: string,
  title: string,
  year?: number | null,
  workType?: string | null,
): Promise<string> {
  const [existing] = await db
    .select({ id: refWork.id })
    .from(refWork)
    .where(and(eq(refWork.source, source), eq(refWork.sourceId, sourceId)))
  if (existing) {
    if (year || workType) {
      await db
        .update(refWork)
        .set({
          ...(year ? { year } : {}),
          ...(workType ? { workType } : {}),
        })
        .where(and(eq(refWork.id, existing.id), sql`${refWork.year} is null`))
    }
    return existing.id
  }
  const [created] = await db
    .insert(refWork)
    .values({
      source,
      sourceId,
      title,
      titleNorm: normalizeForSearch(title),
      year: year ?? null,
      workType: workType ?? null,
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
  workType: string | null
  have: boolean
  /** Уже в каком-нибудь моём списке — «+» показывается отмеченным. */
  listed: boolean
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
      workType: refWork.workType,
      titleNorm: refWork.titleNorm,
    })
    .from(refWork)
    .innerJoin(refWorkAuthor, eq(refWorkAuthor.workId, refWork.id))
    .where(
      and(
        eq(refWorkAuthor.authorId, authorId),
        // циклы — не строки библиографии, у них своя шторка
        sql`(${refWork.workType} is null or ${refWork.workType} != 'cycle')`,
      ),
    )
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

  // fallback для книг без связи с эталоном — совпадение названий;
  // wishlist-записи считаем отдельно: это «в хочу», а не «есть»
  const myTitles = await db
    .select({
      titleNorm: book.titleNorm,
      status: book.status,
      refWorkId: book.refWorkId,
    })
    .from(book)
    .where(accessible)
  const haveTitles = new Set(
    myTitles.filter((b) => b.status !== 'wishlist').map((b) => b.titleNorm),
  )
  const wishTitles = new Set(
    myTitles.filter((b) => b.status === 'wishlist').map((b) => b.titleNorm),
  )
  const wishWorkIds = new Set(
    myTitles
      .filter((b) => b.status === 'wishlist' && b.refWorkId)
      .map((b) => b.refWorkId),
  )

  const listed = await listsForTargets(
    userId,
    works.map((w) => ({ refWorkId: w.id })),
  )

  return works.map((w) => {
    const have = coveredIds.has(w.id) || haveTitles.has(w.titleNorm)
    return {
      id: w.id,
      title: w.title,
      year: w.year,
      workType: w.workType,
      have,
      listed:
        (listed.get(`work:${w.id}`)?.length ?? 0) > 0 ||
        wishWorkIds.has(w.id) ||
        wishTitles.has(w.titleNorm),
    }
  })
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

/** Связь произведения с автором (идемпотентно). */
export async function linkWorkAuthor(
  workId: string,
  authorId: string,
): Promise<void> {
  await db
    .insert(refWorkAuthor)
    .values({ workId, authorId, position: 0 })
    .onConflictDoNothing()
}

export interface WorkView {
  id: string
  /** Списки, где произведение состоит. */
  lists: Array<ListBadge>
  title: string
  year: number | null
  workType: string | null
  annotation: string | null
  authorName: string
  editionsFetched: boolean
  editions: Array<{
    refBookId: string
    title: string
    publisher: string | null
    year: number | null
    pages: number | null
    isbn13: string | null
    coverPath: string | null
    coverColor: string | null
    have: boolean
    /** Это издание лежит в списке само по себе. */
    inLists: Array<ListBadge>
  }>
}

/** Шторка произведения: аннотация + издания с пометкой «есть». */
export async function getWorkView(
  userId: string,
  workId: string,
): Promise<WorkView> {
  const [work] = await db.select().from(refWork).where(eq(refWork.id, workId))
  if (!work) throw new Error('Произведение не найдено')
  const [authorRow] = await db
    .select({ name: authorTable.name })
    .from(refWorkAuthor)
    .innerJoin(authorTable, eq(authorTable.id, refWorkAuthor.authorId))
    .where(eq(refWorkAuthor.workId, workId))
    .limit(1)

  const editions = await db
    .select({
      refBookId: refBook.id,
      title: refBook.title,
      publisher: refBook.publisher,
      year: refBook.year,
      pages: refBook.pages,
      isbn13: refBook.isbn13,
      coverPath: refBook.coverPath,
      coverColor: refBook.coverColor,
    })
    .from(refBookWork)
    .innerJoin(refBook, eq(refBook.id, refBookWork.refBookId))
    .where(eq(refBookWork.workId, workId))
    .orderBy(desc(refBook.year))

  const libIds = await memberLibraryIds(userId)
  const accessible = or(
    libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
    eq(book.addedBy, userId),
  )
  const isbns = editions
    .map((e) => e.isbn13)
    .filter((x): x is string => Boolean(x))
  const mine =
    isbns.length > 0
      ? await db
          .select({ isbn13: book.isbn13 })
          .from(book)
          .where(and(accessible, inArray(book.isbn13, isbns)))
      : []
  const mineIsbns = new Set(mine.map((m) => m.isbn13))

  return {
    id: work.id,
    lists: await listsForOne(userId, { refWorkId: workId }),
    title: work.title,
    year: work.year,
    workType: work.workType,
    annotation: work.annotation,
    authorName: authorRow?.name ?? '',
    editionsFetched: work.editionsFetchedAt !== null,
    editions: await (async () => {
      const inLists = await editionsInLists(
        userId,
        editions.map((e) => e.refBookId),
      )
      return editions.map((e) => ({
        ...e,
        have: Boolean(e.isbn13 && mineIsbns.has(e.isbn13)),
        inLists: inLists.get(e.refBookId) ?? [],
      }))
    })(),
  }
}

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Сколько обложек тянем при первом открытии произведения. */
const COVER_BUDGET = 12

/**
 * Ленивая загрузка изданий произведения (FantLab): один запрос extended,
 * русскоязычные бумажные издания + обложки сразу в эталон.
 */
export async function fetchWorkEditions(
  userId: string,
  workId: string,
): Promise<WorkView> {
  const [work] = await db.select().from(refWork).where(eq(refWork.id, workId))
  if (!work) throw new Error('Произведение не найдено')
  if (work.editionsFetchedAt !== null || work.source !== 'fantlab') {
    if (work.source !== 'fantlab' && work.editionsFetchedAt === null) {
      // для OpenLibrary-произведений изданий пока не тянем — честно помечаем
      await db
        .update(refWork)
        .set({ editionsFetchedAt: new Date() })
        .where(eq(refWork.id, workId))
    }
    return getWorkView(userId, workId)
  }

  const { POLKA_USER_AGENT } = await import('./userAgent')
  const res = await fetch(
    `https://api.fantlab.ru/work/${work.sourceId}/extended`,
    {
      headers: { 'User-Agent': POLKA_USER_AGENT },
      signal: AbortSignal.timeout(12_000),
    },
  ).catch(() => null)
  const data = res?.ok
    ? ((await res.json().catch(() => null)) as {
        work_description?: string
        editions_blocks?: Record<
          string,
          {
            list?: Array<{
              edition_id?: number
              name?: string
              publisher?: string
              year?: number
              pages?: number
              isbn?: string
              lang_code?: string
              pic_num?: number
              series?: string
            }>
          }
        >
      } | null)
    : null

  if (data) {
    const { stripHtml } = await import('./metadata/types')
    const { stripBb } = await import('./metadata/fantlab')
    const { parseIsbn } = await import('./isbn')
    if (
      !work.annotation &&
      typeof data.work_description === 'string' &&
      data.work_description.trim()
    ) {
      await db
        .update(refWork)
        .set({ annotation: stripHtml(data.work_description) })
        .where(eq(refWork.id, workId))
    }
    // у классики изданий сотни («Братья Карамазовы» — 230 русских):
    // записи заводим все, а обложки тянем порциями, иначе первое открытие
    // произведения встаёт на минуты и забивает диск
    let coverBudget = COVER_BUDGET
    for (const block of Object.values(data.editions_blocks ?? {})) {
      for (const e of block.list ?? []) {
        if (!e.edition_id || !e.name) continue
        if (e.lang_code && e.lang_code !== 'ru') continue
        const sourceRef = String(e.edition_id)
        const [existing] = await db
          .select({ id: refBook.id, coverPath: refBook.coverPath })
          .from(refBook)
          .where(
            and(
              eq(refBook.source, 'fantlab'),
              eq(refBook.sourceRef, sourceRef),
            ),
          )
        let refBookId = existing?.id
        if (!refBookId) {
          const parsedIsbn = e.isbn ? parseIsbn(e.isbn) : null
          const [created] = await db
            .insert(refBook)
            .values({
              source: 'fantlab',
              sourceRef,
              isbn13: parsedIsbn?.isbn13 ?? null,
              isbn10: parsedIsbn?.isbn10 ?? null,
              title: e.name,
              titleNorm: normalizeForSearch(e.name),
              authors: '',
              publisher: e.publisher ? stripBb(e.publisher) : null,
              year: e.year ?? null,
              pages: e.pages ?? null,
              seriesName: e.series ? stripBb(e.series) : null,
              coverUrl:
                (e.pic_num ?? 0) > 0
                  ? `https://fantlab.ru/images/editions/big/${e.edition_id}`
                  : null,
              rawJson: JSON.stringify(e),
            })
            .onConflictDoNothing()
            .returning({ id: refBook.id })
          refBookId = created?.id
        }
        if (!refBookId) continue
        await db
          .insert(refBookWork)
          .values({ refBookId, workId })
          .onConflictDoNothing()
        // обложка — сразу в эталон (щадяще, с паузой); остальные подтянутся
        // по требованию, когда откроют карточку издания
        if (!existing?.coverPath && (e.pic_num ?? 0) > 0 && coverBudget > 0) {
          coverBudget--
          const { saveRefCoverFromUrl } = await import('./covers')
          const saved = await saveRefCoverFromUrl(
            refBookId,
            `https://fantlab.ru/images/editions/big/${e.edition_id}`,
          )
          if (saved) {
            await db
              .update(refBook)
              .set({ coverPath: saved.path, coverColor: saved.color })
              .where(eq(refBook.id, refBookId))
          }
          await sleepMs(400)
        }
      }
    }
  }

  await db
    .update(refWork)
    .set({ editionsFetchedAt: new Date() })
    .where(eq(refWork.id, workId))
  return getWorkView(userId, workId)
}

export interface RefBookView {
  id: string
  lists: Array<ListBadge>
  title: string
  authors: string
  publisher: string | null
  year: number | null
  pages: number | null
  isbn13: string | null
  seriesName: string | null
  annotation: string | null
  coverPath: string | null
  coverColor: string | null
  coverType: 'soft' | 'hard' | null
  /** Произведения в издании — состав сборника. */
  works: Array<{ id: string; title: string }>
  /** Моя книга с этим ISBN — если издание уже на полке. */
  myBookId: string | null
}

/** Детали издания эталона для шторки. */
export async function getRefBookView(
  userId: string,
  refBookId: string,
): Promise<RefBookView> {
  const [found] = await db
    .select()
    .from(refBook)
    .where(eq(refBook.id, refBookId))
  if (!found) throw new Error('Издание не найдено')
  let row = found
  // обложку могли не успеть скачать при импорте пачки — берём сейчас
  if (!row.coverPath && row.coverUrl) {
    const { saveRefCoverFromUrl } = await import('./covers')
    const saved = await saveRefCoverFromUrl(row.id, row.coverUrl)
    if (saved) {
      await db
        .update(refBook)
        .set({ coverPath: saved.path, coverColor: saved.color })
        .where(eq(refBook.id, row.id))
      row = { ...row, coverPath: saved.path, coverColor: saved.color }
    }
  }

  const works = await db
    .select({ id: refWork.id, title: refWork.title })
    .from(refBookWork)
    .innerJoin(refWork, eq(refWork.id, refBookWork.workId))
    .where(eq(refBookWork.refBookId, refBookId))

  let myBookId: string | null = null
  if (row.isbn13) {
    const libIds = await memberLibraryIds(userId)
    const accessible = or(
      libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
      eq(book.addedBy, userId),
    )
    const [mine] = await db
      .select({ id: book.id })
      .from(book)
      .where(and(accessible, eq(book.isbn13, row.isbn13)))
      .limit(1)
    myBookId = mine?.id ?? null
  }

  return {
    id: row.id,
    lists: await listsForOne(userId, { refBookId: refBookId }),
    title: row.title,
    authors: row.authors,
    publisher: row.publisher,
    year: row.year,
    pages: row.pages,
    isbn13: row.isbn13,
    seriesName: row.seriesName,
    annotation: row.annotation,
    coverPath: row.coverPath,
    coverColor: row.coverColor,
    coverType: row.coverType,
    works,
    myBookId,
  }
}
