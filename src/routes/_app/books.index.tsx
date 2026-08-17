import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { SlidersHorizontal } from 'lucide-react'

import { BatchBar } from '@/components/book/BatchBar'
import { BookRow } from '@/components/book/BookRow'
import {
  CatalogFiltersSheet,
  READING_FILTER_LABEL,
  WHERE_LABEL,
} from '@/components/book/CatalogFiltersSheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { listAuthorsFn, listBooksFn } from '@/server/books'
import { listMyLibrariesFn } from '@/server/libraries'
import { listSeriesFn } from '@/server/series'
import { createBorrowRequestFn, searchFriendsBooksFn } from '@/server/shares'
import { listMyTagsFn } from '@/server/tags'
import type { AuthorFacetRow } from '@/services/authors'
import type { CatalogRow } from '@/services/books'
import type { LibrarySummary } from '@/services/libraries'
import type { FriendBookRow, SavedShareRow } from '@/services/savedShares'
import type { SeriesListItem } from '@/services/series'

interface MineData {
  result: { rows: Array<CatalogRow & { lentTo: string | null }>; total: number }
  libraries: Array<LibrarySummary>
  series: Array<SeriesListItem>
  tags: Array<{ id: string; name: string; bookCount: number }>
  authors: Array<AuthorFacetRow>
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
  status: z
    .enum(['in_library', 'wishlist', 'gifted', 'lost', 'lent', 'hidden'])
    .optional(),
  reading: z.enum(['unread', 'reading', 'read', 'abandoned']).optional(),
  author: z.string().optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
})

