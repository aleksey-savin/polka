import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { plural } from '@/lib/plural'
import { listBooksFn } from '@/server/books'
import { getLibraryOverviewFn } from '@/server/libraries'
import { normalizeForSearch } from '@/services/search'
import type { AuthorFacetRow } from '@/services/authors'

export interface CatalogFilterValues {
  library?: string
  shelf?: string
  series?: string
  tag?: string
  status?: 'in_library' | 'wishlist' | 'gifted' | 'lost' | 'lent' | 'hidden'
  reading?: 'unread' | 'reading' | 'read' | 'abandoned'
  author?: string
  yearFrom?: number
  yearTo?: number
}

export const WHERE_LABEL: Record<
  NonNullable<CatalogFilterValues['status']>,
  string
> = {
  in_library: 'Дома',
  lent: 'На руках',
  wishlist: 'В списке «Хочу»',
  gifted: 'Подарены',
  lost: 'Потеряны',
  hidden: 'Скрытые',
}

export const READING_FILTER_LABEL: Record<
  NonNullable<CatalogFilterValues['reading']>,
  string
> = {
  unread: 'Не читал',
  reading: 'Читаю',
  read: 'Прочитал',
  abandoned: 'Бросил',
}

const YEAR_PRESETS: Array<{
  label: string
  from: number | undefined
  to: number | undefined
}> = [
  { label: 'до 1960', from: undefined, to: 1960 },
  { label: '1960–1990', from: 1960, to: 1990 },
  { label: '1990–2010', from: 1990, to: 2010 },
  { label: 'после 2010', from: 2010, to: undefined },
]

