import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { lookupIsbn } from '@/services/metadata/lookup'
import { authMiddleware } from './middleware'

export const lookupIsbnFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ isbn: z.string().trim().min(1) }))
  .handler(({ context, data }) => lookupIsbn(context.user.id, data.isbn))
