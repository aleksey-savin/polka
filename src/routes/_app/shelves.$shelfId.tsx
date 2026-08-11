import { useMemo, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'

import { BatchBar } from '@/components/book/BatchBar'
import { BookRow } from '@/components/book/BookRow'
import { AccentPanel } from '@/components/shelf/AccentPanel'
import { ShelfSection } from '@/components/shelf/ShelfSection'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { plural } from '@/lib/plural'
import { deleteShelfFn, getShelfViewFn, updateShelfFn } from '@/server/shelves'

export const Route = createFileRoute('/_app/shelves/$shelfId')({
  loader: ({ params }) => getShelfViewFn({ data: { shelfId: params.shelfId } }),
  component: ShelfPage,
})

type SortKey = 'shelf' | 'author' | 'year' | 'title'

function ShelfPage() {
  const shelf = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [selected, setSelected] = useState<Array<string>>([])
  const [sort, setSort] = useState<SortKey>('shelf')
  const refresh = () => void router.invalidate()

  const sorted = useMemo(() => {
    const rows = [...shelf.books]
    if (sort === 'author')
      rows.sort((a, b) => a.authors.localeCompare(b.authors, 'ru'))
    if (sort === 'title')
      rows.sort((a, b) => a.title.localeCompare(b.title, 'ru'))
    if (sort === 'year')
      rows.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999))
    return rows
  }, [shelf.books, sort])

  function toggle(id: string) {
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    )
  }

  async function removeShelf() {
    await deleteShelfFn({ data: { shelfId: shelf.id } })
    await navigate({ to: '/libraries', search: { lib: shelf.libraryId } })
  }

  return (
    <div>
      <p className="mb-3.5 text-[13px] text-muted-foreground">
        <Link
          to="/libraries"
          search={{ lib: shelf.libraryId }}
          className="hover:text-foreground"
        >
          {shelf.libraryName}
        </Link>{' '}
        / {shelf.name}
      </p>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-3xl font-semibold">{shelf.name}</h1>
        <span className="font-mono text-xs text-muted-foreground">
          <b className="font-medium text-foreground">{shelf.books.length}</b>{' '}
          {plural(shelf.books.length, 'книга', 'книги', 'книг')}
          {shelf.tint.medianYear !== null && !shelf.accentColor && (
            <>
              {' '}
              · медиана изданий{' '}
              <b className="font-medium text-foreground">
                {shelf.tint.medianYear}
              </b>
            </>
          )}
        </span>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline">
            <Link
              to="/books/new"
              search={{ library: shelf.libraryId, shelf: shelf.id }}
            >
              + Добавить сюда
            </Link>
          </Button>
          <RenameShelfDialog
            shelfId={shelf.id}
            current={shelf.name}
            onRenamed={refresh}
          />
          <DeleteShelfDialog
            name={shelf.name}
            count={shelf.books.length}
            onConfirm={() => void removeShelf()}
          />
        </div>
      </div>

      <ShelfSection
        boardColor={shelf.accentColor ?? shelf.tint.color}
        books={shelf.books.map((b) => ({
          id: b.id,
          title: b.title,
          authors: b.authors,
          pages: b.pages,
          lentTo: b.lentTo,
          coverColor: b.coverColor,
        }))}
        emptyHint="Пока пусто. «+ Добавить сюда» — и первая книга встанет на полку."
      />

      <AccentPanel
        shelfId={shelf.id}
        accentColor={shelf.accentColor}
        tint={shelf.tint}
        onChanged={refresh}
      />

      {shelf.books.length > 0 && (
        <section className="mt-6">
          <div className="mb-2.5 flex items-center gap-3">
            <h2 className="text-lg font-semibold">Книги на полке</h2>
            <select
              aria-label="Сортировка"
              className="ml-auto h-9 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="shelf">Как стоят на полке</option>
              <option value="author">По автору</option>
              <option value="title">По названию</option>
              <option value="year">По году</option>
            </select>
          </div>
          <div className="grid gap-2">
            {sorted.map((b) => (
              <BookRow
                key={b.id}
                book={b}
                before={
                  <input
                    type="checkbox"
                    aria-label="Выбрать"
                    className="size-[17px] accent-primary"
                    checked={selected.includes(b.id)}
                    onChange={() => toggle(b.id)}
                  />
                }
              />
            ))}
          </div>
          <BatchBar
            selected={selected}
            onClear={() => setSelected([])}
            onDone={refresh}
          />
        </section>
      )}
    </div>
  )
}

function RenameShelfDialog({
  shelfId,
  current,
  onRenamed,
}: {
  shelfId: string
  current: string
  onRenamed: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await updateShelfFn({ data: { shelfId, name: name.trim() } })
      setOpen(false)
      onRenamed()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">Переименовать</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Переименовать полку</DialogTitle>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteShelfDialog({
  name,
  count,
  onConfirm,
}: {
  name: string
  count: number
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
          <DialogTitle>Удалить полку «{name}»?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {count > 0
            ? `Книги (${count}) не пропадут — они переедут в «Неразобранное» этой библиотеки.`
            : 'Полка пустая.'}
        </p>
        <DialogFooter>
          <Button variant="destructive" onClick={onConfirm}>
            Удалить полку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
