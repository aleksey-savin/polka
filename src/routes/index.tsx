import { createFileRoute, redirect } from '@tanstack/react-router'

import { getSession } from '@/server/session'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const session = await getSession()
    throw redirect({ to: session ? '/libraries' : '/login' })
  },
  component: () => null,
})