export const Route = createFileRoute('/_app/books/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (deps.scope === 'friends') {
      const friends = await searchFriendsBooksFn({ data: { query: deps.q } })
      return { kind: 'friends' as const, friends }
    }
    const [result, libraries, series, tags, authors] = await Promise.all([
      listBooksFn({
        data: {
          query: deps.q,
          libraryId: deps.library,
          shelfId: deps.shelf,
          seriesId: deps.series,
          tagId: deps.tag,
          status: deps.status,
          reading: deps.reading,
          author: deps.author,
          yearFrom: deps.yearFrom,
          yearTo: deps.yearTo,
        },
      }),
      listMyLibrariesFn(),
      listSeriesFn(),
      listMyTagsFn(),
      listAuthorsFn(),
    ])
    return { kind: 'mine' as const, result, libraries, series, tags, authors }
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
      </div>

      {selected.length === 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Input
            className="h-12 min-w-52 flex-1 rounded-xl text-[16px]"
            placeholder="Название или автор…"
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
                    ? 'rounded-full bg-foreground px-3.5 py-1.5 text-[13px] font-semibold text-background'
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
      )}

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
    'h-10 max-w-44 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground'
  const { result, libraries, series, tags } = data
  const navigate = Route.useNavigate()
  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    )

  const selectionMode = selected.length > 0
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Чипы применённых фильтров — снимаются без открытия шторки
  const activeChips: Array<{
    key: string
    label: string
    clear: Partial<z.infer<typeof searchSchema>>
  }> = []
  if (search.status)
    activeChips.push({
      key: 'status',
      label: WHERE_LABEL[search.status],
      clear: { status: undefined },
    })
  if (search.library)
    activeChips.push({
      key: 'library',
      label:
        libraries.find((l) => l.id === search.library)?.name ?? 'Библиотека',
      clear: { library: undefined, shelf: undefined },
    })
  if (search.shelf)
    activeChips.push({
      key: 'shelf',
      label: search.shelf === 'unsorted' ? 'Неразобранное' : 'Полка',
      clear: { shelf: undefined },
    })
  if (search.reading)
    activeChips.push({
      key: 'reading',
      label: READING_FILTER_LABEL[search.reading],
      clear: { reading: undefined },
    })
  if (search.author)
    activeChips.push({
      key: 'author',
      label: search.author,
      clear: { author: undefined },
    })
  if (search.yearFrom !== undefined || search.yearTo !== undefined)
    activeChips.push({
      key: 'years',
      label:
        search.yearFrom !== undefined && search.yearTo !== undefined
          ? `${search.yearFrom}–${search.yearTo}`
          : search.yearFrom !== undefined
            ? `после ${search.yearFrom}`
            : `до ${search.yearTo}`,
      clear: { yearFrom: undefined, yearTo: undefined },
    })
  if (search.series)
    activeChips.push({
      key: 'series',
      label: series.find((s) => s.id === search.series)?.name ?? 'Серия',
      clear: { series: undefined },
    })
  if (search.tag)
    activeChips.push({
      key: 'tag',
      label: `# ${tags.find((x) => x.id === search.tag)?.name ?? 'тэг'}`,
      clear: { tag: undefined },
    })

  // Дефолты для шторки перемещения — из выбранных книг, а не «первая по списку»
  const selectedRows = result.rows.filter((r) => selected.includes(r.id))
  const libIds = new Set(selectedRows.map((r) => r.libraryId))
  const onlyLibraryId =
    libIds.size === 1 ? ([...libIds][0] ?? undefined) : undefined
  const shelfIds = new Set(selectedRows.map((r) => r.shelfId))
  const onlyShelfId =
    onlyLibraryId && shelfIds.size === 1
      ? ([...shelfIds][0] ?? null)
      : undefined
  const contextLabel = onlyLibraryId
    ? `Из «${selectedRows[0]?.libraryName}${
        onlyShelfId !== undefined
          ? ` · ${selectedRows[0]?.shelfName ?? 'Неразобранное'}`
          : ''
      }»`
    : undefined
  return (
    <>
      {!selectionMode && (
        <>
          {/* Мобильный вид: кнопка «Фильтры» + чипы применённых */}
          <div className="mt-3 flex flex-wrap items-center gap-2 sm:hidden">
            <button
              type="button"
              className="inline-flex h-10 items-center gap-2 rounded-full border bg-card px-3.5 text-[13.5px] font-semibold"
              onClick={() => setFiltersOpen(true)}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Фильтры
              {activeChips.length > 0 && (
                <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1 font-mono text-[11px] text-primary-foreground">
                  {activeChips.length}
                </span>
              )}
            </button>
            {activeChips.map((c) => (
              <span
                key={c.key}
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-primary/35 bg-accent pr-1.5 pl-3 text-[13px] font-medium text-accent-foreground"
              >
                {c.label}
                <button
                  type="button"
                  aria-label={`Убрать фильтр ${c.label}`}
                  className="grid size-7 place-items-center rounded-full bg-primary/10 text-xs"
                  onClick={() => setFilter(c.clear)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>

          {/* Десктоп: компактная строка с теми же фильтрами */}
          <div className="mt-3 hidden flex-wrap gap-2 sm:flex">
            <select
              className={selectCls}
              value={search.status ?? ''}
              onChange={(e) =>
                setFilter({
                  status: (e.target.value || undefined) as typeof search.status,
                })
              }
              aria-label="Где книга"
            >
              <option value="">Где книга</option>
              {(
                Object.keys(WHERE_LABEL) as Array<
                  NonNullable<typeof search.status>
                >
              ).map((s) => (
                <option key={s} value={s}>
                  {WHERE_LABEL[s]}
                </option>
              ))}
            </select>
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
                onChange={(e) =>
                  setFilter({ shelf: e.target.value || undefined })
                }
                aria-label="Полка"
              >
                <option value="">Все полки</option>
                <option value="unsorted">Неразобранное</option>
              </select>
            )}
            <select
              className={selectCls}
              value={search.reading ?? ''}
              onChange={(e) =>
                setFilter({
                  reading: (e.target.value ||
                    undefined) as typeof search.reading,
                })
              }
              aria-label="Статус чтения"
            >
              <option value="">Статус чтения</option>
              {(
                Object.keys(READING_FILTER_LABEL) as Array<
                  NonNullable<typeof search.reading>
                >
              ).map((s) => (
                <option key={s} value={s}>
                  {READING_FILTER_LABEL[s]}
                </option>
              ))}
            </select>
            <Input
              className="h-10 w-36 rounded-lg text-[13px]"
              placeholder="Автор…"
              defaultValue={search.author ?? ''}
              onBlur={(e) =>
                setFilter({ author: e.target.value.trim() || undefined })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  setFilter({
                    author: e.currentTarget.value.trim() || undefined,
                  })
              }}
            />
            <select
              className={selectCls}
              value={search.series ?? ''}
              onChange={(e) =>
                setFilter({ series: e.target.value || undefined })
              }
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
              {tags.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>

          <CatalogFiltersSheet
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            query={search.q}
            value={{
              library: search.library,
              shelf: search.shelf,
              series: search.series,
              tag: search.tag,
              status: search.status,
              reading: search.reading,
              author: search.author,
              yearFrom: search.yearFrom,
              yearTo: search.yearTo,
            }}
            libraries={libraries}
            series={series}
            tags={tags}
            authors={data.authors}
            onApply={(v) =>
              setFilter({
                library: v.library,
                shelf: v.shelf,
                series: v.series,
                tag: v.tag,
                status: v.status,
                reading: v.reading,
                author: v.author,
                yearFrom: v.yearFrom,
                yearTo: v.yearTo,
              })
            }
          />
        </>
      )}

      <div className="mt-5 grid gap-2">
        {result.rows.length === 0 ? (
          <Card>
            <CardContent className="grid justify-items-center gap-3 py-12 text-center text-muted-foreground">
              {search.q
                ? 'Ничего не нашлось. Ищем по названию, авторам и серии — без учёта регистра.'
                : 'Каталог пока пуст. Добавьте первую книгу — сканером или вручную.'}
              {!search.q && (
                <Button asChild>
                  <Link to="/add">Добавить книгу</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          result.rows.map((b) => {
            const checked = selected.includes(b.id)
            return (
              <BookRow
                key={b.id}
                book={b}
                selected={checked}
                onPress={selectionMode ? () => toggle(b.id) : undefined}
                place={
                  b.libraryName
                    ? `${b.libraryName} · ${b.shelfName ?? 'Неразобранное'}`
                    : undefined
                }
                before={
                  selectionMode ? (
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
                  ) : (
                    <label className="-m-2.5 grid cursor-pointer place-items-center p-2.5">
                      <input
                        type="checkbox"
                        aria-label="Выбрать"
                        className="size-5 accent-primary"
                        checked={checked}
                        onChange={() => toggle(b.id)}
                      />
                    </label>
                  )
                }
              />
            )
          })
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
        defaultLibraryId={onlyLibraryId}
        defaultShelfId={onlyShelfId}
        contextLabel={contextLabel}
        onMoved={(target) => {
          const remaining = result.rows.length - selected.length
          setSelected([])
          if (remaining > 0) {
            // остались книги в текущем списке — продолжаем разбор
            onDone()
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