const TOP = 8

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={`min-h-10 rounded-full border px-3.5 py-2 text-[13.5px] font-medium ${
        on ? 'border-primary/45 bg-accent text-accent-foreground' : 'bg-card'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function FacetCount({ n }: { n: number }) {
  return (
    <span className="ml-1.5 font-mono text-[11.5px] text-muted-foreground">
      {n}
    </span>
  )
}

function FilterLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 flex items-baseline gap-2.5 font-mono text-[10.5px] font-medium tracking-[0.11em] text-muted-foreground uppercase">
      {children}
      <span aria-hidden className="h-px flex-1 -translate-y-[3px] bg-border" />
    </h3>
  )
}

/**
 * Шторка фильтров каталога (гайдлайн, раздел «Фильтры»): чипы с топом
 * частых значений, саджест для длинных списков, живой счётчик в CTA.
 */
export function CatalogFiltersSheet({
  open,
  onOpenChange,
  value,
  query,
  libraries,
  series,
  tags,
  authors,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: CatalogFilterValues
  /** Текущий поисковый запрос — учитывается в счётчике. */
  query?: string
  libraries: Array<{ id: string; name: string }>
  series: Array<{ id: string; name: string; bookCount: number }>
  tags: Array<{ id: string; name: string; bookCount: number }>
  authors: Array<AuthorFacetRow>
  onApply: (value: CatalogFilterValues) => void
}) {
  const [draft, setDraft] = useState<CatalogFilterValues>(value)
  const [shelves, setShelves] = useState<Array<{ id: string; name: string }>>(
    [],
  )
  const [authorQuery, setAuthorQuery] = useState('')
  const [seriesQuery, setSeriesQuery] = useState('')
  const [allTags, setAllTags] = useState(false)
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(value)
    setAuthorQuery('')
    setSeriesQuery('')
    setAllTags(false)
  }, [open, value])

  useEffect(() => {
    if (!draft.library) {
      setShelves([])
      return
    }
    void getLibraryOverviewFn({ data: { libraryId: draft.library } }).then(
      (o) => setShelves(o.shelves.map((s) => ({ id: s.id, name: s.name }))),
    )
  }, [draft.library])

  // живой счётчик результата
  useEffect(() => {
    if (!open) return
    setCount(null)
    const timer = setTimeout(() => {
      void listBooksFn({
        data: {
          query,
          libraryId: draft.library,
          shelfId: draft.shelf,
          seriesId: draft.series,
          tagId: draft.tag,
          status: draft.status,
          reading: draft.reading,
          author: draft.author,
          yearFrom: draft.yearFrom,
          yearTo: draft.yearTo,
        },
      }).then((r) => setCount(r.total))
    }, 350)
    return () => clearTimeout(timer)
  }, [open, draft, query])

  const set = (patch: Partial<CatalogFilterValues>) =>
    setDraft((d) => ({ ...d, ...patch }))

  const authorSuggest = useMemo(() => {
    const q = normalizeForSearch(authorQuery.trim())
    if (!q) return []
    return authors
      .filter((a) => normalizeForSearch(a.name).includes(q))
      .slice(0, 6)
  }, [authors, authorQuery])

  const topAuthors = useMemo(() => {
    const top = authors.slice(0, TOP)
    if (draft.author && !top.some((a) => a.name === draft.author)) {
      const chosen = authors.find((a) => a.name === draft.author)
      return [
        chosen ?? { name: draft.author, count: 0 },
        ...top.slice(0, TOP - 1),
      ]
    }
    return top
  }, [authors, draft.author])

  const seriesShown = useMemo(() => {
    const q = normalizeForSearch(seriesQuery.trim())
    const list = q
      ? series.filter((s) => normalizeForSearch(s.name).includes(q))
      : series
    return list.slice(0, TOP)
  }, [series, seriesQuery])

  const tagsShown = allTags ? tags : tags.slice(0, 10)

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        aria-describedby={undefined}
        className="max-h-[88dvh] gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <div className="flex items-baseline justify-between px-4 pt-3.5 pb-1">
          <DrawerTitle className="text-[17px] font-semibold">
            Фильтры
          </DrawerTitle>
          <button
            type="button"
            className="p-1 text-[13.5px] font-medium text-muted-foreground"
            onClick={() => setDraft({})}
          >
            Сбросить
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-2">
          <section>
            <FilterLabel>Где книга</FilterLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                on={draft.status === undefined}
                onClick={() => set({ status: undefined })}
              >
                Неважно
              </Chip>
              {(
                Object.keys(WHERE_LABEL) as Array<
                  NonNullable<CatalogFilterValues['status']>
                >
              ).map((s) => (
                <Chip
                  key={s}
                  on={draft.status === s}
                  onClick={() =>
                    set({ status: draft.status === s ? undefined : s })
                  }
                >
                  {WHERE_LABEL[s]}
                </Chip>
              ))}
            </div>
          </section>

          <section>
            <FilterLabel>Библиотека и полка</FilterLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                on={!draft.library}
                onClick={() => set({ library: undefined, shelf: undefined })}
              >
                Все
              </Chip>
              {libraries.map((l) => (
                <Chip
                  key={l.id}
                  on={draft.library === l.id}
                  onClick={() =>
                    set({
                      library: draft.library === l.id ? undefined : l.id,
                      shelf: undefined,
                    })
                  }
                >
                  {l.name}
                </Chip>
              ))}
            </div>
            {draft.library && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Chip
                  on={draft.shelf === 'unsorted'}
                  onClick={() =>
                    set({
                      shelf:
                        draft.shelf === 'unsorted' ? undefined : 'unsorted',
                    })
                  }
                >
                  Неразобранное
                </Chip>
                {shelves.map((s) => (
                  <Chip
                    key={s.id}
                    on={draft.shelf === s.id}
                    onClick={() =>
                      set({ shelf: draft.shelf === s.id ? undefined : s.id })
                    }
                  >
                    {s.name}
                  </Chip>
                ))}
              </div>
            )}
          </section>

          <section>
            <FilterLabel>Статус чтения</FilterLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip
                on={draft.reading === undefined}
                onClick={() => set({ reading: undefined })}
              >
                Любой
              </Chip>
              {(
                Object.keys(READING_FILTER_LABEL) as Array<
                  NonNullable<CatalogFilterValues['reading']>
                >
              ).map((s) => (
                <Chip
                  key={s}
                  on={draft.reading === s}
                  onClick={() =>
                    set({ reading: draft.reading === s ? undefined : s })
                  }
                >
                  {READING_FILTER_LABEL[s]}
                </Chip>
              ))}
            </div>
          </section>

          <section>
            <FilterLabel>Автор</FilterLabel>
            <Input
              className="mb-2 h-11 rounded-xl text-[16px]"
              placeholder="Фамилия или имя…"
              value={authorQuery}
              onChange={(e) => setAuthorQuery(e.target.value)}
            />
            {authorSuggest.length > 0 && (
              <div className="mb-2 overflow-hidden rounded-xl border">
                {authorSuggest.map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    className="flex min-h-11 w-full items-baseline border-t px-3 py-2 text-left text-[15px] first:border-t-0"
                    onClick={() => {
                      set({ author: a.name })
                      setAuthorQuery('')
                    }}
                  >
                    {a.name}
                    <FacetCount n={a.count} />
                  </button>
                ))}
              </div>
            )}
            {topAuthors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {topAuthors.map((a) => (
                  <Chip
                    key={a.name}
                    on={draft.author === a.name}
                    onClick={() =>
                      set({
                        author: draft.author === a.name ? undefined : a.name,
                      })
                    }
                  >
                    {a.name}
                    {a.count > 0 && <FacetCount n={a.count} />}
                  </Chip>
                ))}
              </div>
            )}
          </section>

          <section>
            <FilterLabel>Период издания</FilterLabel>
            <div className="mb-2 flex items-center gap-2">
              <Input
                className="h-11 w-24 rounded-xl font-mono text-[16px]"
                inputMode="numeric"
                placeholder="от"
                value={draft.yearFrom?.toString() ?? ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                  set({ yearFrom: v ? Number(v) : undefined })
                }}
              />
              <span className="text-muted-foreground">—</span>
              <Input
                className="h-11 w-24 rounded-xl font-mono text-[16px]"
                inputMode="numeric"
                placeholder="до"
                value={draft.yearTo?.toString() ?? ''}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                  set({ yearTo: v ? Number(v) : undefined })
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {YEAR_PRESETS.map((p) => {
                const on = draft.yearFrom === p.from && draft.yearTo === p.to
                return (
                  <Chip
                    key={p.label}
                    on={on}
                    onClick={() =>
                      set(
                        on
                          ? { yearFrom: undefined, yearTo: undefined }
                          : { yearFrom: p.from, yearTo: p.to },
                      )
                    }
                  >
                    {p.label}
                  </Chip>
                )
              })}
            </div>
          </section>

          {series.length > 0 && (
            <section>
              <FilterLabel>Серия</FilterLabel>
              {series.length > TOP && (
                <Input
                  className="mb-2 h-11 rounded-xl text-[16px]"
                  placeholder="Найти серию…"
                  value={seriesQuery}
                  onChange={(e) => setSeriesQuery(e.target.value)}
                />
              )}
              <div className="flex flex-wrap gap-1.5">
                {seriesShown.map((s) => (
                  <Chip
                    key={s.id}
                    on={draft.series === s.id}
                    onClick={() =>
                      set({
                        series: draft.series === s.id ? undefined : s.id,
                      })
                    }
                  >
                    {s.name}
                    <FacetCount n={s.bookCount} />
                  </Chip>
                ))}
              </div>
            </section>
          )}

          {tags.length > 0 && (
            <section>
              <FilterLabel>Тэги и жанры</FilterLabel>
              <div className="flex flex-wrap gap-1.5">
                {tagsShown.map((t) => (
                  <Chip
                    key={t.id}
                    on={draft.tag === t.id}
                    onClick={() =>
                      set({ tag: draft.tag === t.id ? undefined : t.id })
                    }
                  >
                    # {t.name}
                    <FacetCount n={t.bookCount} />
                  </Chip>
                ))}
                {!allTags && tags.length > 10 && (
                  <Chip on={false} onClick={() => setAllTags(true)}>
                    ещё {tags.length - 10}…
                  </Chip>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="border-t bg-card px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            className="h-12 w-full"
            onClick={() => {
              onApply(draft)
              onOpenChange(false)
            }}
          >
            {count === null
              ? 'Показать…'
              : `Показать ${count} ${plural(count, 'книгу', 'книги', 'книг')}`}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
