import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import {
  InviteDialog,
  NewLibraryDialog,
  NewShelfDialog,
} from '@/components/library/dialogs'
import { ShelfSection } from '@/components/shelf/ShelfSection'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { plural } from '@/lib/plural'
import { getLibraryOverviewFn, listMyLibrariesFn } from '@/server/libraries'
import { spineFor, textToneFor } from '@/services/spine'

export const Route = createFileRoute('/_app/libraries/')({
  validateSearch: z.object({ lib: z.string().optional() }),
  loaderDeps: ({ search }) => ({ lib: search.lib }),
  loader: async ({ deps }) => {
    const libraries = await listMyLibrariesFn()
    const selectedId =
      deps.lib && libraries.some((l) => l.id === deps.lib)
        ? deps.lib
        : libraries[0]?.id
    const overview = selectedId
      ? await getLibraryOverviewFn({ data: { libraryId: selectedId } })
      : null
    return { libraries, overview }
  },
  component: LibrariesPage,
})

function LibrariesPage() {
  const { libraries, overview } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const refresh = () => void router.invalidate()

  if (libraries.length === 0 || !overview) {
    return (
      <div className="mx-auto grid max-w-md gap-4 py-16 text-center">
        <h1 className="text-3xl font-semibold">Первая библиотека</h1>
        <p className="text-muted-foreground">
          Библиотека — это место, где стоят книги: «Дом», «Дача», «Кабинет».
          Внутри будут полки, а на полках — книги.
        </p>
        <div className="justify-self-center">
          <NewLibraryDialog
            onCreated={(id) => void navigate({ search: { lib: id } })}
          />
        </div>
      </div>
    )
  }

  const totalBooks =
    overview.shelves.reduce((sum, s) => sum + s.bookCount, 0) +
    overview.unsorted.count

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {libraries.map((l) => (
          <Link
            key={l.id}
            to="/libraries"
            search={{ lib: l.id }}
            className={
              l.id === overview.id
                ? 'border-b-[3px] border-foreground px-1 text-[24px] font-semibold tracking-tight'
                : 'px-1 text-[24px] font-semibold tracking-tight text-muted-foreground hover:text-foreground'
            }
          >
            {l.name}
          </Link>
        ))}
        <NewLibraryDialog
          onCreated={(id) => void navigate({ search: { lib: id } })}
        />
      </div>

      <p className="mt-1 text-[13.5px] text-muted-foreground">
        {overview.shelves.length}{' '}
        {plural(overview.shelves.length, 'полка', 'полки', 'полок')} ·{' '}
        {totalBooks} {plural(totalBooks, 'книга', 'книги', 'книг')} ·{' '}
        {overview.members.length === 1 ? (
          'только вы'
        ) : (
          <>
            ведёте вместе:{' '}
            <b>{overview.members.map((m) => m.name).join(' и ')}</b>
          </>
        )}{' '}
        {overview.role === 'owner' && (
          <InviteDialog libraryId={overview.id} libraryName={overview.name} />
        )}
      </p>

      {overview.shelves.map((s) => (
        <ShelfSection
          key={s.id}
          name={s.name}
          meta={
            <>
              <b className="font-medium text-foreground">{s.bookCount}</b>{' '}
              {plural(s.bookCount, 'книга', 'книги', 'книг')}
              {s.accentColor
                ? ' · цвет задан вручную'
                : s.tint.medianYear !== null &&
                  ` · медиана изданий ${s.tint.medianYear}`}
            </>
          }
          boardColor={s.accentColor ?? s.tint.color}
          books={s.books}
          emptyHint="Полка пустая — добавьте книгу или перенесите из «Неразобранного»."
          actions={
            <>
              <span />
              <Button
                asChild
                variant="ghost"
                className="text-accent-foreground"
              >
                <Link to="/shelves/$shelfId" params={{ shelfId: s.id }}>
                  Открыть полку →
                </Link>
              </Button>
            </>
          }
        />
      ))}

      <div className="mt-6">
        <NewShelfDialog libraryId={overview.id} onCreated={refresh} />
      </div>

      <section className="mt-10">
        <div className="mb-2 flex items-baseline gap-3.5">
          <h2 className="text-[21px] font-semibold">Неразобранное</h2>
          <span className="font-mono text-xs text-muted-foreground">
            <b className="font-medium text-foreground">
              {overview.unsorted.count}
            </b>{' '}
            {plural(
              overview.unsorted.count,
              'книга ждёт',
              'книги ждут',
              'книг ждут',
            )}{' '}
            своей полки
          </span>
        </div>
        {overview.unsorted.count === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Всё разобрано — стопка пуста. Новые книги со сканера падают сюда.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid justify-items-start gap-[3px] pl-3.5">
              {overview.unsorted.books.map((b, i) => {
                const look = spineFor(b.title, 260)
                const bg = b.coverColor ?? look.color
                const lightText = b.coverColor
                  ? textToneFor(b.coverColor) === 'light'
                  : look.dark
                return (
                  <Link
                    key={b.id}
                    to="/books/$bookId"
                    params={{ bookId: b.id }}
                    className="flex h-6 max-w-full min-w-[65%] items-center overflow-hidden rounded-[3px] px-3 font-display text-xs whitespace-nowrap"
                    style={{
                      background: bg,
                      color: lightText
                        ? 'rgba(255,255,255,.9)'
                        : 'rgba(35,43,56,.8)',
                      marginLeft: [0, 14, 6, 20, 10][i % 5],
                      boxShadow:
                        'inset -1px 0 0 rgba(35,43,56,.1), inset 1px 0 0 rgba(255,255,255,.35)',
                    }}
                  >
                    {b.authors ? `${b.authors.split(/[;,]/)[0] ?? ''} · ` : ''}
                    {b.title}
                  </Link>
                )
              })}
            </div>
            <div className="mt-3.5 flex items-center gap-2.5">
              <Button asChild variant="outline">
                <Link
                  to="/books"
                  search={{ library: overview.id, shelf: 'unsorted' }}
                >
                  Разобрать стопку
                </Link>
              </Button>
              {overview.unsorted.count > overview.unsorted.books.length && (
                <span className="text-[13px] text-muted-foreground">
                  …и ещё{' '}
                  {overview.unsorted.count - overview.unsorted.books.length}
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
