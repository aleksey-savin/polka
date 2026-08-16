import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  getMailSettings,
  mailReady,
  saveMailSettings,
  sendTestMail,
} from '@/services/mail'
import { requireAdmin } from '@/services/moderation'
import { authMiddleware } from './middleware'

export const getMailSettingsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await requireAdmin(context.user.id)
    return getMailSettings()
  })

export const saveMailSettingsFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      host: z.string(),
      port: z.number().int().min(1).max(65535),
      secure: z.enum(['none', 'starttls', 'tls']),
      username: z.string(),
      password: z.string().optional(),
      fromName: z.string(),
      fromEmail: z.string(),
      sendReset: z.boolean(),
      sendInvites: z.boolean(),
      sendEmailChange: z.boolean(),
      sendNotifications: z.boolean(),
    }),
  )
  .handler(async ({ context, data }) => {
    await requireAdmin(context.user.id)
    await saveMailSettings(data)
  })

export const sendTestMailFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ to: z.email() }))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.user.id)
    return sendTestMail(data.to)
  })

/** Показывать ли «Забыли пароль?» — страница входа спрашивает без сессии. */
export const resetAvailableFn = createServerFn({ method: 'GET' }).handler(() =>
  mailReady('reset'),
)

/** Показывать ли «отправить письмом» в приглашениях. */
export const inviteMailReadyFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(() => mailReady('invite'))
