import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  fetchWorkEditions,
  getRefBookView,
  getWorkView,
} from '@/services/reference'
import { authMiddleware } from './middleware'

export const getWorkViewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ workId: z.string() }))
  .handler(({ context, data }) => getWorkView(context.user.id, data.workId))

/** Ленивое наполнение изданий произведения (первое открытие шторки). */
export const fetchWorkEditionsFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ workId: z.string() }))
  .handler(({ context, data }) =>
    fetchWorkEditions(context.user.id, data.workId),
  )

export const getRefBookViewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ refBookId: z.string() }))
  .handler(({ context, data }) =>
    getRefBookView(context.user.id, data.refBookId),
  )
