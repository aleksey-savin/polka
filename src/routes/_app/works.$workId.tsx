import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { SectionLabel } from '@/components/layout/SectionLabel'
import { Button } from '@/components/ui/button'
import { createBookFn } from '@/server/books'
import { fetchWorkEditionsFn, getWorkViewFn } from '@/server/reference'
import { spineFor } from '@/services/spine'
import { workTypeRu } from '@/lib/work-types'
import type { WorkView } from '@/services/reference'

/** Страница произведения: описание и издания эталона. Раньше была шторкой —
    шторка над шторкой запрещена, вглубь ходим страницами. */
export const Route = createFileRoute('/_app/works/$workId')({
  loader: ({ params }) => getWorkViewFn({ data: { workId: params.workId } }),
  component: WorkPage,
})

function WorkPage() {
  const loaded = Route.useLoaderData()
  const router = useRouter()
  const [view, setView] = useState<WorkView>(loaded)
  const [fetching, setFetching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // издания подтягиваются лениво при первом заходе
  useEffect(() => {
    setView(loaded)
    if (loaded.editionsFetched) return
    const alive = { current: true }
    setFetching(true)
    void fetchWorkEditionsFn({ data: { workId: loaded.id } })
      .then((fetched) => {
        if (alive.current) setView(fetched)
      })
      .finally(() => {
        if (alive.current) setFetching(false)
      })
    return () => {
      alive.current = false
    }
  }, [loaded])

  async function wish(edition?: WorkView['editions'][number]) {
    setBusyId(edition?.refBookId ?? 'work')
    try {
      await createBookFn({
        data: edition
          ? {
              title: edition.title,
              authors: view.authorName,
              publisher: edition.publisher ?? undefined,
              year: edition.year,
              pages: edition.pages,
              isbn13: edition.isbn13 ?? undefined,
              wishlist: true,
              refWorkId: view.id,
            }
          : {
              title: view.title,
              authors: view.authorName,
              wishlist: true,
              refWorkId: view.id,
            },
      })
      toast.success(`«${edition?.title ?? view.title}» — в списке «Хочу»`)
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  const meta = [workTypeRu(view.workType), view.year, view.authorName]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <p className="mb-4 truncate text-[13px] text-muted-foreground">
        <Link to="/books" search={{}} className="hover:text-foreground">
          Каталог
        </Link>{' '}
        / {view.authorName || 'Произведение'}
      </p>

      <h1 className="text-[25px] leading-[1.16] font-semibold tracking-[-0.015em]">
        {view.title}
      </h1>
      <p className="mt-1 font-mono text-[12px] text-muted-foreground">{meta}</p>

      {view.annotation && (
        <p className="mt-3.5 max-w-[60ch] text-[15px] leading-[1.65] whitespace-pre-line text-muted-foreground">
          {view.annotation}
        </p>
      )}

      <div className="mt-6">
        <Button
          variant="outline"
          className="h-11 w-full"
          loading={busyId === 'work'}
          onClick={() => void wish()}
        >
          В «Хочу» без выбора издания
        </Button>
      </div>

      <section className="mt-7">
        <SectionLabel>
          Издания{' '}
          {view.editions.length > 0 && (
            <span className="text-stamp">· {view.editions.length}</span>
          )}
        </SectionLabel>
        {fetching ? (
          <p className="flex items-center gap-2.5 py-4 text-sm text-muted-foreground">
            <span
              aria-hidden
              className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
            />
            Ищем издания…
          </p>
        ) : view.editions.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Изданий в каталоге Полки пока нет.
          </p>
        ) : (
          view.editions.map((e) => {
            const look = spineFor(e.title, e.pages)
            return (
              <div
                key={e.refBookId}
                className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
              >
                <Link
                  to="/editions/$refBookId"
                  params={{ refBookId: e.refBookId }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  {e.coverPath ? (
                    <img
                      src={`/api/ref-covers/${e.refBookId}`}
                      alt=""
                      loading="lazy"
                      className="h-14 w-[38px] flex-none rounded-[3px] object-cover shadow-sm"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="h-14 w-[24px] flex-none rounded-[3px]"
                      style={{
                        background: e.coverColor ?? look.color,
                        boxShadow: 'inset 1.5px 0 0 rgba(255,255,255,.35)',
                      }}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">
                      {e.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {e.publisher && `${e.publisher} · `}
                      {e.year && (
                        <span className="font-mono text-[11.5px]">{e.year}</span>
                      )}
                      {e.pages && (
                        <>
                          {' · '}
                          <span className="font-mono text-[11.5px]">
                            {e.pages}
                          </span>{' '}
                          с.
                        </>
                      )}
                    </span>
                  </span>
                </Link>
                {e.have ? (
                  <span className="flex-none rounded-[3px] border-[1.5px] border-primary px-1.5 font-mono text-[10px] tracking-[0.08em] text-accent-foreground uppercase">
                    есть
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-none text-accent-foreground"
                    loading={busyId === e.refBookId}
                    onClick={() => void wish(e)}
                  >
                    В Хочу
                  </Button>
                )}
                <span aria-hidden className="flex-none text-muted-foreground">
                  ›
                </span>
              </div>
            )
          })
        )}
      </section>
    </div>
  )
}
