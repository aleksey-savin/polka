import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  accountOf,
  listLog,
  listQueue,
  listUsers,
  pendingCount,
  report,
  resolve,
  setBlocked,
  setPublishBan,
  setRole,
} from '@/services/moderation'
import { authMiddleware } from './middleware'

const kind = z.enum(['book_cover', 'share', 'ref_work', 'ref_book'])

export const myAccountFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => accountOf(context.user.id))

export const pendingModerationFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => pendingCount(context.user.id))

export const moderationQueueFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ filter: z.enum(['reported', 'pending', 'resolved']) }))
  .handler(({ context, data }) => listQueue(context.user.id, data.filter))

export const resolveModerationFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      itemId: z.string(),
      decision: z.enum(['ok', 'removed']),
      reason: z.string().nullable(),
      deleteFile: z.boolean().optional(),
    }),
  )
  .handler(({ context, data }) =>
    resolve(
      context.user.id,
      data.itemId,
      data.decision,
      data.reason,
      data.deleteFile ?? false,
    ),
  )

export const moderationLogFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listLog(context.user.id))

export const listUsersFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listUsers(context.user.id))

export const setRoleFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      targetId: z.string(),
      role: z.enum(['user', 'moderator', 'admin']),
    }),
  )
  .handler(({ context, data }) =>
    setRole(context.user.id, data.targetId, data.role),
  )

export const setPublishBanFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      targetId: z.string(),
      banned: z.boolean(),
      reason: z.string().nullable(),
    }),
  )
  .handler(({ context, data }) =>
    setPublishBan(context.user.id, data.targetId, data.banned, data.reason),
  )

export const setBlockedFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      targetId: z.string(),
      blocked: z.boolean(),
      reason: z.string().nullable(),
    }),
  )
  .handler(({ context, data }) =>
    setBlocked(context.user.id, data.targetId, data.blocked, data.reason),
  )

/** Жалоба с публичной витрины — доступна и гостю без аккаунта. */
export const reportContentFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      kind,
      targetId: z.string(),
      reason: z.string().min(1),
      note: z.string().nullable(),
    }),
  )
  .handler(({ data }) =>
    report(data.kind, data.targetId, data.reason, data.note, null),
  )
