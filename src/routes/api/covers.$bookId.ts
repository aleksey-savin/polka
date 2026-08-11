import '@tanstack/react-start' // типы server.handlers
import { createFileRoute } from '@tanstack/react-router'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { book } from '@/db/schema/catalog'
import { auth } from '@/lib/auth'
import { requireBookAccess } from '@/services/books'
import { coverAbsolutePath } from '@/services/covers'
import { isBookPubliclyShared } from '@/services/shares'

export const Route = createFileRoute('/api/covers/$bookId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const session = await auth.api.getSession({
          headers: getRequestHeaders(),
        })
        try {
          let coverPath: string | null = null
          if (session) {
            coverPath = (
              await requireBookAccess(session.user.id, params.bookId)
            ).coverPath
          } else if (await isBookPubliclyShared(params.bookId)) {
            // Обложки книг из активных шэров доступны гостям витрины
            const [row] = await db
              .select({ coverPath: book.coverPath })
              .from(book)
              .where(eq(book.id, params.bookId))
            coverPath = row?.coverPath ?? null
          } else {
            return new Response('Unauthorized', { status: 401 })
          }
          if (!coverPath) return new Response('Not found', { status: 404 })
          const file = Bun.file(coverAbsolutePath(coverPath))
          if (!(await file.exists()))
            return new Response('Not found', { status: 404 })
          return new Response(file, {
            headers: {
              'content-type': 'image/webp',
              'cache-control': 'private, max-age=3600',
            },
          })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      },
    },
  },
})
