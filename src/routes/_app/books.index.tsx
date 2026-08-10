import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { BatchBar } from '@/components/book/BatchBar'
import { BookRow } from '@/components/book/BookRow'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { plural } from '@/lib/plural'
import { listBooksFn } from '@/server/books'
import { listMyLibrariesFn } from '@/server/libraries'
import { listSeriesFn } from '@/server/series'
import { listMyTagsFn } from '@/server/tags'

const searchSchema = z.object({
  q: z.string().optional(),
  library: z.string().optional(),
  shelf: z.string().optional(),
  series: z.string().optional(),
  tag: z.string().optional(),
  status: z.enum(['in_library', 'wishlist', 'gifted', 'lost']).optional(),
})

export const Route = createFileRoute('/_app/books/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [result, libraries, series, tags] = await Promise.all([
      listBooksFn({
        data: {
          query: deps.q,
          libraryId: deps.library,
          shelfId: deps.shelf,
          seriesId: deps.series,
          tagId: deps.tag,
          status: deps.status,
        },
      }),
      listMyLibrariesFn(),
      listSeriesFn(),
      listMyTagsFn(),
    ])
    return { result, libraries, series, tags }
  },
  component: CatalogPage,
})

function CatalogPage() {
  const { result, libraries, series, tags } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [query, setQuery] = useState(search.q ?? '')
  const [selected, setSelected] = useState<Array<string>>([])

  // Живой поиск с debounce через search-параметры
  useEffect(() => {
    const timer = setTimeout(() => {
      if ((search.q ?? '') !== query) {
        void navigate({
          search: (s) => ({ ...s, q: query || undefined }),
          replace: true,
        })
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const setFilter = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }) })

  const selectCls =
    'h-9 max-w-44 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground'

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-3xl font-semibold">Каталог</h1>
        <span className="font-mono text-xs text-muted-foreground">
          найдено <b className="font-medium text-foreground">{result.total}</b>
        </span>
        <Button asChild className="ml-auto">
          <Link to="/books/new" search={{}}>
            + Добавить вручную
          </Link>
        </Button>
      </div>

      <Input
        className="mt-4 h-12 rounded-xl text-[16px]"
        placeholder="Название, автор или серия…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <select
          className={selectCls}
          value={search.library ?? ''}
          onChange={(e) =>
            setFilter({
              library: e.target.value || undefined,
              shelf: undefined,
            })
          }
          aria-label="Библиотека"
        >
          <option value="">Все библиотеки</option>
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {search.library && (
          <select
            className={selectCls}
            value={search.shelf ?? ''}
            onChange={(e) => setFilter({ shelf: e.target.value || undefined })}
            aria-label="Полка"
          >
            <option value="">Все полки</option>
            <option value="unsorted">Неразобранное</option>
          </select>
        )}
        <select
          className={selectCls}
          value={search.series ?? ''}
          onChange={(e) => setFilter({ series: e.target.value || undefined })}
          aria-label="Серия"
        >
          <option value="">Все серии</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={search.tag ?? ''}
          onChange={(e) => setFilter({ tag: e.target.value || undefined })}
          aria-label="Тэг"
        >
          <option value="">Все тэги</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={search.status ?? ''}
          onChange={(e) =>
            setFilter({
              status: (e.target.value || undefined) as typeof search.status,
            })
          }
          aria-label="Владение"
        >
          <option value="">Любой статус</option>
          <option value="in_library">В библиотеке</option>
          <option value="wishlist">Хочу</option>
          <option value="gifted">Подарены</option>
          <option value="lost">Потеряны</option>
        </select>
      </div>

      <div className="mt-5 grid gap-2">
        {result.rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {search.q
                ? 'Ничего не нашлось. Ищем по названию, авторам и серии — без учёта регистра.'
                : 'Каталог пока пуст. Добавьте первую книгу — вручную или сканером (скоро).'}
            </CardContent>
          </Card>
        ) : (
          result.rows.map((b) => (
            <BookRow
              key={b.id}
              book={b}
              place={
                b.libraryName
                  ? `${b.libraryName} · ${b.shelfName ?? 'Неразобранное'}`
                  : undefined
              }
              before={
                <input
                  type="checkbox"
                  aria-label="Выбрать"
                  className="size-[17px] accent-primary"
                  checked={selected.includes(b.id)}
                  onChange={() =>
                    setSelected((cur) =>
                      cur.includes(b.id)
                        ? cur.filter((x) => x !== b.id)
                        : [...cur, b.id],
                    )
                  }
                />
              }
            />
          ))
        )}
      </div>
      {result.total >= 500 && (
        <p className="mt-3 text-center text-[13px] text-muted-foreground">
          Показаны первые 500 {plural(500, 'книга', 'книги', 'книг')} — сузьте
          поиск.
        </p>
      )}
      <BatchBar
        selected={selected}
        onClear={() => setSelected([])}
        onDone={() => void router.invalidate()}
      />
    </div>
  )
}
