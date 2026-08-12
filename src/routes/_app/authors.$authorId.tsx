import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { SectionLabel } from '@/components/layout/SectionLabel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { dateRu } from '@/lib/dates'
import { plural } from '@/lib/plural'
import { getAuthorPageFn } from '@/server/authors'
import { createBookFn } from '@/server/books'
import {
  fetchWorkEditionsFn,
  getRefBookViewFn,
  getWorkViewFn,
} from '@/server/reference'
import { spineFor, textToneFor } from '@/services/spine'
import type { RefBookView, WorkView } from '@/services/reference'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export const Route = createFileRoute('/_app/authors/$authorId')({
  loader: ({ params }) =>
    getAuthorPageFn({ data: { authorId: params.authorId } }),
  component: AuthorPage,
})

const WORK_TYPE_RU: Record<string, string> = {
  shortstory: 'рассказ',
  story: 'повесть',
  novel: 'роман',
  collection: 'сборник',
  poem: 'поэма',
  piece: 'пьеса',
  microstory: 'микрорассказ',
  documental: 'документальное',
  other: '',
}
const workTypeRu = (t: string | null) =>
  t ? (WORK_TYPE_RU[t.toLowerCase()] ?? t) : null

const STATUS_NOTE: Record<string, string> = {
  wishlist: 'в списке «Хочу»',
  gifted: 'подарена',
  lost: 'потеряна',
}

