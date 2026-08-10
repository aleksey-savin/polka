import '@tanstack/react-start' // подключает типы server.handlers для файловых роутов
import { createFileRoute } from '@tanstack/react-router'

import { auth } from '@/lib/auth'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
})
