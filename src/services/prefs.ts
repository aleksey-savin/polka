import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { userPref } from '@/db/schema/catalog'

/** Настройки пользователя (M19). Живут в профиле — не в localStorage. */

export type SkipAction = 'ask' | 'save-isbn' | 'discard'

export interface UserPrefs {
  skipAction: SkipAction
}

const DEFAULTS: UserPrefs = { skipAction: 'ask' }

export async function getPrefs(userId: string): Promise<UserPrefs> {
  const [row] = await db
    .select({ skipAction: userPref.skipAction })
    .from(userPref)
    .where(eq(userPref.userId, userId))
  return row ?? DEFAULTS
}

export async function setPrefs(
  userId: string,
  patch: Partial<UserPrefs>,
): Promise<void> {
  await db
    .insert(userPref)
    .values({ userId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userPref.userId,
      set: { ...patch, updatedAt: new Date() },
    })
}
