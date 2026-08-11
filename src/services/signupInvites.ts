import { count, eq } from 'drizzle-orm'

import { db } from '@/db'
import { user } from '@/db/schema/auth'
import { signupInvite } from '@/db/schema/circulation'
import { AppError } from './errors'
import { randomToken } from './random'

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 дней

/** Есть ли в системе хоть один пользователь: пустая система = свободная регистрация первого. */
export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(user)
  return (row?.n ?? 0) > 0
}

/** Одноразовая ссылка-приглашение в Полку (единственный способ зарегистрироваться, когда система не пуста). */
export async function createSignupInvite(
  userId: string,
): Promise<{ token: string }> {
  const token = randomToken()
  await db.insert(signupInvite).values({
    token,
    createdBy: userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  })
  return { token }
}

export async function isSignupInviteValid(token: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(signupInvite)
    .where(eq(signupInvite.token, token))
  if (!row) return false
  if (row.usedAt) return false
  if (row.expiresAt.getTime() < Date.now()) return false
  return true
}

export async function assertSignupInviteValid(token: string): Promise<void> {
  if (!(await isSignupInviteValid(token))) {
    throw new AppError(
      'Приглашение не действует — попросите новую ссылку',
      'not_found',
    )
  }
}

/** Погасить приглашение после успешной регистрации. */
export async function consumeSignupInvite(
  token: string,
  newUserId: string,
): Promise<void> {
  await db
    .update(signupInvite)
    .set({ usedAt: new Date(), usedBy: newUserId })
    .where(eq(signupInvite.token, token))
}
