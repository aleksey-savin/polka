import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { bookCycle, getCycleView } from '@/services/cycles'
import { authMiddleware } from './middleware'

/** Цикл книги (вычисляется из эталона; null — книга вне циклов). */
export const bookCycleFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) => bookCycle(context.user.id, data.bookId))

export const getCycleViewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(
    z.object({ cycleId: z.string(), currentWorkId: z.string().optional() }),
  )
  .handler(({ context, data }) =>
    getCycleView(context.user.id, data.cycleId, data.currentWorkId),
  )
