import { createMiddleware } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { auth } from '@/lib/auth'
import { log } from '@/lib/logger'
import { AppError } from '@/services/errors'

/**
 * Ошибки серверных функций не должны исчезать: клиент видит тост, а причина
 * с полным стеком — в журнале. Ожидаемые AppError пишем предупреждением,
 * всё остальное — ошибкой.
 */
export const loggingMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const started = performance.now()
    try {
      const result = await next()
      const ms = Math.round(performance.now() - started)
      if (ms > 1500) log.warn('fn', 'серверная функция отвечала долго', { ms })
      else log.debug('fn', 'серверная функция выполнена', { ms })
      return result
    } catch (error) {
      const ms = Math.round(performance.now() - started)
      if (error instanceof AppError) {
        log.warn('fn', error.message, { code: error.code, ms })
      } else {
        log.error('fn', 'серверная функция упала', {
          error: error instanceof Error ? error : new Error(String(error)),
          ms,
        })
      }
      throw error
    }
  },
)

/** Обязательная сессия для серверных функций каталога. Кладёт user в context. */
export const authMiddleware = createMiddleware({ type: 'function' })
  .middleware([loggingMiddleware])
  .server(async ({ next }) => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) throw new AppError('Нужно войти', 'forbidden')
    // заблокированный аккаунт живёт, но ничего не может (M21)
    const { accountOf } = await import('@/services/moderation')
    const account = await accountOf(session.user.id)
    if (account.blocked) {
      throw new AppError(
        account.blockedReason
          ? `Аккаунт заблокирован: ${account.blockedReason}`
          : 'Аккаунт заблокирован',
        'forbidden',
      )
    }
    return next({ context: { user: session.user, account } })
  })
