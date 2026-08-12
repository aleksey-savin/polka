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
import { getLibrariesHomeFn } from '@/server/libraries'
import { spineFor, textToneFor } from '@/services/spine'

export const Route = createFileRoute('/_app/libraries/')({
  validateSearch: z.object({ lib: z.string().optional() }),
  loaderDeps: ({ search }) => ({ lib: search.lib }),
  loader: ({ deps }) => getLibrariesHomeFn({ data: { lib: deps.lib } }),
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
      {/* Библиотеки — чипы-пилюли, как сегмент скоупов в каталоге */}
      <div className="flex flex-wrap items-center gap-2">
        {libraries.map((l) => (
          <Link
            key={l.id}
            to="/libraries"
            search={{ lib: l.id }}
            className={
              l.id === overview.id
                ? 'min-h-10 rounded-full border border-foreground bg-foreground px-4 py-2 text-[14.5px] font-semibold text-white'
                : 'min-h-10 rounded-full border bg-card px-4 py-2 text-[14.5px] font-semibold text-muted-foreground hover:text-foreground'
            }
          >
            {l.name}
          </Link>
        ))}
        <NewLibraryDialog
          onCreated={(id) => void navigate({ search: { lib: id } })}
          trigger={
            <button
              type="button"
              aria-label="Новая библиотека"
              className="grid size-10 place-items-center rounded-full border-[1.5px] border-dashed border-primary/50 text-[17px] text-accent-foreground"
            >
              +
            </button>
          }
        />
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <span className="text-[13.5px] text-muted-foreground">
          <span className="font-mono text-[12.5px] font-medium text-foreground">
            {overview.shelves.length}
          </span>{' '}
          {plural(overview.shelves.length, 'полка', 'полки', 'полок')} ·{' '}
          <span className="font-mono text-[12.5px] font-medium text-foreground">
            {totalBooks}
          </span>{' '}
          {plural(totalBooks, 'книга', 'книги', 'книг')}
        </span>
        <span className="ml-auto flex items-center" aria-label="Участники">
          {overview.members.map((m, i) => (
            <span
              key={m.id}
              title={m.name}
              className={`grid size-[30px] place-items-center rounded-full border-2 border-background text-xs font-semibold text-white ${
                i % 2 ? 'bg-stamp' : 'bg-primary'
              } ${i > 0 ? '-ml-1.5' : ''}`}
            >
              {m.name.trim().charAt(0).toUpperCase()}
            </span>
          ))}
          {overview.role === 'owner' && (
            <InviteDialog
              libraryId={overview.id}
              libraryName={overview.name}
              trigger={
                <button
                  type="button"
                  aria-label="Пригласить совладельца"
                  className="-ml-1.5 grid size-[30px] place-items-center rounded-full border-[1.5px] border-dashed border-muted-foreground/55 bg-background text-sm text-muted-foreground"
                >
                  +
                </button>
              }
            />
          )}
        </span>
      </div>

      {overview.shelves.map((s) => (
        <ShelfSection
          key={s.id}
          name={s.name}
          meta={
            <>
              <b className="font-medium text-foreground">{s.bookCount}</b>{' '}
              {plural(s.bookCount, 'книга', 'книги', 'книг')}
            </>
          }
          boardColor={s.accentColor ?? s.tint.color}
          books={s.books}
          emptyHint="Полка пустая — добавьте книгу или перенесите из «Неразобранного»."
          headerAction={
            <Link
              to="/shelves/$shelfId"
              params={{ shelfId: s.id }}
              className="text-[12.5px] font-medium text-accent-foreground"
            >
              Открыть полку →
            </Link>
          }
        />
      ))}

      {/* Призрачная полка — приглашение создать следующую */}
      <NewShelfDialog
        libraryId={overview.id}
        onCreated={refresh}
        trigger={
          <button
            type="button"
            className="mt-7 flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[10px] border-[1.5px] border-dashed border-primary/45 text-[14.5px] font-semibold text-accent-foreground"
          >
            <span
              aria-hidden
              className="grid size-[22px] place-items-center rounded-full border-[1.5px] border-dashed border-primary text-sm leading-none"
            >
              +
            </span>
            Новая полка
          </button>
        }
      />

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
            <div className="grid justify-items-start gap-[2px] pl-3.5">
              {overview.unsorted.books.map((b, i) => {
                const look = spineFor(b.title, b.pages, {
                  heightMm: b.heightMm,
                  coverType: b.coverType,
                  giftEdition: b.giftEdition,
                })
                const bg = b.coverColor ?? look.color
                const lightText = b.coverColor
                  ? textToneFor(b.coverColor) === 'light'
                  : look.dark
                const hardEdge = b.coverType === 'hard'
                return (
                  <Link
                    key={b.id}
                    to="/books/$bookId"
                    params={{ bookId: b.id }}
                    className={`relative flex items-center overflow-hidden rounded-[3px] px-2.5 font-display text-[11px] font-medium whitespace-nowrap ${hardEdge ? 'flat-hard' : ''}`}
                    style={{
                      height: look.width,
                      width: look.height,
                      background: bg,
                      ['--sc' as string]: bg,
                      color: lightText
                        ? 'rgba(255,255,255,.9)'
                        : 'rgba(35,43,56,.8)',
                      marginLeft: [0, 14, 6, 20, 10][i % 5],
                      boxShadow:
                        'inset 0 1.5px 0 rgba(255,255,255,.35), inset 0 -2px 0 rgba(35,43,56,.12), 0 2px 3px -2px rgba(35,43,56,.35)',
                    }}
                  >
                    <span className="overflow-hidden text-ellipsis">
                      {b.authors
                        ? `${b.authors.split(/[;,]/)[0] ?? ''} · `
                        : ''}
                      {b.title}
                    </span>
                  </Link>
                )
              })}
            </div>
            <div className="mt-3.5 flex items-center gap-2.5">
              <Button asChild>
                <Link to="/unsorted" search={{ lib: overview.id }}>
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
