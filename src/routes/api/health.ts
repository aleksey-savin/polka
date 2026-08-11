import '@tanstack/react-start' // типы server.handlers
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { ok: true },
          { headers: { 'cache-control': 'no-store' } },
        ),
    },
  },
})
