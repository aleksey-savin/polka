import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'

import { BookRow } from '@/components/book/BookRow'
import { MoveDialog } from '@/components/book/MoveDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { plural } from '@/lib/plural'
import { listBooksFn } from '@/server/books'

export const Route = createFileRoute('/_app/wishlist')({
  loader: () => listBooksFn({ data: { status: 'wishlist' } }),
  component: WishlistPage,
})

function WishlistPage() {
  const { rows } = Route.useLoaderData()
  const router = useRouter()
  const [buyingId, setBuyingId] = useState<string | null>(null)

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-3xl font-semibold">Хочу</h1>
        {rows.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground">
            <b className="font-medium text-foreground">{rows.length}</b>{' '}
            {plural(rows.length, 'книга', 'книги', 'книг')} в списке
          </span>
        )}
        <Button asChild className="ml-auto" variant="outline">
          <Link to="/books/new" search={{}}>
            + В список «Хочу»
          </Link>
        </Button>
      </div>

      <div className="mt-5 grid gap-2">
        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Список пуст. Добавляйте сюда книги, которых ещё нет дома, — при
              добавлении отметьте «Хочу». Купите — переедет на полку одной
              кнопкой.
            </CardContent>
          </Card>
        ) : (
          rows.map((b) => (
            <BookRow
              key={b.id}
              book={{ ...b, status: undefined }}
              after={
                <Button size="sm" onClick={() => setBuyingId(b.id)}>
                  Купил — на полку
                </Button>
              }
            />
          ))
        )}
      </div>

      <MoveDialog
        open={buyingId !== null}
        onOpenChange={(open) => {
          if (!open) setBuyingId(null)
        }}
        bookIds={buyingId ? [buyingId] : []}
        onMoved={() => {
          setBuyingId(null)
          void router.invalidate()
        }}
      />
    </div>
  )
}
