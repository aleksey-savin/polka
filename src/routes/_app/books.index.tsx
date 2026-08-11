import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { BatchBar } from '@/components/book/BatchBar'
import { BookRow } from '@/components/book/BookRow'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { listBooksFn } from '@/server/books'
import { listMyLibrariesFn } from '@/server/libraries'
import { listSeriesFn } from '@/server/series'
import { createBorrowRequestFn, searchFriendsBooksFn } from '@/server/shares'
import { listMyTagsFn } from '@/server/tags'
import type { CatalogRow } from '@/services/books'
import type { LibrarySummary } from '@/services/libraries'
import type { FriendBookRow, SavedShareRow } from '@/services/savedShares'
import type { SeriesListItem } from '@/services/series'

interface MineData {
  result: { rows: Array<CatalogRow & { lentTo: string | null }>; total: number }
  libraries: Array<LibrarySummary>
  series: Array<SeriesListItem>
  tags: Array<{ id: string; name: string; bookCount: number }>
}
interface FriendsData {
  rows: Array<FriendBookRow>
  shares: Array<SavedShareRow>
}

const searchSchema = z.object({
  q: z.string().optional(),
  scope: z.enum(['mine', 'friends']).optional(),
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
    if (deps.scope === 'friends') {
      const friends = await searchFriendsBooksFn({ data: { query: deps.q } })
      return { kind: 'friends' as const, friends }
    }
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
    return { kind: 'mine' as const, result, libraries, series, tags }
  },
  component: CatalogPage,
})

function CatalogPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [query, setQuery] = useState(search.q ?? '')
  const [selected, setSelected] = useState<Array<string>>([])

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

  const scope = search.scope ?? 'mine'
  const setFilter = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }) })

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-3xl font-semibold">Каталог</h1>
        <span className="font-mono text-xs text-muted-foreground">
          найдено{' '}
          <b className="font-medium text-foreground">
            {data.kind === 'mine'
              ? data.result.total
              : data.friends.rows.length}
          </b>
        </span>
        <Button asChild className="ml-auto">
          <Link to="/books/new" search={{}}>
            + Добавить вручную
          </Link>
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Input
          className="h-12 min-w-52 flex-1 rounded-xl text-[16px]"
          placeholder="Название, автор или серия…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <div className="flex rounded-full border bg-card p-1">
          {(
            [
              ['mine', 'Мои книги'],
              ['friends', 'У друзей'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={
                scope === key
                  ? 'rounded-full bg-foreground px-3.5 py-1.5 text-[13px] font-semibold text-white'
                  : 'rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-muted-foreground'
              }
              onClick={() =>
                setFilter({ scope: key === 'mine' ? undefined : key })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {data.kind === 'mine' ? (
        <MineResults
          data={data}
          search={search}
          setFilter={setFilter}
          selected={selected}
          setSelected={setSelected}
          onDone={() => void router.invalidate()}
        />
      ) : (
        <FriendsResults data={data.friends} query={search.q} />
      )}
    </div>
  )
}

function MineResults({
  data,
  search,
  setFilter,
  selected,
  setSelected,
  onDone,
}: {
  data: MineData
  search: z.infer<typeof searchSchema>
  setFilter: (patch: Partial<z.infer<typeof searchSchema>>) => void
  selected: Array<string>
  setSelected: React.Dispatch<React.SetStateAction<Array<string>>>
  onDone: () => void
}) {
  const selectCls =
    'h-9 max-w-44 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground'
  const { result, libraries, series, tags } = data
  return (
    <>
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
                : 'Каталог пока пуст. Добавьте первую книгу — сканером или вручную.'}
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
          Показаны первые 500 книг — сузьте поиск.
        </p>
      )}
      <BatchBar
        selected={selected}
        onClear={() => setSelected([])}
        onDone={onDone}
      />
    </>
  )
}

function FriendsResults({
  data,
  query,
}: {
  data: FriendsData
  query: string | undefined
}) {
  const { user } = Route.useRouteContext()
  const [askedId, setAskedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function ask(row: (typeof data.rows)[number]) {
    setError(null)
    try {
      await createBorrowRequestFn({
        data: { token: row.token, bookId: row.id, guestName: user.name },
      })
      setAskedId(row.id)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не получилось отправить заявку',
      )
    }
  }

  if (data.shares.length === 0) {
    return (
      <Card className="mt-5">
        <CardContent className="py-12 text-center text-muted-foreground">
          Сохранённых полок друзей пока нет — добавьте их в разделе{' '}
          <Link to="/friends" className="underline">
            «Друзья»
          </Link>
          .
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-5 grid gap-2">
        {data.rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {query
                ? 'У друзей такого не нашлось.'
                : 'На сохранённых полках пока пусто.'}
            </CardContent>
          </Card>
        ) : (
          data.rows.map((b) => (
            <BookRow
              key={b.id}
              book={b}
              place={`у ${b.ownerNames} · ${b.shareTitle}`}
              after={
                b.onLoan ? (
                  <span className="text-xs text-muted-foreground">
                    на руках — позже
                  </span>
                ) : askedId === b.id ? (
                  <span className="text-xs font-semibold text-accent-foreground">
                    Заявка отправлена ✓
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void ask(b)}
                  >
                    Хочу почитать
                  </Button>
                )
              }
            />
          ))
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        Ищем по:{' '}
        {data.shares.map((s) => (
          <b key={s.shareId} className="text-foreground">
            {s.ownerNames} · {s.title}
          </b>
        ))}
        <Link
          to="/friends"
          className="ml-auto font-semibold text-accent-foreground"
        >
          Управлять в «Друзьях» →
        </Link>
      </div>
    </>
  )
}
