import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  aiMarkFor,
  applyProposal,
  nextVariant,
  applyRecognition,
  dismissProposal,
  dismissRecognition,
  proposeForBook,
  approveToReference,
  listAiReview,
  pendingAiReview,
  recognizeBook,
  rejectRecognition,
  revertRecognition,
} from '@/services/aiRecognize'
import { usageToday } from '@/services/ai'
import { authMiddleware } from './middleware'

export const recognizeBookFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      bookId: z.string(),
      force: z.boolean().optional(),
      mode: z.enum(['extract', 'generative']).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const result = await recognizeBook(context.user.id, data.bookId, {
      force: data.force,
      mode: data.mode,
    })
    return { result, usage: await usageToday(context.user.id) }
  })

export const applyRecognitionFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      bookId: z.string(),
      coverUrl: z.string().optional(),
      variantVia: z.string().optional(),
    }),
  )
  .handler(({ context, data }) =>
    applyRecognition(
      context.user.id,
      data.bookId,
      data.coverUrl,
      data.variantVia,
    ),
  )

export const revertRecognitionFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) =>
    revertRecognition(context.user.id, data.bookId),
  )

export const listAiReviewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listAiReview(context.user.id))

export const pendingAiReviewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(() => pendingAiReview())

export const approveToReferenceFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      suggestionId: z.string(),
      title: z.string().optional(),
      authors: z.string().optional(),
      publisher: z.string().optional(),
      year: z.number().int().nullable().optional(),
    }),
  )
  .handler(({ context, data }) =>
    approveToReference(context.user.id, data.suggestionId, {
      title: data.title,
      authors: data.authors,
      publisher: data.publisher,
      year: data.year,
    }),
  )

export const rejectRecognitionFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ suggestionId: z.string(), note: z.string() }))
  .handler(({ context, data }) =>
    rejectRecognition(context.user.id, data.suggestionId, data.note),
  )

/** Плашка на карточке книги: что заполнил ИИ и проверено ли это. */
export const aiMarkFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ data }) => aiMarkFor(data.bookId))

/** «Не то»: книга остаётся нераспознанной, ответ больше не предлагается. */
export const dismissRecognitionFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) =>
    dismissRecognition(context.user.id, data.bookId),
  )

/** «Найти данные» на карточке книги: дозаполнение пустых полей. */
export const proposeForBookFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) => proposeForBook(context.user.id, data.bookId))

export const applyProposalFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ suggestionId: z.string() }))
  .handler(({ context, data }) =>
    applyProposal(context.user.id, data.suggestionId),
  )

export const dismissProposalFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ suggestionId: z.string() }))
  .handler(({ context, data }) =>
    dismissProposal(context.user.id, data.suggestionId),
  )

/** «Искать дальше»: отвергнуть показанный вариант и продолжить цепочку. */
export const nextVariantFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(async ({ context, data }) => {
    const result = await nextVariant(context.user.id, data.bookId)
    return { result, usage: await usageToday(context.user.id) }
  })
