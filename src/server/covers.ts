import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { book } from '@/db/schema/catalog'
import { requireBookAccess } from '@/services/books'
import { deleteCover, saveCover } from '@/services/covers'
import { AppError } from '@/services/errors'
import { authMiddleware } from './middleware'

function parseUpload(data: unknown): { bookId: string; file: File } {
  if (!(data instanceof FormData)) throw new AppError('Ожидалась форма с файлом', 'invalid')
  const bookId = data.get('bookId')
  const file = data.get('file')
  if (typeof bookId !== 'string' || !bookId) throw new AppError('Не указана книга', 'invalid')
  if (!(file instanceof File) || file.size === 0) throw new AppError('Выберите файл обложки', 'invalid')
  return { bookId, file }
}

export const uploadCoverFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(parseUpload)
  .handler(async ({ context, data }) => {
    await requireBookAccess(context.user.id, data.bookId)
    const coverPath = await saveCover(data.bookId, await data.file.arrayBuffer())
    await db.update(book).set({ coverPath, updatedAt: new Date() }).where(eq(book.id, data.bookId))
    return { coverPath }
  })

export const removeCoverFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (typeof data !== 'object' || data === null || typeof (data as { bookId?: unknown }).bookId !== 'string') {
      throw new AppError('Не указана книга', 'invalid')
    }
    return { bookId: (data as { bookId: string }).bookId }
  })
  .handler(async ({ context, data }) => {
    const row = await requireBookAccess(context.user.id, data.bookId)
    if (row.coverPath) await deleteCover(row.coverPath)
    await db.update(book).set({ coverPath: null, updatedAt: new Date() }).where(eq(book.id, data.bookId))
  })
