import { createFileRoute, redirect } from '@tanstack/react-router'

import { defaultWishlistIdFn } from '@/server/lists'

/** Старый адрес виш-листа: теперь это список «Хочу почитать» (M17). */
export const Route = createFileRoute('/_app/wishlist')({
  loader: async () => {
    const listId = await defaultWishlistIdFn()
    throw redirect(
      listId
        ? { to: '/lists/$listId', params: { listId } }
        : { to: '/reading' },
    )
  },
})
