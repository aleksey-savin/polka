import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  getSourceSettings,
  probeSources,
  saveSourceSettings,
} from '@/services/sources'
import { checkWebSearch, saveWebSettings } from '@/services/webSearch'
import { requireAdmin } from '@/services/moderation'
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

export const saveWebSettingsFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      enabled: z.boolean(),
      paidFallback: z.boolean(),
      dailyLimit: z.number().int().min(0).max(10_000),
    }),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context.user.id)
    await saveWebSettings(data)
  })

export const checkWebSearchFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.user.id)
    return checkWebSearch(context.user.id)
  })
