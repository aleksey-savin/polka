import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { book } from '@/db/schema/catalog'
import { log } from '@/lib/logger'
import { syncBookAuthors } from './authors'
import { normalizeForSearch } from './search'
import { resolveSeriesByName } from './series'
import type { MetadataDraft } from './metadata/types'

/**
 * Единственное место, которое переносит найденное в карточку книги (M32).
 *
 * Раньше это делали три разных куска кода с разными наборами полей:
 * `retryLookup` писал язык, переплёт и высоту, `applyRecognition` — нет,
 * `applyProposal` — третий набор. Одна и та же книга получала разную карточку
 * в зависимости от того, с какого экрана её нашли.
 */
export interface WriteOptions {
  /** `replace` — переписать всё найденное, `fill` — только пустые поля. */
  mode?: 'replace' | 'fill'
  /** Владелец: нужен, чтобы завести серию в его личном словаре. */
  userId?: string
}

/** Поля черновика, которые ложатся в карточку один в один. */
const DIRECT = [
  'publisher',
  'year',
  'pages',
  'annotation',
  'language',
  'coverType',
  'heightMm',
] as const

export async function applyDraftToBook(
  bookId: string,
  draft: MetadataDraft,
  options: WriteOptions = {},
): Promise<void> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) return
  const fill = options.mode === 'fill'

  // у болванки из сканера названием служит сам номер (инвариант M18):
  // формально поле не пустое, но заполнять его — прямая задача доигровки
  const titleIsPlaceholder = row.unrecognized && row.title === row.isbn13

  const patch: Record<string, unknown> = {}
  const put = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return
    const current = (row as unknown as Record<string, unknown>)[field]
    const empty =
      current === null ||
      current === undefined ||
      current === '' ||
      (field === 'title' && titleIsPlaceholder)
    if (fill && !empty) return
    if (current === value) return
    patch[field] = value
  }

  if (draft.title) {
    put('title', draft.title.trim())
    if (patch.title) patch.titleNorm = normalizeForSearch(draft.title)
  }
  if (draft.authors !== undefined) {
    put('authors', draft.authors.trim())
    if (patch.authors !== undefined) {
      patch.authorsNorm = normalizeForSearch(draft.authors)
    }
  }
  for (const field of DIRECT) put(field, draft[field])

  if (draft.seriesName && options.userId) {
    const seriesId = await resolveSeriesByName(options.userId, draft.seriesName)
    put('seriesId', seriesId)
  }

  // название появилось — книга перестала быть болванкой из сканера
  const titleNow = (patch.title as string | undefined) ?? row.title
  if (row.unrecognized && titleNow && titleNow !== row.isbn13) {
    patch.unrecognized = false
  }

  if (Object.keys(patch).length === 0) return
  patch.updatedAt = new Date()
  await db.update(book).set(patch).where(eq(book.id, bookId))

  if (typeof patch.authors === 'string') {
    await syncBookAuthors(bookId, patch.authors, draft.fantlabAuthors)
  }
  log.info('find', 'карточка дозаполнена', {
    bookId,
    mode: options.mode ?? 'replace',
    fields: Object.keys(patch).join(','),
  })
}
