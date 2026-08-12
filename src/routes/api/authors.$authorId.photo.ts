import '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { author } from '@/db/schema/catalog'
import { authorPhotoAbsolutePath } from '@/services/covers'

export const Route = createFileRoute('/api/authors/$authorId/photo')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [row] = await db
          .select({ photoPath: author.photoPath })
          .from(author)
          .where(eq(author.id, params.authorId))
        if (!row?.photoPath) return new Response('Not found', { status: 404 })
        const file = Bun.file(authorPhotoAbsolutePath(row.photoPath))
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
