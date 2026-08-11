import { useRef, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'

import { MoveDialog } from '@/components/book/MoveDialog'
import { PersonalPanel } from '@/components/book/PersonalPanel'
import { GiftDialog, LendDialog } from '@/components/book/status-dialogs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  deleteBookFn,
  getBookCardFn,
  markLostFn,
  restoreToLibraryFn,
} from '@/server/books'
import { removeCoverFn, uploadCoverFn } from '@/server/covers'
import { bookLoanHistoryFn, returnLoanFn } from '@/server/loans'
import { listBookPersonalFn } from '@/server/personal'
import { spineFor } from '@/services/spine'

export const Route = createFileRoute('/_app/books/$bookId')({
  loader: async ({ params }) => {
    const [book, personal, loans] = await Promise.all([
      getBookCardFn({ data: { bookId: params.bookId } }),
      listBookPersonalFn({ data: { bookId: params.bookId } }),
      bookLoanHistoryFn({ data: { bookId: params.bookId } }),
    ])
    return { book, personal, loans }
  },
  component: BookCardPage,
})

const dateRu = (value: Date | string | null) =>
  value ? new Date(value).toLocaleDateString('ru-RU') : ''

function BookCardPage() {
  const { book, personal, loans } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const refresh = () => void router.invalidate()

  const look = spineFor(book.title, book.pages)
  const activeLoan = loans.find((l) => l.returnedAt === null) ?? null

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      refresh()
    } finally {
      setBusy(false)
    }
  }

  async function uploadCover(file: File) {
    setCoverBusy(true)
    try {
      const form = new FormData()
      form.set('bookId', book.id)
      form.set('file', file)
      await uploadCoverFn({ data: form })
      refresh()
    } finally {
      setCoverBusy(false)
    }
  }

  async function removeBook() {
    await deleteBookFn({ data: { bookId: book.id } })
    await navigate({ to: '/books', search: {} })
  }

  return (
    <div>
      <p className="mb-4 text-[13px] text-muted-foreground">
        {book.libraryId ? (
          <>
            <Link
              to="/libraries"
              search={{ lib: book.libraryId }}
              className="hover:text-foreground"
            >
              {book.libraryName}
            </Link>
            {' / '}
            {book.shelfId ? (
              <Link
                to="/shelves/$shelfId"
                params={{ shelfId: book.shelfId }}
                className="hover:text-foreground"
              >
                {book.shelfName}
              </Link>
            ) : (
              'Неразобранное'
            )}
            {' / '}
          </>
        ) : (
          <>
            <Link to="/wishlist" className="hover:text-foreground">
              Хочу
            </Link>
            {' / '}
          </>
        )}
        {book.title}
      </p>

      <div className="grid gap-8 md:grid-cols-[250px_1fr]">
        <div className="grid content-start gap-3">
          {book.coverPath ? (
            <img
              src={`/api/covers/${book.id}?v=${book.coverPath}`}
              alt={`Обложка: ${book.title}`}
              className="aspect-[7/10] w-full max-w-[250px] rounded-md object-cover shadow-md"
            />
          ) : (
            <div
              className="grid aspect-[7/10] w-full max-w-[250px] content-end gap-1.5 rounded-md p-5 shadow-md"
              style={{
                background: `linear-gradient(160deg, ${look.color}, color-mix(in oklab, ${look.color} 70%, #232B38))`,
                boxShadow: 'inset 3px 0 0 rgba(255,255,255,.35)',
              }}
            >
              <span
                className="text-[13px] font-semibold"
                style={{ color: 'rgba(35,43,56,.72)' }}
              >
                {book.authors}
              </span>
              <span
                className="font-display text-2xl leading-tight font-bold"
                style={{ color: 'rgba(35,43,56,.92)' }}
              >
                {book.title}
              </span>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void uploadCover(f)
              e.target.value = ''
            }}
          />
          <div className="flex max-w-[250px] gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={coverBusy}
              onClick={() => fileRef.current?.click()}
            >
              {book.coverPath ? 'Заменить обложку' : 'Загрузить обложку'}
            </Button>
            {book.coverPath && (
              <Button
                variant="ghost"
                disabled={coverBusy}
                onClick={() =>
                  void removeCoverFn({ data: { bookId: book.id } }).then(
                    refresh,
                  )
                }
              >
                Убрать
              </Button>
            )}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <h1 className="text-[32px] leading-tight font-semibold">
              {book.title}
            </h1>
            {activeLoan && (
              <span className="mt-2 inline-block -rotate-2 rounded border-2 border-stamp px-2 py-0.5 font-mono text-[11.5px] font-medium tracking-widest text-stamp uppercase">
                На руках
              </span>
            )}
            {book.status === 'gifted' && (
              <span className="mt-2 inline-block -rotate-2 rounded border-2 border-stamp px-2 py-0.5 font-mono text-[11.5px] font-medium tracking-widest text-stamp uppercase">
                Подарена
              </span>
            )}
            {book.status === 'lost' && (
              <span className="mt-2 inline-block -rotate-2 rounded border-2 border-destructive px-2 py-0.5 font-mono text-[11.5px] font-medium tracking-widest text-destructive uppercase">
                Потеряна
              </span>
            )}
            {book.status === 'wishlist' && (
              <span className="mt-2 inline-block -rotate-2 rounded border-2 border-accent-foreground px-2 py-0.5 font-mono text-[11.5px] font-medium tracking-widest text-accent-foreground uppercase">
                Хочу
              </span>
            )}
          </div>
          {book.authors && (
            <p className="mt-1 text-base text-muted-foreground">
              {book.authors}
            </p>
          )}
          {activeLoan && (
            <p className="mt-1.5 text-sm text-stamp">
              у «{activeLoan.borrowerName}» с {dateRu(activeLoan.lentAt)}
              {activeLoan.dueAt && `, вернуть к ${dateRu(activeLoan.dueAt)}`}
            </p>
          )}
          {book.status === 'gifted' && (
            <p className="mt-1.5 text-sm text-muted-foreground">
              подарена{book.giftedTo && ` — ${book.giftedTo}`}
              {book.giftedAt && `, ${dateRu(book.giftedAt)}`}
            </p>
          )}

          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            {book.seriesName && book.seriesId && (
              <>
                <dt className="text-muted-foreground">Серия</dt>
                <dd>
                  <Link
                    to="/series/$seriesId"
                    params={{ seriesId: book.seriesId }}
                  >
                    <Badge
                      variant="outline"
                      className="border-stamp/30 text-stamp"
                    >
                      {book.seriesName}
                    </Badge>
                  </Link>
                  {book.seriesNumber && (
                    <span className="ml-1.5">· том {book.seriesNumber}</span>
                  )}
                </dd>
              </>
            )}
            {book.publisher && (
              <>
                <dt className="text-muted-foreground">Издательство</dt>
                <dd>{book.publisher}</dd>
              </>
            )}
            {book.year && (
              <>
                <dt className="text-muted-foreground">Год</dt>
                <dd>{book.year}</dd>
              </>
            )}
            {book.pages && (
              <>
                <dt className="text-muted-foreground">Страниц</dt>
                <dd>{book.pages}</dd>
              </>
            )}
            {book.isbn13 && (
              <>
                <dt className="text-muted-foreground">ISBN</dt>
                <dd className="font-mono text-[13px]">{book.isbn13}</dd>
              </>
            )}
            {book.tags.length > 0 && (
              <>
                <dt className="text-muted-foreground">Тэги</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {book.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </dd>
              </>
            )}
          </dl>

          {book.annotation && (
            <p className="mt-4 max-w-prose text-[15px] leading-relaxed">
              {book.annotation}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-2.5">
            {activeLoan ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    returnLoanFn({ data: { loanId: activeLoan.loanId } }),
                  )
                }
              >
                Вернули
              </Button>
            ) : book.status === 'in_library' ? (
              <>
                <LendDialog
                  bookId={book.id}
                  bookTitle={book.title}
                  onDone={refresh}
                />
                <GiftDialog
                  bookId={book.id}
                  bookTitle={book.title}
                  onDone={refresh}
                />
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(() => markLostFn({ data: { bookId: book.id } }))
                  }
                >
                  Потерялась
                </Button>
              </>
            ) : book.status === 'wishlist' ? (
              <Button onClick={() => setMoveOpen(true)}>
                Купил — на полку
              </Button>
            ) : (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    restoreToLibraryFn({ data: { bookId: book.id } }),
                  )
                }
              >
                Вернуть в библиотеку
              </Button>
            )}
            <Button asChild variant="outline">
              <Link to="/books/$bookId/edit" params={{ bookId: book.id }}>
                Редактировать
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setMoveOpen(true)}>
              Переместить
            </Button>
            <DeleteBookDialog
              title={book.title}
              onConfirm={() => void removeBook()}
            />
          </div>

          <div className="mt-7">
            <PersonalPanel
              bookId={book.id}
              personal={personal}
              onChanged={refresh}
            />
          </div>

          {loans.length > 0 && (
            <section className="mt-7 rounded-lg border bg-card p-5 shadow-xs">
              <h3 className="mb-3 text-base font-semibold">Выдачи</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                      <th className="px-2.5 py-1.5">Кому</th>
                      <th className="px-2.5 py-1.5">Взял</th>
                      <th className="px-2.5 py-1.5">Срок</th>
                      <th className="px-2.5 py-1.5">Вернул</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map((l) => (
                      <tr
                        key={l.loanId}
                        className={l.returnedAt === null ? 'bg-accent' : ''}
                      >
                        <td className="border-t px-2.5 py-2 font-medium">
                          {l.borrowerName}
                        </td>
                        <td className="border-t px-2.5 py-2">
                          {dateRu(l.lentAt)}
                        </td>
                        <td className="border-t px-2.5 py-2">
                          {l.dueAt ? dateRu(l.dueAt) : '—'}
                        </td>
                        <td className="border-t px-2.5 py-2">
                          {l.returnedAt ? dateRu(l.returnedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>

      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        bookIds={[book.id]}
        onMoved={refresh}
      />
    </div>
  )
}

function DeleteBookDialog({
  title,
  onConfirm,
}: {
  title: string
  onConfirm: () => void
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" className="text-destructive">
          Удалить
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Удалить «{title}»?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Карточка, тэги, история выдач и обложка будут удалены навсегда.
          Отменить нельзя.
        </p>
        <DialogFooter>
          <Button variant="destructive" onClick={onConfirm}>
            Удалить книгу
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
