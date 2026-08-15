import { and, eq, isNull } from 'drizzle-orm'

import { db } from '@/db'
import { user } from '@/db/schema/auth'
import { bookList, bookListItem } from '@/db/schema/catalog'
import { giftHold, share } from '@/db/schema/circulation'
import { AppError } from './errors'
import { listItems } from './lists'
import { randomToken } from './random'
import type { ListItemView, ListKind } from './lists'

/**
 * Витрина списка по ссылке и бронь подарка (M17).
 * Бронь видна другим гостям как «уже дарят» — без имени, и не видна владельцу:
 * сюрприз портить нельзя. Свою бронь гость снимает по holderKey.
 */

export interface PublicListItem extends ListItemView {
  /** Кто-то уже дарит эту книгу. */
  held: boolean
  /** Дарю я (по ключу этого гостя). */
  heldByMe: boolean
}

export interface ListShareView {
  shareId: string
  token: string
  kind: ListKind
  title: string
  description: string | null
  ownerName: string
  items: Array<PublicListItem>
  /** Брони показываем только для вишлистов. */
  gifts: boolean
}

/** Витрина по токену: каталог (библиотека/полка) или список. */
export async function publicShareKind(
  token: string,
): Promise<'catalog' | 'list'> {
  const [row] = await db
    .select({ scope: share.scope, revokedAt: share.revokedAt })
    .from(share)
    .where(eq(share.token, token))
  if (!row || row.revokedAt) throw new AppError('Ссылка не действует', 'not_found')
  return row.scope === 'list' ? 'list' : 'catalog'
}

export async function createListShare(
  userId: string,
  listId: string,
): Promise<{ token: string }> {
  const [row] = await db
    .select({ ownerId: bookList.ownerId })
    .from(bookList)
    .where(eq(bookList.id, listId))
  if (!row) throw new AppError('Список не найден', 'not_found')
  if (row.ownerId !== userId) throw new AppError('Список чужой', 'forbidden')

  const [existing] = await db
    .select({ token: share.token })
    .from(share)
    .where(
      and(
        eq(share.scope, 'list'),
        eq(share.listId, listId),
        isNull(share.revokedAt),
      ),
    )
    .limit(1)
  if (existing) return { token: existing.token }

  const token = randomToken()
  await db.insert(share).values({
    createdBy: userId,
    token,
    scope: 'list',
    listId,
  })
  return { token }
}

async function resolveListShare(token: string) {
  const [row] = await db.select().from(share).where(eq(share.token, token))
  if (!row || row.revokedAt || row.scope !== 'list' || !row.listId)
    throw new AppError('Ссылка не действует', 'not_found')
  return row
}

/** Витрина списка для гостя; holderKey — чтобы показать «дарю я». */
export async function getListShareView(
  token: string,
  holderKey?: string,
): Promise<ListShareView> {
  const row = await resolveListShare(token)
  const listId = row.listId!
  const [list] = await db
    .select()
    .from(bookList)
    .where(eq(bookList.id, listId))
  if (!list) throw new AppError('Список не найден', 'not_found')

  const [owner] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, list.ownerId))

  // гость видит список чужими глазами: своих книг у него нет
  const items = await listItems(null, listId)
  const holds = await db
    .select({ itemId: giftHold.itemId, holderKey: giftHold.holderKey })
    .from(giftHold)
    .where(and(eq(giftHold.shareId, row.id), isNull(giftHold.canceledAt)))
  const holdByItem = new Map(holds.map((h) => [h.itemId, h.holderKey]))

  return {
    shareId: row.id,
    token,
    kind: list.kind,
    title: list.title,
    description: list.description,
    ownerName: owner?.name ?? '',
    gifts: list.kind === 'wishlist',
    items: items.map((i) => ({
      ...i,
      // на витрине не выдаём, где книга стоит у владельца
      myBookId: null,
      place: null,
      held: holdByItem.has(i.id),
      heldByMe: holderKey !== undefined && holdByItem.get(i.id) === holderKey,
    })),
  }
}

export async function holdGift(
  token: string,
  itemId: string,
  guestName: string,
  holderKey: string,
): Promise<void> {
  const row = await resolveListShare(token)
  const name = guestName.trim()
  if (!name) throw new AppError('Как вас зовут?', 'invalid')
  const [item] = await db
    .select({ listId: bookListItem.listId })
    .from(bookListItem)
    .where(eq(bookListItem.id, itemId))
  if (!item || item.listId !== row.listId)
    throw new AppError('Книги нет в списке', 'not_found')

  await db
    .insert(giftHold)
    .values({ itemId, shareId: row.id, guestName: name, holderKey })
    .onConflictDoNothing()
}

export async function releaseGift(
  token: string,
  itemId: string,
  holderKey: string,
): Promise<void> {
  const row = await resolveListShare(token)
  await db
    .update(giftHold)
    .set({ canceledAt: new Date() })
    .where(
      and(
        eq(giftHold.itemId, itemId),
        eq(giftHold.shareId, row.id),
        eq(giftHold.holderKey, holderKey),
        isNull(giftHold.canceledAt),
      ),
    )
}

export interface GiftRow {
  itemId: string
  title: string
  guestName: string
  createdAt: Date
}

/** «Кто что дарит» — владелец открывает осознанно, со спойлер-предупреждением. */
export async function listGiftHolds(
  userId: string,
  listId: string,
): Promise<Array<GiftRow>> {
  const [list] = await db
    .select({ ownerId: bookList.ownerId })
    .from(bookList)
    .where(eq(bookList.id, listId))
  if (!list) throw new AppError('Список не найден', 'not_found')
  if (list.ownerId !== userId) throw new AppError('Список чужой', 'forbidden')

  const rows = await db
    .select({
      itemId: giftHold.itemId,
      guestName: giftHold.guestName,
      createdAt: giftHold.createdAt,
    })
    .from(giftHold)
    .innerJoin(bookListItem, eq(bookListItem.id, giftHold.itemId))
    .where(
      and(eq(bookListItem.listId, listId), isNull(giftHold.canceledAt)),
    )
  const items = await listItems(userId, listId)
  const titleById = new Map(items.map((i) => [i.id, i.title]))
  return rows.map((r) => ({
    itemId: r.itemId,
    title: titleById.get(r.itemId) ?? '',
    guestName: r.guestName,
    createdAt: r.createdAt,
  }))
}
