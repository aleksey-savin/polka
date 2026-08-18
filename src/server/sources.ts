import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  getSourceSettings,
  probeSources,
  saveSourceSettings,
} from '@/services/sources'
import { checkWebSearch, saveWebSettings } from '@/services/webSearch'
import { requireAdmin } from '@/services/moderation'
import {
  SOURCES,
  moveSource,
  setEnabled,
  sourceStates,
} from '@/services/bookSources'
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

/** Список источников с порядком — он же цепочка поиска (M30). */
export const listSourcesFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.user.id)
    const states = await sourceStates()
    return states.map((state) => ({
      ...state,
      ...SOURCES.find((s) => s.key === state.key)!,
    }))
  })

export const setSourceEnabledFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ key: z.string(), enabled: z.boolean() }))
  .handler(({ context, data }) =>
    setEnabled(
      context.user.id,
      data.key as Parameters<typeof setEnabled>[1],
      data.enabled,
    ),
  )

export const moveSourceFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ key: z.string(), direction: z.enum(['up', 'down']) }))
  .handler(({ context, data }) =>
    moveSource(
      context.user.id,
      data.key as Parameters<typeof moveSource>[1],
      data.direction,
    ),
  )
