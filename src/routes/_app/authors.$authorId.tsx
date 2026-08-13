import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { SectionLabel } from '@/components/layout/SectionLabel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { dateRu } from '@/lib/dates'
import { workTypeRu } from '@/lib/work-types'
import { plural } from '@/lib/plural'
import { getAuthorPageFn } from '@/server/authors'
import { createBookFn } from '@/server/books'
import { spineFor, textToneFor } from '@/services/spine'

export const Route = createFileRoute('/_app/authors/$authorId')({
  loader: ({ params }) =>
    getAuthorPageFn({ data: { authorId: params.authorId } }),
  component: AuthorPage,
})


/** Группы библиографии: порядок и заголовки во множественном числе. */
const TYPE_ORDER = [
  'роман',
  'роман-эпопея',
  'повесть',
  'рассказ',
  'микрорассказ',
  'сборник',
  'поэма',
  'пьеса',
  'киносценарий',
  'документальное',
]
const TYPE_PLURAL: Record<string, string> = {
  роман: 'Романы',
  'роман-эпопея': 'Романы-эпопеи',
  повесть: 'Повести',
  рассказ: 'Рассказы',
  микрорассказ: 'Микрорассказы',
  сборник: 'Сборники',
  поэма: 'Поэмы',
  пьеса: 'Пьесы',
  киносценарий: 'Киносценарии',
  документальное: 'Документальное',
}

function groupBibliography<T extends { workType: string | null }>(
  rows: Array<T>,
): Array<{ label: string; items: Array<T> }> {
  const groups = new Map<string, Array<T>>()
  for (const row of rows) {
    const key = (workTypeRu(row.workType) ?? 'другое').toLowerCase()
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return [...groups.entries()]
    .sort((a, b) => {
      const ia = a[0] === 'другое' ? 999 : TYPE_ORDER.indexOf(a[0])
      const ib = b[0] === 'другое' ? 999 : TYPE_ORDER.indexOf(b[0])
      return (ia === -1 ? 500 : ia) - (ib === -1 ? 500 : ib)
    })
    .map(([key, items]) => ({
      label: TYPE_PLURAL[key] ?? key.charAt(0).toUpperCase() + key.slice(1),
      items,
    }))
}

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
            {groupBibliography(author.bibliography).map((group) => (
              <div key={group.label} className="mb-3 last:mb-0">
                <h3 className="mt-3 mb-1 font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground uppercase first:mt-1">
                  {group.label}{' '}
                  <span className="text-stamp">· {group.items.length}</span>
                </h3>
                {group.items.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center gap-3 border-t py-2 first:border-t-0"
                  >
                    <Link
                      to="/works/$workId"
                      params={{ workId: w.id }}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {w.title}
                      </span>
                      {w.year && (
                        <span className="flex-none font-mono text-xs text-muted-foreground">
                          {w.year}
                        </span>
                      )}
                    </Link>
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
                        onClick={() => void addToWishlist(w.id, w.title)}
                      >
                        В Хочу
                      </Button>
                    )}
                    <span
                      aria-hidden
                      className="flex-none text-muted-foreground"
                    >
                      ›
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

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
