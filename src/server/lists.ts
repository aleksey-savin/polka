import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  addToList,
  createList,
  deleteList,
  defaultWishlistId,
  getList,
  listMyLists,
  listsForTarget,
  removeFromList,
  removeItem,
  setItemNote,
  updateList,
} from '@/services/lists'
import {
  createListShare,
  getListShareView,
  holdGift,
  listGiftHolds,
  publicShareKind,
  releaseGift,
} from '@/services/listShares'
import { authMiddleware } from './middleware'

const kind = z.enum(['wishlist', 'collection'])
const target = z
  .object({
    bookId: z.string().optional(),
    refWorkId: z.string().optional(),
    refBookId: z.string().optional(),
  })
  .refine(
    (t) => [t.bookId, t.refWorkId, t.refBookId].filter(Boolean).length === 1,
    'Нужна ровно одна ссылка на книгу',
  )
  .transform((t) =>
    t.bookId
      ? { bookId: t.bookId }
      : t.refWorkId
        ? { refWorkId: t.refWorkId }
        : { refBookId: t.refBookId! },
  )

export const listMyListsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listMyLists(context.user.id))

export const getListFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ listId: z.string() }))
  .handler(({ context, data }) => getList(context.user.id, data.listId))

export const defaultWishlistIdFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => defaultWishlistId(context.user.id))

export const createListFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      kind,
      title: z.string().min(1),
      description: z.string().optional(),
    }),
  )
  .handler(({ context, data }) => createList(context.user.id, data))

export const updateListFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      listId: z.string(),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      kind: kind.optional(),
    }),
  )
  .handler(({ context, data }) => {
    const { listId, ...patch } = data
    return updateList(context.user.id, listId, patch)
  })

export const deleteListFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ listId: z.string() }))
  .handler(({ context, data }) => deleteList(context.user.id, data.listId))

export const listsForTargetFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(target)
  .handler(({ context, data }) => listsForTarget(context.user.id, data))

export const addToListFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      listId: z.string(),
      bookId: z.string().optional(),
      refWorkId: z.string().optional(),
      refBookId: z.string().optional(),
      note: z.string().optional(),
    }),
  )
  .handler(({ context, data }) => {
    const t = target.parse(data)
    return addToList(context.user.id, data.listId, t, data.note)
  })

export const removeFromListFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      listId: z.string(),
      bookId: z.string().optional(),
      refWorkId: z.string().optional(),
      refBookId: z.string().optional(),
    }),
  )
  .handler(({ context, data }) =>
    removeFromList(context.user.id, data.listId, target.parse(data)),
  )

export const removeListItemFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ itemId: z.string() }))
  .handler(({ context, data }) => removeItem(context.user.id, data.itemId))

export const setItemNoteFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ itemId: z.string(), note: z.string() }))
  .handler(({ context, data }) =>
    setItemNote(context.user.id, data.itemId, data.note),
  )

// ── Шэринг списка и брони ──────────────────────────────────────────────

export const createListShareFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ listId: z.string() }))
  .handler(({ context, data }) => createListShare(context.user.id, data.listId))

export const listGiftHoldsFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ listId: z.string() }))
  .handler(({ context, data }) => listGiftHolds(context.user.id, data.listId))

/** Что за ссылка: витрина каталога или список. */
export const publicShareKindFn = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string() }))
  .handler(({ data }) => publicShareKind(data.token))

/** Публичные — без авторизации: витрина по токену. */
export const getListShareViewFn = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string(), holderKey: z.string().optional() }))
  .handler(({ data }) => getListShareView(data.token, data.holderKey))

export const holdGiftFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      token: z.string(),
      itemId: z.string(),
      guestName: z.string().min(1),
      holderKey: z.string().min(8),
    }),
  )
  .handler(({ data }) =>
    holdGift(data.token, data.itemId, data.guestName, data.holderKey),
  )

export const releaseGiftFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      token: z.string(),
      itemId: z.string(),
      holderKey: z.string().min(8),
    }),
  )
  .handler(({ data }) => releaseGift(data.token, data.itemId, data.holderKey))
