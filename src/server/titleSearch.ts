import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { adoptExternalWork, searchByTitle } from '@/services/titleSearch'
import { authMiddleware } from './middleware'

export const searchByTitleFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ query: z.string() }))
  .handler(({ context, data }) => searchByTitle(context.user.id, data.query))

/** Внешний результат выбран — заводим произведение в эталоне. */
export const adoptWorkFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      sourceId: z.string(),
      title: z.string(),
      authors: z.string(),
      year: z.number().nullable(),
      workType: z.string().nullable(),
    }),
  )
  .handler(({ data }) =>
    adoptExternalWork(
      data.sourceId,
      data.title,
      data.authors,
      data.year,
      data.workType,
    ),
  )
