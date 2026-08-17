import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  getSourceSettings,
  probeSources,
  saveSourceSettings,
} from '@/services/sources'
import { authMiddleware } from './middleware'

export const getSourceSettingsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => getSourceSettings(context.user.id))

export const saveSourceSettingsFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ googleKey: z.string() }))
  .handler(({ context, data }) =>
    saveSourceSettings(context.user.id, data.googleKey),
  )

export const probeSourcesFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(({ context }) => probeSources(context.user.id))
