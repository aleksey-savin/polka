import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { getPrefs, setPrefs } from '@/services/prefs'
import { authMiddleware } from './middleware'

export const getPrefsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => getPrefs(context.user.id))

export const setPrefsFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({ skipAction: z.enum(['ask', 'save-isbn', 'discard']).optional() }),
  )
  .handler(({ context, data }) => setPrefs(context.user.id, data))
