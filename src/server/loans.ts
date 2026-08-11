import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  bookLoanHistory,
  lendBook,
  listLoans,
  returnLoan,
} from '@/services/loans'
import { authMiddleware } from './middleware'

export const lendBookFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      bookId: z.string(),
      borrowerName: z.string().trim().min(1, 'Скажите, кому дали книгу'),
      dueAt: z.iso.date().nullable().optional(),
      note: z.string().optional(),
    }),
  )
  .handler(({ context, data }) =>
    lendBook(context.user.id, data.bookId, {
      borrowerName: data.borrowerName,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      note: data.note,
    }),
  )

export const returnLoanFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ loanId: z.string() }))
  .handler(({ context, data }) => returnLoan(context.user.id, data.loanId))

export const listLoansFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ kind: z.enum(['active', 'history']) }))
  .handler(({ context, data }) => listLoans(context.user.id, data.kind))

export const bookLoanHistoryFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) => bookLoanHistory(context.user.id, data.bookId))