function AuthorPage() {
  const author = Route.useLoaderData()
  const router = useRouter()
  const [bioOpen, setBioOpen] = useState(false)
  const [wishBusy, setWishBusy] = useState<string | null>(null)
  const [openWorkId, setOpenWorkId] = useState<string | null>(null)

  async function addToWishlist(workId: string, title: string) {
    setWishBusy(workId)
    try {
      await createBookFn({
        data: {
          title,
          authors: author.name,
          wishlist: true,
          refWorkId: workId,
        },
      })
      toast.success(`«${title}» — в списке «Хочу»`)
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setWishBusy(null)
    }
  }

  const years =
    author.birthYear || author.deathYear
      ? `${author.birthYear ?? '…'}–${author.deathYear ?? ''}`
      : null
  const initial = author.name.trim().charAt(0).toUpperCase()

  return (
    <div className="mx-auto max-w-[640px]">
      <p className="mb-2.5 text-[13px] text-muted-foreground">
        <Link to="/books" search={{}} className="hover:text-foreground">
          Каталог
        </Link>{' '}
        / Авторы
      </p>

      <div className="flex items-center gap-3.5">
        {author.photoPath ? (
          <img
            src={`/api/authors/${author.id}/photo`}
            alt={author.name}
            className="h-[72px] w-14 flex-none rounded-lg object-cover shadow-md"
          />
        ) : (
          <span
            aria-hidden
            className="grid h-[72px] w-14 flex-none place-items-center rounded-lg bg-secondary font-display text-2xl font-bold text-muted-foreground"
          >
            {initial}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold">
            {author.name}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            {years && <>{years} · </>}
            {author.country && <>{author.country} · </>}
            {author.myBooks.length}{' '}
            {plural(author.myBooks.length, 'книга', 'книги', 'книг')} на полках
          </p>
        </div>
      </div>

      {author.bio && (
        <>
          <p
            className={`mt-3 text-sm leading-relaxed whitespace-pre-line text-muted-foreground ${
              bioOpen ? '' : 'line-clamp-3'
            }`}
          >
            {author.bio}
          </p>
          {author.bio.length > 220 && (
            <button
              type="button"
              className="mt-1 text-[13px] font-medium text-accent-foreground"
              onClick={() => setBioOpen((v) => !v)}
            >
              {bioOpen ? 'свернуть' : 'ещё'}
            </button>
          )}
        </>
      )}

      {author.myBooks.length > 0 && (
        <section className="mt-6">
          <SectionLabel>
            На моих полках{' '}
            <span className="text-stamp">· {author.myBooks.length}</span>
          </SectionLabel>
          <div className="flex gap-4 overflow-x-auto pb-2.5">
            {author.myBooks.map((b) => {
              const look = spineFor(b.title, b.pages)
              const bg = b.coverColor ?? look.color
              const light = b.coverColor
                ? textToneFor(b.coverColor) === 'light'
                : look.dark
              return (
                <Link
                  key={b.id}
                  to="/books/$bookId"
                  params={{ bookId: b.id }}
                  className="w-[88px] flex-none"
                >
                  {b.coverPath ? (
                    <img
                      src={`/api/covers/${b.id}?v=${b.coverPath}`}
                      alt=""
                      className="aspect-[7/10] w-[88px] rounded-[4px] object-cover shadow-[inset_3px_0_0_rgba(255,255,255,.25),0_8px_16px_-8px_rgba(35,43,56,.5)]"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="grid aspect-[7/10] w-[88px] content-end overflow-hidden rounded-[4px] p-2 shadow-[0_8px_16px_-8px_rgba(35,43,56,.5)]"
                      style={{
                        background: `linear-gradient(160deg, ${bg}, color-mix(in oklab, ${bg} 70%, #232B38))`,
                        boxShadow: 'inset 3px 0 0 rgba(255,255,255,.3)',
                      }}
                    >
                      <span
                        className="font-display text-[10.5px] leading-tight font-bold"
                        style={{
                          color: light
                            ? 'rgba(255,255,255,.9)'
                            : 'rgba(35,43,56,.9)',
                        }}
                      >
                        {b.title}
                      </span>
                    </span>
                  )}
                  <p className="mt-2 line-clamp-2 text-[13px] leading-tight font-semibold">
                    {b.title}
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {STATUS_NOTE[b.status] ??
                      (b.libraryName
                        ? `${b.libraryName} · ${b.shelfName ?? 'Неразобранное'}`
                        : '')}
                  </p>
                </Link>
              )
            })}
          </div>
          <div
            aria-hidden
            className="-mt-1 mb-1 h-1 rounded-full"
            style={{
              background:
                'linear-gradient(to right, var(--patina-old), var(--patina-fresh))',
              boxShadow: '0 3px 6px -2px rgba(35,43,56,.22)',
            }}
          />
        </section>
      )}

      {author.bibliography.length > 0 && (
        <section className="mt-6">
          <SectionLabel
            trailing={
              author.refUpdatedAt ? (
                <span className="font-sans text-[11px] font-normal tracking-normal normal-case">
                  из каталога Полки · {dateRu(author.refUpdatedAt)}
                </span>
              ) : undefined
            }
          >
            Библиография{' '}
            <span className="text-stamp">· {author.bibliography.length}</span>
          </SectionLabel>
          <div>
            {author.bibliography.map((w) => (
              <div
                key={w.id}
                role="button"
                tabIndex={0}
                className="flex cursor-pointer items-center gap-3 border-t py-2 select-none first:border-t-0"
                onClick={() => setOpenWorkId(w.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setOpenWorkId(w.id)
                  }
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{w.title}</p>
                </div>
                {w.year && (
                  <span className="flex-none font-mono text-xs text-muted-foreground">
                    {w.year}
                  </span>
                )}
                {w.have ? (
                  <span className="flex-none rounded-[3px] border-[1.5px] border-primary px-1.5 font-mono text-[10px] tracking-[0.08em] text-accent-foreground uppercase">
                    есть
                  </span>
                ) : w.wished ? (
                  <span className="flex-none rounded-[3px] border-[1.5px] border-stamp px-1.5 font-mono text-[10px] tracking-[0.08em] text-stamp uppercase">
                    в хочу
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-none text-accent-foreground"
                    loading={wishBusy === w.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      void addToWishlist(w.id, w.title)
                    }}
                  >
                    В «Хочу»
                  </Button>
                )}
                <span aria-hidden className="flex-none text-muted-foreground">
                  ›
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <WorkSheet
        workId={openWorkId}
        onClose={() => setOpenWorkId(null)}
        onChanged={() => void router.invalidate()}
      />

      {author.series.length > 0 && (
        <section className="mt-6">
          <SectionLabel>Серии автора</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {author.series.map((s) => (
              <Link
                key={s.id}
                to="/books"
                search={{ series: s.id }}
                className="min-w-0"
              >
                <Badge
                  variant="outline"
                  className="max-w-full rounded-full border-stamp/30 px-3.5 py-2 text-[13.5px] text-stamp"
                >
                  <span className="truncate">{s.name}</span>
                  <span className="ml-1.5 font-mono text-[11.5px] text-muted-foreground">
                    {s.bookCount}
                  </span>
                </Badge>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/** Шторка произведения: аннотация и издания (ленивая загрузка в эталон). */
function WorkSheet({
  workId,
  onClose,
  onChanged,
}: {
  workId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [view, setView] = useState<WorkView | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openEditionId, setOpenEditionId] = useState<string | null>(null)

  useEffect(() => {
    if (!workId) {
      setView(null)
      return
    }
    const alive = { current: true }
    setLoading(true)
    void getWorkViewFn({ data: { workId } })
      .then(async (v) => {
        if (!alive.current) return
        setView(v)
        if (!v.editionsFetched) {
          const fetched = await fetchWorkEditionsFn({ data: { workId } })
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- флаг мутируется в cleanup эффекта
          if (alive.current) setView(fetched)
        }
      })
      .finally(() => {
        if (alive.current) setLoading(false)
      })
    return () => {
      alive.current = false
    }
  }, [workId])

  async function wish(edition?: WorkView['editions'][number]) {
    if (!view) return
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
      onClose()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={workId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="grid max-h-[86dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <div className="px-4 pt-2 pb-1">
          <DialogTitle className="text-[19px] font-semibold">
            {view?.title ?? '…'}
          </DialogTitle>
          {view && (
            <p className="font-mono text-[11.5px] text-muted-foreground">
              {[workTypeRu(view.workType), view.year, view.authorName]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          {view?.annotation && (
            <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed whitespace-pre-line text-muted-foreground">
              {view.annotation}
            </p>
          )}
        </div>

        <div className="overflow-y-auto px-4 py-2">
          {loading || (view && !view.editionsFetched) ? (
            <p className="flex items-center gap-2.5 py-4 text-sm text-muted-foreground">
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
              />
              Ищем издания…
            </p>
          ) : view && view.editions.length > 0 ? (
            view.editions.map((e) => {
              const look = spineFor(e.title, e.pages)
              return (
                <div
                  key={e.refBookId}
                  role="button"
                  tabIndex={0}
                  className="flex cursor-pointer items-center gap-3 border-t py-2.5 select-none first:border-t-0"
                  onClick={() => setOpenEditionId(e.refBookId)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault()
                      setOpenEditionId(e.refBookId)
                    }
                  }}
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
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold">
                      {e.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.publisher && `${e.publisher} · `}
                      {e.year && (
                        <span className="font-mono text-[11.5px]">
                          {e.year}
                        </span>
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
                    </p>
                  </div>
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
                      onClick={(ev) => {
                        ev.stopPropagation()
                        void wish(e)
                      }}
                    >
                      В «Хочу»
                    </Button>
                  )}
                  <span aria-hidden className="flex-none text-muted-foreground">
                    ›
                  </span>
                </div>
              )
            })
          ) : (
            <p className="py-4 text-sm text-muted-foreground">
              Изданий в каталоге Полки пока нет.
            </p>
          )}
        </div>

        <div className="border-t bg-card px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            className="flex min-h-[46px] w-full items-center justify-center rounded-xl border-[1.5px] border-dashed border-primary/45 text-sm font-semibold text-accent-foreground disabled:opacity-60"
            disabled={busyId === 'work'}
            onClick={() => void wish()}
          >
            В «Хочу» без выбора издания
          </button>
        </div>
      </DialogContent>
      <EditionSheet
        refBookId={openEditionId}
        authorName={view?.authorName ?? ''}
        workId={view?.id ?? null}
        onClose={() => setOpenEditionId(null)}
        onChanged={onChanged}
      />
    </Dialog>
  )
}

/** Шторка издания: обложка, полная мета, состав сборника, действие. */
function EditionSheet({
  refBookId,
  authorName,
  workId,
  onClose,
  onChanged,
}: {
  refBookId: string | null
  authorName: string
  workId: string | null
  onClose: () => void
  onChanged: () => void
}) {
  const [view, setView] = useState<RefBookView | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!refBookId) {
      setView(null)
      return
    }
    void getRefBookViewFn({ data: { refBookId } }).then(setView)
  }, [refBookId])

  async function wish() {
    if (!view) return
    setBusy(true)
    try {
      await createBookFn({
        data: {
          title: view.title,
          authors: authorName,
          publisher: view.publisher ?? undefined,
          year: view.year,
          pages: view.pages,
          isbn13: view.isbn13 ?? undefined,
          seriesName: view.seriesName ?? undefined,
          coverType: view.coverType,
          wishlist: true,
          refWorkId: workId,
        },
      })
      toast.success(`«${view.title}» — в списке «Хочу»`)
      onClose()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  const look = view ? spineFor(view.title, view.pages) : null

  return (
    <Dialog open={refBookId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="grid max-h-[86dvh] grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <div className="overflow-y-auto px-4 pt-2 pb-3">
          <div className="flex items-start gap-3.5">
            {view?.coverPath ? (
              <img
                src={`/api/ref-covers/${view.id}`}
                alt=""
                className="w-[96px] flex-none rounded-[4px] shadow-md"
              />
            ) : (
              <span
                aria-hidden
                className="grid aspect-[7/10] w-[96px] flex-none content-end rounded-[4px] p-2"
                style={{
                  background: view?.coverColor ?? look?.color ?? '#D9CDB8',
                  boxShadow: 'inset 3px 0 0 rgba(255,255,255,.3)',
                }}
              >
                <span className="font-display text-[11px] leading-tight font-bold text-white/90">
                  {view?.title}
                </span>
              </span>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[17px] leading-snug font-semibold">
                {view?.title ?? '…'}
              </DialogTitle>
              {view?.seriesName && (
                <p className="mt-1 truncate text-[12.5px] text-stamp">
                  {view.seriesName}
                </p>
              )}
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                {view?.publisher && (
                  <>
                    {view.publisher}
                    <br />
                  </>
                )}
                {view?.year && (
                  <span className="font-mono text-xs">{view.year}</span>
                )}
                {view?.pages && (
                  <>
                    {' · '}
                    <span className="font-mono text-xs">{view.pages}</span> с.
                  </>
                )}
                {view?.coverType && (
                  <> · {view.coverType === 'hard' ? 'твёрдый' : 'мягкая'}</>
                )}
              </p>
              {view?.isbn13 && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {view.isbn13}
                </p>
              )}
            </div>
          </div>

          {view?.annotation && (
            <p className="mt-3 text-[13.5px] leading-relaxed whitespace-pre-line text-muted-foreground">
              {view.annotation}
            </p>
          )}

          {view && view.works.length > 1 && (
            <p className="mt-3 text-[13px] text-muted-foreground">
              <b className="font-medium text-foreground">Содержит:</b>{' '}
              {view.works.map((w) => w.title).join(' · ')}
            </p>
          )}
        </div>

        <div className="border-t bg-card px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {view?.myBookId ? (
            <Button asChild className="h-12 w-full" variant="outline">
              <Link to="/books/$bookId" params={{ bookId: view.myBookId }}>
                Эта книга у вас есть — открыть
              </Link>
            </Button>
          ) : (
            <Button
              className="h-12 w-full"
              loading={busy}
              disabled={!view}
              onClick={() => void wish()}
            >
              В «Хочу» это издание
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
