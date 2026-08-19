import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  fetchWorkEditions,
  getRefBookView,
  getWorkView,
} from '@/services/reference'
import {
  applyRefUpdate,
  muteRefUpdate,
  refUpdateFor,
  staleBooks,
} from '@/services/reference/sync'
import { authMiddleware } from './middleware'

export const getWorkViewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ workId: z.string() }))
  .handler(({ context, data }) => getWorkView(context.user.id, data.workId))

/** Ленивое наполнение изданий произведения (первое открытие шторки). */
export const fetchWorkEditionsFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ workId: z.string() }))
  .handler(({ context, data }) =>
    fetchWorkEditions(context.user.id, data.workId),
  )

export const getRefBookViewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ refBookId: z.string() }))
  .handler(({ context, data }) =>
    getRefBookView(context.user.id, data.refBookId),
  )

/** Что в эталоне полнее, чем в карточке (M34). */
export const refUpdateForFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string(), force: z.boolean().optional() }))
  .handler(({ context, data }) =>
    refUpdateFor(context.user.id, data.bookId, { force: data.force }),
  )

/** Обновление карточки данными эталона — целиком, по кнопке владельца. */
export const applyRefUpdateFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string(), force: z.boolean().optional() }))
  .handler(({ context, data }) =>
    applyRefUpdate(context.user.id, data.bookId, { force: data.force }),
  )

/** «Больше не напоминать»: карточка владельца его устраивает. */
export const muteRefUpdateFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) => muteRefUpdate(context.user.id, data.bookId))

/** Сводка для «Чтения»: у каких книг эталон ушёл вперёд. */
export const staleBooksFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => staleBooks(context.user.id))
