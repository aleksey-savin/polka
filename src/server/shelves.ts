import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  createShelf,
  deleteShelf,
  getShelfView,
  updateShelf,
  listAllMyShelves,
} from '@/services/shelves'
import { authMiddleware } from './middleware'

export const createShelfFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      libraryId: z.string(),
      name: z.string().trim().min(1, 'Название обязательно'),
    }),
  )
  .handler(({ context, data }) => createShelf(context.user.id, data))

export const updateShelfFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      shelfId: z.string(),
      name: z.string().trim().min(1).optional(),
      accentColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, 'Цвет — hex вида #AABBCC')
        .nullable()
        .optional(),
    }),
  )
  .handler(({ context, data }) =>
    updateShelf(context.user.id, data.shelfId, {
      name: data.name,
      accentColor: data.accentColor,
    }),
  )

export const deleteShelfFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ shelfId: z.string() }))
  .handler(({ context, data }) => deleteShelf(context.user.id, data.shelfId))

export const getShelfViewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ shelfId: z.string() }))
  .handler(({ context, data }) => getShelfView(context.user.id, data.shelfId))

export const listMyShelvesFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listAllMyShelves(context.user.id))
