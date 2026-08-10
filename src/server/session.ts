import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { auth } from '@/lib/auth'
import { env } from '@/lib/env'

export const getSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    return session
  },
)

export const getPublicConfig = createServerFn({ method: 'GET' }).handler(
  async () => {
    return { registrationOpen: env.REGISTRATION_OPEN }
  },
)
