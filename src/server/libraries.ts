import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  acceptInvite,
  createInvite,
  createLibrary,
  deleteLibrary,
  getLibraryOverview,
  listMyLibraries,
  removeMember,
  renameLibrary,
} from '@/services/libraries'
import { authMiddleware } from './middleware'

const byLibrary = z.object({ libraryId: z.string() })

export const listMyLibrariesFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => listMyLibraries(context.user.id))

export const getLibraryOverviewFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(byLibrary)
  .handler(({ context, data }) =>
    getLibraryOverview(context.user.id, data.libraryId),
  )

export const createLibraryFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().trim().min(1, 'Название обязательно'),
      description: z.string().optional(),
    }),
  )
  .handler(({ context, data }) => createLibrary(context.user.id, data))

export const renameLibraryFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byLibrary.extend({ name: z.string().trim().min(1) }))
  .handler(({ context, data }) =>
    renameLibrary(context.user.id, data.libraryId, data.name),
  )

export const deleteLibraryFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byLibrary)
  .handler(({ context, data }) =>
    deleteLibrary(context.user.id, data.libraryId),
  )

export const createInviteFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byLibrary)
  .handler(({ context, data }) => createInvite(context.user.id, data.libraryId))

export const acceptInviteFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ token: z.string().min(1) }))
  .handler(({ context, data }) => acceptInvite(context.user.id, data.token))

export const removeMemberFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(byLibrary.extend({ userId: z.string() }))
  .handler(({ context, data }) =>
    removeMember(context.user.id, data.libraryId, data.userId),
  )
