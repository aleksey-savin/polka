import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { auth } from '@/lib/auth'
import { AppError } from '@/services/errors'

/** Обязательная сессия для серверных функций каталога. Кладёт user в context. */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) throw new AppError('Нужно войти', 'forbidden')
    return next({ context: { user: session.user } })
  },
)
