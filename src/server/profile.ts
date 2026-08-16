import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'

import { auth } from '@/lib/auth'
import { AppError } from '@/services/errors'
import { authMiddleware } from './middleware'

/** Профиль: имя, почта (она же логин) и смена пароля. Писем приложение не шлёт. */

export const updateProfileFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().trim().min(1, 'Имя не может быть пустым'),
      email: z.email('Неправильная почта'),
    }),
  )
  .handler(async ({ context, data }) => {
    const headers = getRequestHeaders()
    if (data.name !== context.user.name) {
      await auth.api.updateUser({ body: { name: data.name }, headers })
    }
    if (data.email.toLowerCase() !== context.user.email.toLowerCase()) {
      try {
        await auth.api.changeEmail({ body: { newEmail: data.email }, headers })
      } catch (error) {
        throw new AppError(
          error instanceof Error && /exist/i.test(error.message)
            ? 'Такая почта уже занята'
            : 'Не получилось сменить почту',
          'invalid',
        )
      }
    }
  })

export const changePasswordFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      currentPassword: z.string().min(1, 'Введите текущий пароль'),
      newPassword: z.string().min(8, 'Новый пароль — не короче 8 символов'),
    }),
  )
  .handler(async ({ data }) => {
    try {
      await auth.api.changePassword({
        body: {
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
          // другие устройства разлогиниваем, текущее остаётся
          revokeOtherSessions: true,
        },
        headers: getRequestHeaders(),
      })
    } catch {
      throw new AppError('Текущий пароль не подошёл', 'invalid')
    }
  })
