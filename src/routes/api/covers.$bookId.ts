import '@tanstack/react-start' // типы server.handlers
import { createFileRoute } from '@tanstack/react-router'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { auth } from '@/lib/auth'
import { requireBookAccess } from '@/services/books'
import { coverAbsolutePath } from '@/services/covers'

export const Route = createFileRoute('/api/covers/$bookId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const session = await auth.api.getSession({ headers: getRequestHeaders() })
        if (!session) return new Response('Unauthorized', { status: 401 })
        try {
          const row = await requireBookAccess(session.user.id, params.bookId)
          if (!row.coverPath) return new Response('Not found', { status: 404 })
          const file = Bun.file(coverAbsolutePath(row.coverPath))
          if (!(await file.exists())) return new Response('Not found', { status: 404 })
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
