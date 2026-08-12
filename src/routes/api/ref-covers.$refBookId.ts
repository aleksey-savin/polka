import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { refBook } from '@/db/schema/catalog'
import { refCoverAbsolutePath } from '@/services/covers'

export const Route = createFileRoute('/api/ref-covers/$refBookId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [row] = await db
          .select({ coverPath: refBook.coverPath })
          .from(refBook)
          .where(eq(refBook.id, params.refBookId))
        if (!row?.coverPath) return new Response('Not found', { status: 404 })
        const file = Bun.file(refCoverAbsolutePath(row.coverPath))
        if (!(await file.exists()))
          return new Response('Not found', { status: 404 })
        return new Response(file, {
          headers: {
            'content-type': 'image/webp',
            'cache-control': 'public, max-age=604800',
          },
        })
      },
    },
  },
})
