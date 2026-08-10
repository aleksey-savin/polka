import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '@/db'
import * as schema from '@/db/schema/auth'
import { env } from '@/lib/env'

export const auth = betterAuth({
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: !env.REGISTRATION_OPEN,
  },
  // tanstackStartCookies должен быть ПОСЛЕДНИМ плагином — иначе серверный
  // sign-in не выставит cookie (см. docs/architecture.md).
  plugins: [tanstackStartCookies()],
})

export type Session = typeof auth.$Infer.Session
