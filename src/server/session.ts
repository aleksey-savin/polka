import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { auth } from '@/lib/auth'
import { hasAnyUser } from '@/services/signupInvites'

export const getSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    return session
  },
)

export const getPublicConfig = createServerFn({ method: 'GET' }).handler(
  async () => {
    // Пустая система: первый пользователь регистрируется свободно.
    return { selfSignupOpen: !(await hasAnyUser()) }
  },
)
