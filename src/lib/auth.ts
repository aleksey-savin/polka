import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '@/db'
import * as schema from '@/db/schema/auth'
import { env } from '@/lib/env'
import {
  consumeSignupInvite,
  hasAnyUser,
  isSignupInviteValid,
} from '@/services/signupInvites'

const SIGNUP_INVITE_HEADER = 'x-signup-invite'

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: {
    enabled: true,
  },
  hooks: {
    // Регистрация: первый пользователь — свободно; дальше — только по инвайту.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return
      if (!(await hasAnyUser())) return
      const token = ctx.headers?.get(SIGNUP_INVITE_HEADER) ?? ''
      if (!token || !(await isSignupInviteValid(token))) {
        throw new APIError('FORBIDDEN', {
          message: 'Регистрация — только по ссылке-приглашению',
        })
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return
      const token = ctx.headers?.get(SIGNUP_INVITE_HEADER)
      const newUserId = ctx.context.newSession?.user.id
      if (token && newUserId) await consumeSignupInvite(token, newUserId)
    }),
  },
  advanced: {
    // Приложение живёт за Nginx Proxy Manager — клиентский IP приходит в заголовке.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
  },
  // tanstackStartCookies должен быть ПОСЛЕДНИМ плагином — иначе серверный
  // sign-in не выставит cookie (см. docs/architecture.md).
  plugins: [tanstackStartCookies()],
})

export type Session = typeof auth.$Infer.Session
