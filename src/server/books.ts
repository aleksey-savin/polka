import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { listAuthorFacet } from '@/services/authors'
import {
  createBook,
  deleteBook,
  getBookCard,
  giftBook,
  listBooks,
  markLost,
  moveBooks,
  restoreToLibrary,
  updateBook,
  setBookHidden,
} from '@/services/books'
import { listMyLibraries } from '@/services/libraries'
import { activeLoansFor } from '@/services/loans'
import { listMyTags } from '@/services/tags'
import { authMiddleware } from './middleware'

const bookInput = z.object({
  // пустое имя допустимо только для болванок из сканера — проверяет сервис
  title: z.string().trim(),
  authors: z.string().optional(),
  isbn10: z.string().optional(),
  isbn13: z.string().optional(),
  publisher: z.string().optional(),
  year: z.number().int().min(1400).max(2100).nullable().optional(),
  pages: z.number().int().min(1).max(20000).nullable().optional(),
  language: z.string().optional(),
  annotation: z.string().optional(),
  seriesName: z.string().optional(),
  seriesNumber: z.string().optional(),
  tags: z.array(z.string()).optional(),
  libraryId: z.string().nullable().optional(),
  shelfId: z.string().nullable().optional(),
  wishlist: z.boolean().optional(),
  coverUrl: z.url().optional(),
  coverType: z.enum(['soft', 'hard']).nullable().optional(),
  giftEdition: z.boolean().optional(),
  fantlabAuthors: z
    .array(z.object({ name: z.string(), id: z.number().int() }))
    .optional(),
  refWorkId: z.string().nullable().optional(),
  heightMm: z.number().int().min(60).max(500).nullable().optional(),
  /** Куда положить, если книги нет дома (M17). */
  listId: z.string().nullable().optional(),
  /** Болванка из сканера: только ISBN (M18). */
  unrecognized: z.boolean().optional(),
})

export const createBookFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(bookInput)
  .handler(({ context, data }) => createBook(context.user.id, data))

export const updateBookFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(bookInput.extend({ bookId: z.string() }))
  .handler(({ context, data }) => {
    const { bookId, ...input } = data
    return updateBook(context.user.id, bookId, input)
  })

export const deleteBookFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) => deleteBook(context.user.id, data.bookId))

export const moveBooksFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      bookIds: z.array(z.string()).min(1),
      libraryId: z.string(),
      shelfId: z.string().nullable(),
    }),
  )
  .handler(({ context, data }) =>
    moveBooks(context.user.id, data.bookIds, {
      libraryId: data.libraryId,
      shelfId: data.shelfId,
    }),
  )

export const getBookCardFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) => getBookCard(context.user.id, data.bookId))

export const listBooksFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      query: z.string().optional(),
      libraryId: z.string().optional(),
      shelfId: z.union([z.string(), z.literal('unsorted')]).optional(),
      seriesId: z.string().optional(),
      tagId: z.string().optional(),
      status: z
        .enum(['in_library', 'wishlist', 'gifted', 'lost', 'lent', 'hidden'])
        .optional(),
      reading: z.enum(['unread', 'reading', 'read', 'abandoned']).optional(),
      author: z.string().optional(),
      yearFrom: z.number().int().optional(),
      yearTo: z.number().int().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const result = await listBooks(context.user.id, data)
    const lent = await activeLoansFor(result.rows.map((r) => r.id))
    return {
      total: result.total,
      rows: result.rows.map((r) => ({
        ...r,
        lentTo: lent.get(r.id)?.borrowerName ?? null,
      })),
    }
  })

export const giftBookFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      bookId: z.string(),
      giftedTo: z.string().trim().min(1, 'Кому подарили?'),
    }),
  )
  .handler(({ context, data }) =>
    giftBook(context.user.id, data.bookId, data.giftedTo),
  )

export const markLostFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) => markLost(context.user.id, data.bookId))

export const restoreToLibraryFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) =>
    restoreToLibrary(context.user.id, data.bookId),
  )

/** Справочники для формы книги одним запросом. */
export const getBookFormMetaFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const [libraries, tags] = await Promise.all([
      listMyLibraries(context.user.id),
      listMyTags(context.user.id),
    ])
    return { libraries, tags: tags.map((t) => t.name) }
  })

export const setBookHiddenFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string(), hidden: z.boolean() }))
  .handler(({ context, data }) =>
    setBookHidden(context.user.id, data.bookId, data.hidden),
  )

export const listAuthorsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listAuthorFacet(context.user.id))
