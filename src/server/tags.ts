import { createServerFn } from '@tanstack/react-start'

import { listMyTags } from '@/services/tags'
import { authMiddleware } from './middleware'

export const listMyTagsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listMyTags(context.user.id))
