import { and, asc, count, eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { bookTag, tag } from '@/db/schema/catalog'

export async function listMyTags(userId: string): Promise<Array<{ id: string; name: string; bookCount: number }>> {
  const rows = await db
    .select({ id: tag.id, name: tag.name, bookCount: count(bookTag.bookId) })
    .from(tag)
    .leftJoin(bookTag, eq(bookTag.tagId, tag.id))
    .where(eq(tag.ownerId, userId))
    .groupBy(tag.id)
    .orderBy(asc(tag.name))
  return rows
}

/**
 * Задаёт МОИ тэги книги (создаёт недостающие). Чужие тэги на книге
 * (например, совладельца библиотеки) не трогаем.
 */
export async function setBookTags(userId: string, bookId: string, names: Array<string>): Promise<void> {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))]

  const mine = await db.select({ id: tag.id, name: tag.name }).from(tag).where(eq(tag.ownerId, userId))
  const byName = new Map(mine.map((t) => [t.name.toLowerCase(), t.id]))

  const wantedIds: Array<string> = []
  for (const name of clean) {
    const existing = byName.get(name.toLowerCase())
    if (existing) {
      wantedIds.push(existing)
    } else {
      const [created] = await db.insert(tag).values({ ownerId: userId, name }).returning({ id: tag.id })
      if (created) wantedIds.push(created.id)
    }
  }

  const myTagIds = mine.map((t) => t.id)
  if (myTagIds.length > 0) {
    await db.delete(bookTag).where(and(eq(bookTag.bookId, bookId), inArray(bookTag.tagId, myTagIds)))
  }
  if (wantedIds.length > 0) {
    await db.insert(bookTag).values(wantedIds.map((tagId) => ({ bookId, tagId })))
  }
}
