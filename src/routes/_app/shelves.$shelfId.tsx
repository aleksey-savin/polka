import { useMemo, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'

import { Ellipsis, Pencil, Trash2 } from 'lucide-react'

import { BatchBar } from '@/components/book/BatchBar'
import { BookRow } from '@/components/book/BookRow'
import { ShelfColorSheet } from '@/components/shelf/ShelfColorSheet'
import { ShelfSection } from '@/components/shelf/ShelfSection'
import { ActionMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
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
  const [renameOpen, setRenameOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
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
        </span>
        <div className="ml-auto flex items-center gap-2">
          {shelf.books.length === 0 && (
            <Button asChild variant="outline">
              <Link
                to="/books/new"
                search={{ library: shelf.libraryId, shelf: shelf.id }}
              >
                + Добавить сюда
              </Link>
            </Button>
          )}
          <ActionMenu
            caption={`Полка «${shelf.name}»`}
            trigger={
              <Button variant="ghost">
                Ещё <Ellipsis aria-hidden />
              </Button>
            }
            entries={[
              {
                key: 'rename',
                label: 'Переименовать',
                icon: <Pencil />,
                onSelect: () => setRenameOpen(true),
              },
              {
                key: 'color',
                label: 'Цвет полки',
                icon: (
                  <span
                    aria-hidden
                    className="size-[21px] rounded-full border"
                    style={{
                      background:
                        shelf.accentColor ??
                        'linear-gradient(120deg, var(--patina-old), var(--patina-fresh))',
                    }}
                  />
                ),
                onSelect: () => setColorOpen(true),
              },
              'separator',
              {
                key: 'delete',
                label: 'Удалить полку',
                icon: <Trash2 />,
                danger: true,
                onSelect: () => setDeleteOpen(true),
              },
            ]}
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
          heightMm: b.heightMm,
          coverType: b.coverType,
          giftEdition: b.giftEdition,
          lentTo: b.lentTo,
          coverColor: b.coverColor,
        }))}
        emptyHint="Пока пусто. «+ Добавить сюда» — и первая книга встанет на полку."
      />

      <ShelfColorSheet
        shelfId={shelf.id}
        accentColor={shelf.accentColor}
        open={colorOpen}
        onOpenChange={setColorOpen}
        onChanged={refresh}
      />
      <RenameShelfDialog
        shelfId={shelf.id}
        current={shelf.name}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        onRenamed={refresh}
      />
      <DeleteShelfDialog
        name={shelf.name}
        count={shelf.books.length}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void removeShelf()}
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
            {sorted.map((b) => {
              const checked = selected.includes(b.id)
              return (
                <BookRow
                  key={b.id}
                  book={b}
                  selected={checked}
                  onPress={selected.length > 0 ? () => toggle(b.id) : undefined}
                  before={
                    selected.length > 0 ? (
                      <span
                        aria-hidden
                        className={`grid size-6 place-items-center rounded-[7px] border-[1.5px] text-[13px] ${
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input bg-card text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                    ) : (
                      <label className="-m-2.5 grid cursor-pointer place-items-center p-2.5">
                        <input
                          type="checkbox"
                          aria-label="Выбрать"
                          className="size-5 accent-primary"
                          checked={checked}
                          onChange={() => toggle(b.id)}
                        />
                      </label>
                    )
                  }
                />
              )
            })}
          </div>
          <BatchBar
            selected={selected}
            onClear={() => setSelected([])}
            defaultLibraryId={shelf.libraryId}
            defaultShelfId={shelf.id}
            contextLabel={`С полки «${shelf.name}»`}
            onMoved={(target) => {
              const remaining = shelf.books.length - selected.length
              setSelected([])
              if (remaining > 0 || target.shelfId === shelf.id) {
                refresh()
              } else if (target.shelfId) {
                void navigate({
                  to: '/shelves/$shelfId',
                  params: { shelfId: target.shelfId },
                })
              } else {
                void navigate({
                  to: '/libraries',
                  search: { lib: target.libraryId },
                })
              }
            }}
          />
        </section>
      )}
    </div>
  )
}

function RenameShelfDialog({
  shelfId,
  current,
  open,
  onOpenChange,
  onRenamed,
}: {
  shelfId: string
  current: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRenamed: () => void
}) {
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await updateShelfFn({ data: { shelfId, name: name.trim() } })
      onOpenChange(false)
      onRenamed()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Переименовать полку</DrawerTitle>
        </DrawerHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <DrawerFooter>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            Сохранить
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function DeleteShelfDialog({
  name,
  count,
  open,
  onOpenChange,
  onConfirm,
}: {
  name: string
  count: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Удалить полку «{name}»?</DrawerTitle>
        </DrawerHeader>
        <p className="text-sm text-muted-foreground">
          {count > 0
            ? `Книги (${count}) не пропадут — они переедут в «Неразобранное» этой библиотеки.`
            : 'Полка пустая.'}
        </p>
        <DrawerFooter>
          <Button variant="destructive" onClick={onConfirm}>
            Удалить полку
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
