import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import {
  approveRequest,
  countPendingRequests,
  createBorrowRequest,
  declineRequest,
  listPendingRequests,
} from '@/services/requests'
import {
  listSavedShares,
  removeSavedShare,
  saveShare,
  searchFriendsBooks,
} from '@/services/savedShares'
import {
  createShare,
  getShareView,
  listMyShares,
  revokeShare,
} from '@/services/shares'
import {
  createSignupInvite,
  isSignupInviteValid,
} from '@/services/signupInvites'
import { authMiddleware } from './middleware'

// ── Мои ссылки ─────────────────────────────────────────────────────────

export const createShareFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.union([
      z.object({ scope: z.literal('library'), libraryId: z.string() }),
      z.object({ scope: z.literal('shelf'), shelfId: z.string() }),
    ]),
  )
  .handler(({ context, data }) => createShare(context.user.id, data))

export const listMySharesFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listMyShares(context.user.id))

export const revokeShareFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ shareId: z.string() }))
  .handler(({ context, data }) => revokeShare(context.user.id, data.shareId))

// ── Публичная витрина (без сессии) ─────────────────────────────────────

export const getShareViewFn = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string() }))
  .handler(({ data }) => getShareView(data.token))

/** Гость или залогиненный: имя из формы или из аккаунта. */
export const createBorrowRequestFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      token: z.string(),
      bookId: z.string(),
      guestName: z.string().trim().min(1, 'Представьтесь, пожалуйста'),
      note: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const headers = getRequestHeaders()
    const session = await auth.api.getSession({ headers })
    const ip = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
    return createBorrowRequest({
      ...data,
      requesterUserId: session?.user.id ?? null,
      ip,
    })
  })

// ── Полки друзей ───────────────────────────────────────────────────────

export const saveShareFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ token: z.string() }))
  .handler(({ context, data }) => saveShare(context.user.id, data.token))

export const listSavedSharesFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listSavedShares(context.user.id))

export const removeSavedShareFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ shareId: z.string() }))
  .handler(({ context, data }) =>
    removeSavedShare(context.user.id, data.shareId),
  )

export const searchFriendsBooksFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ query: z.string().optional() }))
  .handler(({ context, data }) =>
    searchFriendsBooks(context.user.id, data.query ?? ''),
  )

// ── Заявки ─────────────────────────────────────────────────────────────

export const listPendingRequestsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listPendingRequests(context.user.id))

export const countPendingRequestsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => countPendingRequests(context.user.id))

export const approveRequestFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ requestId: z.string() }))
  .handler(({ context, data }) =>
    approveRequest(context.user.id, data.requestId),
  )

export const declineRequestFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ requestId: z.string() }))
  .handler(({ context, data }) =>
    declineRequest(context.user.id, data.requestId),
  )

// ── Приглашение в Полку (регистрация) ──────────────────────────────────

export const createSignupInviteFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .handler(({ context }) => createSignupInvite(context.user.id))

export const checkSignupInviteFn = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string() }))
  .handler(async ({ data }) => ({
    valid: await isSignupInviteValid(data.token),
  }))
