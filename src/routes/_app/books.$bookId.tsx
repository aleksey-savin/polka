import { useRef, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'

import { MoveDialog } from '@/components/book/MoveDialog'
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
import { deleteBookFn, getBookCardFn } from '@/server/books'
import { removeCoverFn, uploadCoverFn } from '@/server/covers'
import { spineFor } from '@/services/spine'

export const Route = createFileRoute('/_app/books/$bookId')({
  loader: ({ params }) => getBookCardFn({ data: { bookId: params.bookId } }),
  component: BookCardPage,
})

const STATUS_STAMP: Record<string, string> = {
  wishlist: 'Хочу',
  gifted: 'Подарена',
  lost: 'Потеряна',
}

function BookCardPage() {
  const book = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const refresh = () => void router.invalidate()

  const look = spineFor(book.title, book.pages)

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
              src={`/api/covers/${book.id}?v=${Date.now()}`}
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
          <div className="flex flex-wrap items-start gap-4">
            <h1 className="text-[34px] leading-tight font-semibold">
              {book.title}
            </h1>
            {STATUS_STAMP[book.status] && (
              <span className="mt-2 inline-block -rotate-2 rounded border-2 border-stamp px-2 py-0.5 font-mono text-[11.5px] font-medium tracking-widest text-stamp uppercase">
                {STATUS_STAMP[book.status]}
              </span>
            )}
          </div>
          {book.authors && (
            <p className="mt-1 mb-4 text-base text-muted-foreground">
              {book.authors}
            </p>
          )}

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
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
            <Button asChild>
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

          <p className="mt-8 text-[13px] text-muted-foreground">
            Статусы чтения, оценки, рецензии и «дал почитать» появятся на этапе
            M5.
          </p>
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
          Карточка, тэги и обложка будут удалены навсегда. Отменить нельзя.
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
