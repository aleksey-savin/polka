import { Fragment, useRef, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Ellipsis } from 'lucide-react'
import { toast } from 'sonner'
import type { ReactNode } from 'react'

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
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

/** «11 августа», с годом — только если он не текущий. */
const dateHuman = (value: Date | string) => {
  const d = new Date(value)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('ru-RU', opts)
}

/** «11.08.26» — для строк формуляра. */
const dateShort = (value: Date | string) =>
  new Date(value).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })

const LANG_LABEL: Record<string, string> = {
  ru: 'русский',
  en: 'английский',
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2.5 flex items-baseline gap-2.5 font-mono text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
      {children}
      <span aria-hidden className="h-px flex-1 -translate-y-[3px] bg-border" />
    </h2>
  )
}

function BookCardPage() {
  const { book, personal, loans } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [coverOpen, setCoverOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [lendOpen, setLendOpen] = useState(false)
  const [giftOpen, setGiftOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [annotationOpen, setAnnotationOpen] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const refresh = () => void router.invalidate()

  const look = spineFor(book.title, book.pages)
  const activeLoan = loans.find((l) => l.returnedAt === null) ?? null
  const canCirculate = book.status === 'in_library' && !activeLoan

  const stampLabel = activeLoan
    ? 'На руках'
    : book.status === 'gifted'
      ? 'Подарена'
      : book.status === 'lost'
        ? 'Потеряна'
        : book.status === 'wishlist'
          ? 'Хочу'
          : null
  const stampTone =
    book.status === 'lost'
      ? 'border-destructive text-destructive'
      : book.status === 'wishlist'
        ? 'border-accent-foreground text-accent-foreground'
        : 'border-stamp text-stamp'

  async function run(
    name: string,
    action: () => Promise<unknown>,
    done?: string,
  ) {
    setBusyAction(name)
    try {
      await action()
      if (done) toast.success(done)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyAction(null)
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

  const editionParts: Array<ReactNode> = []
  if (book.publisher) editionParts.push(book.publisher)
  if (book.year)
    editionParts.push(
      <span key="year" className="font-mono text-[12.5px]">
        {book.year}
      </span>,
    )
  if (book.pages)
    editionParts.push(
      <span key="pages">
        <span className="font-mono text-[12.5px]">{book.pages}</span> с.
      </span>,
    )

  return (
    <div className="mx-auto max-w-[640px]">
      <p className="mb-5 overflow-hidden text-[13px] whitespace-nowrap text-ellipsis text-muted-foreground">
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

      {/* ── Книга-объект ── */}
      <header className="flex items-end gap-[18px]">
        <div className="relative w-[106px] flex-none">
          <button
            type="button"
            aria-label="Открыть обложку крупнее"
            className="block w-full cursor-zoom-in"
            onClick={() => setCoverOpen(true)}
          >
            {book.coverPath ? (
              <img
                src={`/api/covers/${book.id}?v=${book.coverPath}`}
                alt={`Обложка: ${book.title}`}
                className="aspect-[7/10] w-full rounded-[4px] object-cover shadow-[inset_3px_0_0_rgba(255,255,255,.22),0_8px_18px_-8px_rgba(35,43,56,.55)]"
              />
            ) : (
              <span
                aria-hidden
                className="grid aspect-[7/10] w-full content-end gap-1 overflow-hidden rounded-[4px] p-2.5 text-left"
                style={{
                  background: `linear-gradient(160deg, ${look.color}, color-mix(in oklab, ${look.color} 70%, #232B38))`,
                  boxShadow:
                    'inset 3px 0 0 rgba(255,255,255,.3), 0 8px 18px -8px rgba(35,43,56,.55)',
                }}
              >
                <span
                  className="text-[8.5px] leading-tight font-semibold"
                  style={{ color: 'rgba(35,43,56,.72)' }}
                >
                  {book.authors}
                </span>
                <span
                  className="font-display text-[12px] leading-tight font-bold"
                  style={{ color: 'rgba(35,43,56,.92)' }}
                >
                  {book.title}
                </span>
              </span>
            )}
          </button>
          {/* полочная линия под книгой */}
          <span
            aria-hidden
            className="absolute -inset-x-2 -bottom-[7px] h-1 rounded-full"
            style={{
              background:
                'linear-gradient(to right, var(--patina-old), var(--patina-fresh))',
              boxShadow: '0 3px 6px -2px rgba(35,43,56,.25)',
            }}
          />
          {stampLabel && (
            <span
              className={`absolute top-2.5 -right-3 rotate-[-7deg] rounded border-2 bg-background/85 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.16em] uppercase shadow-sm ${stampTone}`}
            >
              {stampLabel}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 pb-1">
          {book.seriesName && book.seriesId && (
            <p className="mb-2 flex items-center gap-1.5">
              <Link
                to="/series/$seriesId"
                params={{ seriesId: book.seriesId }}
                className="min-w-0"
              >
                <Badge
                  variant="outline"
                  className="max-w-full min-w-0 rounded-full border-stamp/30 text-stamp"
                >
                  <span className="truncate">{book.seriesName}</span>
                </Badge>
              </Link>
              {book.seriesNumber && (
                <span className="flex-none text-[12.5px] text-muted-foreground">
                  том {book.seriesNumber}
                </span>
              )}
            </p>
          )}
          <h1 className="text-[25px] leading-[1.16] font-semibold tracking-[-0.015em] md:text-[28px]">
            {book.title}
          </h1>
          {book.authors && (
            <p className="mt-1 text-[15px] text-muted-foreground">
              {book.authors}
            </p>
          )}
          {editionParts.length > 0 && (
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {editionParts.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  {part}
                </Fragment>
              ))}
            </p>
          )}
        </div>
      </header>

      {/* ── Лента обращения: где книга сейчас + главное действие ── */}
      {activeLoan ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-stamp/25 bg-stamp/5 p-3">
          <span
            aria-hidden
            className="grid size-8 flex-none rotate-[-6deg] place-items-center rounded-full border-2 border-stamp bg-white/70 font-mono text-sm font-medium text-stamp"
          >
            ✳
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px]">
              У <b className="font-semibold">«{activeLoan.borrowerName}»</b>
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              с{' '}
              <span className="font-mono text-xs">
                {dateHuman(activeLoan.lentAt)}
              </span>
              {activeLoan.dueAt && (
                <>
                  {' · вернуть к '}
                  <span className="font-mono text-xs">
                    {dateHuman(activeLoan.dueAt)}
                  </span>
                </>
              )}
            </p>
          </div>
          <Button
            loading={busyAction === 'return'}
            onClick={() =>
              void run(
                'return',
                () => returnLoanFn({ data: { loanId: activeLoan.loanId } }),
                'Вернули — книга снова дома',
              )
            }
          >
            Вернули
          </Button>
        </div>
      ) : book.status === 'in_library' ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-primary/25 bg-accent p-3">
          <span
            aria-hidden
            className="grid size-8 flex-none place-items-center rounded-full border-2 border-primary bg-white/70 font-mono text-sm font-medium text-primary"
          >
            ✓
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px]">Дома</p>
            <p className="truncate text-[12.5px] text-muted-foreground">
              {book.libraryName} · {book.shelfName ?? 'Неразобранное'}
            </p>
          </div>
          <Button onClick={() => setLendOpen(true)}>Дал почитать</Button>
        </div>
      ) : book.status === 'gifted' ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-patina-old bg-patina-old/20 p-3">
          <span
            aria-hidden
            className="grid size-8 flex-none rotate-[-6deg] place-items-center rounded-full border-2 border-[#A5824A] bg-white/70 font-mono text-sm font-medium text-[#A5824A]"
          >
            ✳
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px]">
              Подарена
              {book.giftedTo && (
                <b className="font-semibold"> «{book.giftedTo}»</b>
              )}
            </p>
            {book.giftedAt && (
              <p className="text-[12.5px] text-muted-foreground">
                <span className="font-mono text-xs">
                  {dateHuman(book.giftedAt)}
                </span>
              </p>
            )}
          </div>
          <Button
            variant="outline"
            loading={busyAction === 'restore'}
            onClick={() =>
              void run(
                'restore',
                () => restoreToLibraryFn({ data: { bookId: book.id } }),
                'Книга снова в библиотеке',
              )
            }
          >
            Снова в библиотеку
          </Button>
        </div>
      ) : book.status === 'lost' ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <span
            aria-hidden
            className="grid size-8 flex-none rotate-[-6deg] place-items-center rounded-full border-2 border-destructive bg-white/70 font-mono text-sm font-medium text-destructive"
          >
            ✕
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px]">Потерялась</p>
            <p className="text-[12.5px] text-muted-foreground">
              карточка и формуляр сохранены
            </p>
          </div>
          <Button
            variant="outline"
            loading={busyAction === 'restore'}
            onClick={() =>
              void run(
                'restore',
                () => restoreToLibraryFn({ data: { bookId: book.id } }),
                'Книга снова в библиотеке',
              )
            }
          >
            Нашлась
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-primary/25 bg-accent p-3">
          <span
            aria-hidden
            className="grid size-8 flex-none place-items-center rounded-full border-2 border-primary bg-white/70 font-mono text-sm font-medium text-primary"
          >
            ♡
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px]">В списке «Хочу»</p>
            <p className="text-[12.5px] text-muted-foreground">
              книги ещё нет дома
            </p>
          </div>
          <Button onClick={() => setMoveOpen(true)}>Купил — на полку</Button>
        </div>
      )}

      {/* ── Действия ── */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link to="/books/$bookId/edit" params={{ bookId: book.id }}>
            Редактировать
          </Link>
        </Button>
        {book.status !== 'wishlist' && (
          <Button variant="outline" onClick={() => setMoveOpen(true)}>
            Переместить
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost">
              Ещё <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {canCirculate && (
              <>
                <DropdownMenuItem onSelect={() => setGiftOpen(true)}>
                  Подарить
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    void run('lost', () =>
                      markLostFn({ data: { bookId: book.id } }),
                    )
                  }
                >
                  Потерялась
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
              {book.coverPath ? 'Заменить обложку' : 'Загрузить обложку'}
            </DropdownMenuItem>
            {book.coverPath && (
              <DropdownMenuItem
                onSelect={() =>
                  void removeCoverFn({ data: { bookId: book.id } }).then(
                    refresh,
                  )
                }
              >
                Убрать обложку
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              Удалить
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Аннотация и тэги ── */}
      {(book.annotation || book.tags.length > 0) && (
        <section className="mt-7">
          <SectionLabel>{book.annotation ? 'Аннотация' : 'Тэги'}</SectionLabel>
          {book.annotation && (
            <>
              <p
                className={`max-w-[60ch] text-[15px] leading-[1.65] ${annotationOpen ? '' : 'line-clamp-4'}`}
              >
                {book.annotation}
              </p>
              {book.annotation.length > 280 && (
                <button
                  type="button"
                  className="mt-1.5 text-[13.5px] font-medium text-accent-foreground"
                  onClick={() => setAnnotationOpen((v) => !v)}
                >
                  {annotationOpen ? 'Свернуть' : 'Развернуть'}
                </button>
              )}
            </>
          )}
          {book.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {book.tags.map((t) => (
                <Badge key={t} variant="secondary" className="rounded-full">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Личное ── */}
      <section className="mt-7">
        <SectionLabel>Мой формуляр</SectionLabel>
        <PersonalPanel
          bookId={book.id}
          personal={personal}
          onChanged={refresh}
        />
      </section>

      {/* ── Библиография ── */}
      <section className="mt-7">
        <SectionLabel>Каталожная карточка</SectionLabel>
        <dl className="ruled-card">
          {(book.isbn13 || book.isbn10) && (
            <div className="flex h-8 items-baseline gap-3 overflow-hidden whitespace-nowrap">
              <dt className="w-[108px] flex-none text-[12.5px] text-muted-foreground">
                ISBN
              </dt>
              <dd className="m-0 min-w-0 truncate font-mono text-[13px]">
                {book.isbn13 ?? book.isbn10}
              </dd>
            </div>
          )}
          {book.publisher && (
            <div className="flex h-8 items-baseline gap-3 overflow-hidden whitespace-nowrap">
              <dt className="w-[108px] flex-none text-[12.5px] text-muted-foreground">
                Издательство
              </dt>
              <dd className="m-0 min-w-0 truncate text-sm">{book.publisher}</dd>
            </div>
          )}
          <div className="flex h-8 items-baseline gap-3 overflow-hidden whitespace-nowrap">
            <dt className="w-[108px] flex-none text-[12.5px] text-muted-foreground">
              Язык
            </dt>
            <dd className="m-0 min-w-0 truncate text-sm">
              {LANG_LABEL[book.language] ?? book.language}
            </dd>
          </div>
          <div className="flex h-8 items-baseline gap-3 overflow-hidden whitespace-nowrap">
            <dt className="w-[108px] flex-none text-[12.5px] text-muted-foreground">
              В библиотеке
            </dt>
            <dd className="m-0 min-w-0 truncate text-sm">
              с{' '}
              <span className="font-mono text-[13px]">
                {dateRu(book.createdAt)}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      {/* ── История выдач ── */}
      {loans.length > 0 && (
        <section className="mt-7">
          <SectionLabel>Формуляр выдач</SectionLabel>
          <div className="ruled-card">
            <div className="grid h-8 grid-cols-[minmax(0,1fr)_78px_78px] items-baseline gap-2.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
              <span>Кому</span>
              <span>Взял</span>
              <span>Вернул</span>
            </div>
            {loans.map((l) => {
              const current = l.returnedAt === null
              return (
                <div
                  key={l.loanId}
                  className={`grid h-8 grid-cols-[minmax(0,1fr)_78px_78px] items-baseline gap-2.5 ${current ? 'text-stamp' : ''}`}
                >
                  <span className="flex min-w-0 items-baseline">
                    <span className="truncate text-sm font-medium">
                      {l.borrowerName}
                    </span>
                    {current && (
                      <span className="ml-2 inline-block flex-none rotate-[-3deg] rounded-[3px] border-[1.5px] border-stamp px-1 font-mono text-[10px] tracking-[0.1em] text-stamp uppercase">
                        сейчас
                      </span>
                    )}
                  </span>
                  <span
                    className={`font-mono text-[13px] tabular-nums ${current ? '' : 'text-muted-foreground'}`}
                  >
                    {dateShort(l.lentAt)}
                  </span>
                  <span
                    className={`font-mono text-[13px] tabular-nums ${current ? '' : 'text-muted-foreground'}`}
                  >
                    {l.returnedAt ? dateShort(l.returnedAt) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Диалоги ── */}
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
      <Dialog open={coverOpen} onOpenChange={setCoverOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Обложка</DialogTitle>
          </DialogHeader>
          {book.coverPath ? (
            <img
              src={`/api/covers/${book.id}?v=${book.coverPath}`}
              alt={`Обложка: ${book.title}`}
              className="mx-auto max-h-[60vh] w-auto rounded-md shadow-md"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              У книги пока нет обложки — загрузите фото или скан.
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              loading={coverBusy}
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LendDialog
        bookId={book.id}
        bookTitle={book.title}
        open={lendOpen}
        onOpenChange={setLendOpen}
        onDone={refresh}
      />
      <GiftDialog
        bookId={book.id}
        bookTitle={book.title}
        open={giftOpen}
        onOpenChange={setGiftOpen}
        onDone={refresh}
      />
      <DeleteBookDialog
        title={book.title}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void removeBook()}
      />
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
  open,
  onOpenChange,
  onConfirm,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
