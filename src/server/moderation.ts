import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  accountOf,
  listLog,
  approveItem,
  getDraft,
  listQueue,
  queueCounts,
  saveDraft,
  undoDecision,
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

/** Счётчики табов — отдельно от списка, чтобы не тянуть все строки. */
export const queueCountsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => queueCounts(context.user.id))

export const moderationQueueFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      filter: z.enum(['reported', 'pending', 'resolved']),
      cursor: z.string().nullable().optional(),
    }),
  )
  .handler(({ context, data }) =>
    listQueue(context.user.id, data.filter, data.cursor),
  )

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
  .validator(z.object({ cursor: z.string().nullable().optional() }).optional())
  .handler(({ context, data }) => listLog(context.user.id, data?.cursor))

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

/**
 * Сводка для списка разделов настроек (M26.5): состояние каждого — прямо в
 * списке, чтобы «Google без ключа» или «ИИ выключен» было видно не заходя.
 */
export const serviceOverviewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const account = await accountOf(context.user.id)
    const isAdmin = account.role === 'admin'
    const pending = await pendingCount(context.user.id)
    const aiPending = 0
    if (!isAdmin) {
      return {
        isAdmin,
        pending,
        aiPending,
        ai: null,
        mail: null,
        sources: null,
        users: null,
      }
    }
    const [ai, mail, sources, users] = await Promise.all([
      import('@/services/ai').then((m) => m.getAiSettings()),
      import('@/services/mail').then((m) => m.getMailSettings()),
      import('@/services/sources').then((m) =>
        m.getSourceSettings(context.user.id),
      ),
      listUsers(context.user.id),
    ])
    return {
      isAdmin,
      pending,
      aiPending,
      ai: {
        enabled: ai.enabled,
        configured: ai.configured,
        failed: ai.lastResult?.startsWith('ошибка') ?? false,
      },
      mail: { configured: mail.configured },
      sources: {
        hasGoogleKey: sources.hasGoogleKey,
        webEnabled: sources.web.enabled,
      },
      users: { count: users.length, role: account.role },
    }
  })

/** Одобрение с необязательной публикацией копии в эталон (M29). */
export const approveItemFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({ itemId: z.string(), toReference: z.boolean().optional() }),
  )
  .handler(({ context, data }) =>
    approveItem(context.user.id, data.itemId, data.toReference ?? false),
  )

/** Отмена решения: запись возвращается в очередь, последствия снимаются. */
export const undoDecisionFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ itemId: z.string() }))
  .handler(({ context, data }) => undoDecision(context.user.id, data.itemId))

export const getDraftFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ itemId: z.string() }))
  .handler(({ context, data }) => getDraft(context.user.id, data.itemId))

export const saveDraftFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      itemId: z.string(),
      title: z.string(),
      authors: z.string(),
      publisher: z.string().nullable(),
      year: z.number().int().nullable(),
    }),
  )
  .handler(({ context, data }) =>
    saveDraft(context.user.id, data.itemId, {
      title: data.title,
      authors: data.authors,
      publisher: data.publisher,
      year: data.year,
    }),
  )
