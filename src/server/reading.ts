import { createServerFn } from '@tanstack/react-start'

import { getReadingHub } from '@/services/reading'
import { authMiddleware } from './middleware'

export const getReadingHubFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => getReadingHub(context.user.id))
