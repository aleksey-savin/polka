import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { getSeriesView, listSeries, suggestSeries } from '@/services/series'
import { authMiddleware } from './middleware'

export const listSeriesFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listSeries(context.user.id))

export const getSeriesViewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ seriesId: z.string() }))
  .handler(({ context, data }) => getSeriesView(context.user.id, data.seriesId))

export const suggestSeriesFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ query: z.string() }))
  .handler(({ context, data }) => suggestSeries(context.user.id, data.query))
