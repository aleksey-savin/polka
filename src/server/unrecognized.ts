import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  countUnrecognized,
  listUnrecognized,
  retryLookup,
} from '@/services/unrecognized'
import { authMiddleware } from './middleware'

export const listUnrecognizedFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listUnrecognized(context.user.id))

export const countUnrecognizedFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => countUnrecognized(context.user.id))

/** Повторный поиск в источниках — только по кнопке пользователя. */
export const retryLookupFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookIds: z.array(z.string()).min(1) }))
  .handler(({ context, data }) => retryLookup(context.user.id, data.bookIds))
