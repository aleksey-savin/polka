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
    // письмо со ссылкой на сброс; если почта не настроена, ссылки на входе нет
    sendResetPassword: async ({ user, url }) => {
      const { sendMail, layout, button } = await import('@/services/mail')
      await sendMail(
        'reset',
        user.email,
        'Восстановление пароля в Полке',
        {
          text: `Кто-то попросил сбросить пароль от вашей Полки. Ссылка действует час:\n${url}\n\nЕсли вы этого не просили — просто удалите письмо, пароль останется прежним.`,
          html: layout(
            'Восстановление пароля',
            `<p>Здравствуйте, ${user.name}!</p>
             <p>Кто-то попросил сбросить пароль от вашей Полки. Если это вы — нажмите кнопку, она действует час.</p>
             ${button(url, 'Задать новый пароль')}
             <p style="font-size:12.5px;color:#5C6472">Если вы этого не просили, просто удалите письмо: пароль останется прежним. Ссылка сработает один раз.</p>`,
          ),
        },
      )
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      // до подтверждения вход остаётся по старому адресу: опечатка
      // в новой почте больше не отрезает доступ навсегда
      sendChangeEmailVerification: async ({
        user,
        newEmail,
        url,
      }: {
        user: { name: string; email: string }
        newEmail: string
        url: string
      }) => {
        const { sendMail, layout, button } = await import('@/services/mail')
        await sendMail('email-change', newEmail, 'Подтвердите новую почту', {
          text: `Подтвердите смену почты в Полке: ${url}`,
          html: layout(
            'Подтвердите новую почту',
            `<p>Здравствуйте, ${user.name}!</p>
             <p>Вы меняете почту в Полке на этот адрес. Подтвердите — до тех пор вход остаётся по старому.</p>
             ${button(url, 'Подтвердить адрес')}`,
          ),
        })
      },
    },
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
