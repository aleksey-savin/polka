import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { BatchBar } from '@/components/book/BatchBar'
import { BookRow } from '@/components/book/BookRow'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { plural } from '@/lib/plural'
import { listBooksFn } from '@/server/books'

const searchSchema = z.object({ lib: z.string().optional() })

export const Route = createFileRoute('/_app/unsorted')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    listBooksFn({ data: { libraryId: deps.lib, shelfId: 'unsorted' } }),
  component: UnsortedPage,
})

/** Страница разбора завала: весь список сразу в режиме выбора, без фильтров. */
function UnsortedPage() {
  const { rows } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [selected, setSelected] = useState<Array<string>>([])
  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    )

  // Дефолт для шторки — библиотека выбранных книг
  const selectedRows = rows.filter((r) => selected.includes(r.id))
  const libIds = new Set(selectedRows.map((r) => r.libraryId))
  const onlyLibraryId =
    libIds.size === 1 ? ([...libIds][0] ?? undefined) : undefined
  const contextLabel = onlyLibraryId
    ? `Из «${selectedRows[0]?.libraryName} · Неразобранное»`
    : undefined

  return (
    <div className="mx-auto max-w-[640px]">
      <h1 className="text-3xl font-semibold">Разбор книг</h1>
      {rows.length > 0 && (
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          <span className="font-mono text-[12.5px]">{rows.length}</span>{' '}
          {plural(rows.length, 'книга ждёт', 'книги ждут', 'книг ждут')} своей
          полки — тапайте по карточкам и раскладывайте.
        </p>
      )}

      {rows.length === 0 ? (
        <Card className="mt-5">
          <CardContent className="grid justify-items-center gap-3 py-10 text-center text-muted-foreground">
            <p>
              Всё разобрано — стопка пуста. Новые книги со сканера падают сюда.
            </p>
            <Button asChild variant="outline">
              <Link to="/libraries" search={{}}>
                В библиотеку
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-5 grid gap-2">
          {rows.map((b) => {
            const checked = selected.includes(b.id)
            return (
              <BookRow
                key={b.id}
                book={b}
                selected={checked}
                onPress={() => toggle(b.id)}
                place={b.libraryName}
                before={
                  <span
                    aria-hidden
                    className={`grid size-6 place-items-center rounded-[7px] border-[1.5px] text-[13px] ${
                      checked
                        ? 'border-primary bg-primary text-white'
                        : 'border-input bg-card text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                }
              />
            )
          })}
        </div>
      )}

      <BatchBar
        selected={selected}
        onClear={() => setSelected([])}
        defaultLibraryId={onlyLibraryId}
        defaultShelfId={onlyLibraryId ? null : undefined}
        contextLabel={contextLabel}
        onMoved={(target) => {
          const remaining = rows.length - selected.length
          setSelected([])
          if (remaining > 0) {
            void router.invalidate()
          } else if (target.shelfId) {
            void navigate({
              to: '/shelves/$shelfId',
              params: { shelfId: target.shelfId },
            })
          } else {
            void navigate({
              to: '/libraries',
              search: { lib: target.libraryId },
            })
          }
        }}
      />
    </div>
  )
}
