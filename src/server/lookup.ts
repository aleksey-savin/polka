import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { lookupIsbn } from '@/services/metadata/lookup'
import { FULL_BUDGET_MS, QUICK_BUDGET_MS } from '@/services/find/types'
import { authMiddleware } from './middleware'

/**
 * Режим — это только бюджет времени, а не другая цепочка: «Стопкой» успевает
 * бесплатные каталоги, «По одной» проходит список до конца.
 */
export const lookupIsbnFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      isbn: z.string(),
      depth: z.enum(['quick', 'full']).optional(),
    }),
  )
  .handler(({ context, data }) =>
    lookupIsbn(context.user.id, data.isbn, {
      budgetMs: data.depth === 'full' ? FULL_BUDGET_MS : QUICK_BUDGET_MS,
    }),
  )
