import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { getAuthorPage } from '@/services/authors'
import { authMiddleware } from './middleware'

export const getAuthorPageFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ authorId: z.string() }))
  .handler(({ context, data }) => getAuthorPage(context.user.id, data.authorId))
