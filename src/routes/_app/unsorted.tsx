import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { BatchBar } from '@/components/book/BatchBar'
import { BookRow } from '@/components/book/BookRow'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { plural } from '@/lib/plural'
import { listBooksFn } from '@/server/books'
import { countUnrecognizedFn } from '@/server/unrecognized'

const searchSchema = z.object({ lib: z.string().optional() })

export const Route = createFileRoute('/_app/unsorted')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [books, unrecognized] = await Promise.all([
      listBooksFn({ data: { libraryId: deps.lib, shelfId: 'unsorted' } }),
      countUnrecognizedFn(),
    ])
    return { ...books, unrecognized }
  },
  component: UnsortedPage,
})

/** Страница разбора завала: весь список сразу в режиме выбора, без фильтров. */
function UnsortedPage() {
  const { rows, unrecognized } = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [selected, setSelected] = useState<Array<string>>([])
  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    )

  // Дефолт для шторки — библиотека выбранных книг
  const selecting = selected.length > 0
  const selectedRows = rows.filter((r) => selected.includes(r.id))
  const libIds = new Set(
    selectedRows
      .map((r) => r.libraryId)
      .filter((x): x is string => typeof x === 'string'),
  )
  const onlyLibraryId = libIds.size === 1 ? [...libIds][0] : undefined
  const contextLabel = onlyLibraryId
    ? `Из «${selectedRows[0]?.libraryName} · Неразобранное»`
    : undefined

  return (
    <div className="mx-auto max-w-[640px]">
      <h1 className="text-3xl font-semibold">Разбор книг</h1>
      {rows.length > 0 && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <p className="text-[13.5px] text-muted-foreground">
            <span className="font-mono text-[12.5px]">{rows.length}</span>{' '}
            {plural(rows.length, 'книга ждёт', 'книги ждут', 'книг ждут')} своей
            полки — тапайте по обложке, чтобы открыть, по галочке — чтобы
            выбрать.
          </p>
          {selected.length < rows.length && (
            <button
              type="button"
              className="text-[13px] font-semibold text-accent-foreground"
              onClick={() => setSelected(rows.map((r) => r.id))}
            >
              Выбрать все
            </button>
          )}
          {selecting && (
            <button
              type="button"
              className="text-[13px] font-semibold text-muted-foreground"
              onClick={() => setSelected([])}
            >
              Снять выбор
              {selected.length < rows.length && (
                <span className="font-mono"> · {selected.length}</span>
              )}
            </button>
          )}
        </div>
      )}

      {unrecognized > 0 && (
        <Link
          to="/unrecognized"
          search={{ from: 'unsorted', lib: search.lib }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-[12.5px] font-semibold text-destructive"
        >
          Не распознано{' '}
          <span className="font-mono text-[12px]">· {unrecognized}</span>
        </Link>
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
                // пока ничего не выбрано, карточка — ссылка в книгу;
                // как только выбор начат, вся карточка переключает отметку
                onPress={selecting ? () => toggle(b.id) : undefined}
                place={b.libraryName}
                before={
                  <button
                    type="button"
                    aria-label={
                      checked ? `Снять «${b.title}»` : `Выбрать «${b.title}»`
                    }
                    aria-pressed={checked}
                    className="-m-2 p-2"
                    onClick={(e) => {
                      // в режиме выбора клик обрабатывает карточка целиком
                      if (selecting) return
                      e.preventDefault()
                      e.stopPropagation()
                      toggle(b.id)
                    }}
                  >
                    <span
                      aria-hidden
                      className={`grid size-6 place-items-center rounded-[7px] border-[1.5px] text-[13px] ${
                        checked
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-card text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                  </button>
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
