import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { listBookPersonal, upsertPersonal } from '@/services/personal'
import { authMiddleware } from './middleware'

export const upsertPersonalFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      bookId: z.string(),
      readingStatus: z
        .enum(['unread', 'reading', 'read', 'abandoned'])
        .optional(),
      readAt: z.iso.date().nullable().optional(),
      rating: z.number().int().min(1).max(5).nullable().optional(),
      review: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }),
  )
  .handler(({ context, data }) => {
    const { bookId, readAt, ...rest } = data
    return upsertPersonal(context.user.id, bookId, {
      ...rest,
      ...(readAt !== undefined
        ? { readAt: readAt ? new Date(readAt) : null }
        : {}),
    })
  })

export const listBookPersonalFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) =>
    listBookPersonal(context.user.id, data.bookId),
  )
