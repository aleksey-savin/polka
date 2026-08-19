import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'

import { db } from '@/db'
import { book, refBook } from '@/db/schema/catalog'
import { log } from '@/lib/logger'
import { AppError } from '@/services/errors'
import { memberLibraryIds } from '@/services/members'
import { SYNCED_FIELDS } from './checksum'
import type { SyncedField } from './checksum'

/**
 * Сравнение карточки с эталоном и обновление (M34).
 *
 * Признак «эталон дополнили» — расхождение контрольных сумм: у книги хранится
 * версия, которую в неё применили. Это одно сравнение вместо разбора десятка
 * полей на каждой карточке, поэтому сводка в «Чтении» считается одним
 * запросом.
 */
export interface RefField {
  field: SyncedField
  label: string
  was: string | null
  now: string
}

export interface RefUpdate {
  bookId: string
  refBookId: string
  fields: Array<RefField>
}

export interface StaleBook {
  bookId: string
  title: string
  coverPath: string | null
  /** Что добавится — короткий перечень для сводки. */
  fields: Array<string>
}

const LABEL: Record<SyncedField, string> = {
  title: 'название',
  authors: 'авторы',
  publisher: 'издательство',
  year: 'год',
  pages: 'страниц',
  language: 'язык',
  seriesName: 'серия',
  annotation: 'аннотация',
  coverUrl: 'обложка',
}

const text = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim()

/** Что в карточке соответствует полю эталона. */
function ownValue(row: typeof book.$inferSelect, field: SyncedField): string {
  // серия у книги — ссылка на личный словарь, сверять её строкой нечестно
  if (field === 'seriesName') return ''
  if (field === 'coverUrl') return row.coverPath ? 'своя' : ''
  return text((row as unknown as Record<string, unknown>)[field])
}

async function assertBookAccess(
  userId: string,
  row: typeof book.$inferSelect,
): Promise<void> {
  if (row.addedBy === userId) return
  const libIds = await memberLibraryIds(userId)
  if (row.libraryId && libIds.includes(row.libraryId)) return
  throw new AppError('Нет доступа к этой книге', 'forbidden')
}

export async function refUpdateFor(
  userId: string,
  bookId: string,
  options: { force?: boolean } = {},
): Promise<RefUpdate | null> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)

  if (!row.refBookId) return null
  // сказал «больше не напоминать» — молчим, пока сам не придёт обновляться
  if (row.refSyncMuted && !options.force) return null

  const [ref] = await db
    .select()
    .from(refBook)
    .where(eq(refBook.id, row.refBookId))
  if (!ref?.checksum) return null
  if (ref.checksum === row.refChecksum && !options.force) return null

  const fields: Array<RefField> = []
  for (const field of SYNCED_FIELDS) {
    const now = text(ref[field])
    if (!now) continue
    const was = ownValue(row, field)
    if (was === now) continue
    // своя обложка остаётся своей: её ставили руками
    if (field === 'coverUrl' && row.coverPath) continue
    fields.push({ field, label: LABEL[field], was: was || null, now })
  }
  if (fields.length === 0) return null
  return { bookId, refBookId: ref.id, fields }
}

/** Сводка для «Чтения»: книги, у которых эталон ушёл вперёд. */
export async function staleBooks(userId: string): Promise<Array<StaleBook>> {
  const libIds = await memberLibraryIds(userId)
  const rows = await db
    .select({ id: book.id })
    .from(book)
    .innerJoin(refBook, eq(refBook.id, book.refBookId))
    .where(
      and(
        or(
          libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
          eq(book.addedBy, userId),
        ),
        isNotNull(refBook.checksum),
        eq(book.refSyncMuted, false),
        or(isNull(book.refChecksum), ne(book.refChecksum, refBook.checksum)),
      ),
    )
    .limit(50)

  const out: Array<StaleBook> = []
  for (const { id } of rows) {
    const update = await refUpdateFor(userId, id)
    if (!update) continue
    const [row] = await db.select().from(book).where(eq(book.id, id))
    if (!row) continue
    out.push({
      bookId: id,
      title: row.title,
      coverPath: row.coverPath,
      fields: update.fields.map((f) => f.label),
    })
  }
  return out
}

/**
 * Обновление карточки из эталона (M34).
 *
 * Данные издания заменяются целиком — без выбора по полям: эталон проверен
 * человеком, и держать в карточке половину старого незачем. Личный слой
 * (оценка, рецензия, заметки, полка, списки) не трогается.
 *
 * Снимок «до» кладётся туда же, где его держит разбор с ИИ, поэтому работает
 * привычный «Откатить».
 */
export async function applyRefUpdate(
  userId: string,
  bookId: string,
  options: { force?: boolean } = {},
): Promise<{ fields: number }> {
  const update = await refUpdateFor(userId, bookId, options)
  if (!update) return { fields: 0 }

  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  const [ref] = await db
    .select()
    .from(refBook)
    .where(eq(refBook.id, update.refBookId))
  if (!row || !ref) return { fields: 0 }

  const before = {
    title: row.title,
    authors: row.authors,
    publisher: row.publisher,
    year: row.year,
    pages: row.pages,
    annotation: row.annotation,
    seriesId: row.seriesId,
    unrecognized: row.unrecognized,
  }

  const { applyDraftToBook } = await import('@/services/bookWriter')
  await applyDraftToBook(
    bookId,
    {
      title: ref.title,
      authors: ref.authors,
      publisher: ref.publisher ?? undefined,
      year: ref.year ?? undefined,
      pages: ref.pages ?? undefined,
      language: ref.language,
      annotation: ref.annotation ?? undefined,
      seriesName: ref.seriesName ?? undefined,
    },
    { userId },
  )

  // обложку берём, только если своей нет: свою ставили руками
  if (!row.coverPath && ref.coverUrl) {
    try {
      const { saveCoverFromUrl } = await import('@/services/covers')
      const saved = await saveCoverFromUrl(bookId, ref.coverUrl)
      await db
        .update(book)
        .set({ coverPath: saved.path, coverColor: saved.color })
        .where(eq(book.id, bookId))
    } catch (error) {
      log.warn('reference', 'обложка из эталона не сохранилась', {
        bookId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await db
    .update(book)
    // пришёл обновляться сам — значит вопрос снова открыт
    .set({ refChecksum: ref.checksum, refSyncMuted: false })
    .where(eq(book.id, bookId))

  const { aiSuggestion } = await import('@/db/schema/moderation')
  await db.insert(aiSuggestion).values({
    bookId,
    isbn13: row.isbn13 ?? '',
    verdict: 'confirmed',
    status: 'applied',
    via: 'reference',
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(update.fields),
    appliedBy: userId,
  })
  log.info('reference', 'карточка обновлена из эталона', {
    bookId,
    fields: update.fields.map((f) => f.field).join(','),
  })
  return { fields: update.fields.length }
}

/**
 * «Больше не напоминать» (M34).
 *
 * Владельца устраивает своя карточка. Плашка и сводка про эту книгу молчат —
 * навсегда, а не до следующей правки эталона: напоминать об одном и том же
 * после отказа значит спорить с человеком. Путь остаётся: «Заменить данные»
 * на карточке работает как работало.
 */
export async function muteRefUpdate(
  userId: string,
  bookId: string,
): Promise<void> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  await assertBookAccess(userId, row)
  await db.update(book).set({ refSyncMuted: true }).where(eq(book.id, bookId))
  log.info('reference', 'напоминания об эталоне отключены', { bookId })
}
