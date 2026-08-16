import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  checkAi,
  getAiSettings,
  listModels,
  saveAiSettings,
  usageToday,
} from '@/services/ai'
import { requireAdmin } from '@/services/moderation'
import { authMiddleware } from './middleware'

export const getAiSettingsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.user.id)
    const [settings, usage] = await Promise.all([
      getAiSettings(),
      usageToday(context.user.id),
    ])
    return { settings, usage }
  })

export const saveAiSettingsFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      enabled: z.boolean(),
      provider: z.enum(['yandex', 'openai']),
      apiKey: z.string().optional(),
      folderId: z.string(),
      model: z.string(),
      endpoint: z.string(),
      dailyLimit: z.number().int().min(0).max(10_000),
    }),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context.user.id)
    await saveAiSettings(data)
  })

/** Проверка связи: тратит один запрос, ответ показываем дословно. */
export const checkAiFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.user.id)
    return checkAi(context.user.id)
  })

export const listAiModelsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.user.id)
    return listModels()
  })
