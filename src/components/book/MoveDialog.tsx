import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { plural } from '@/lib/plural'
import { moveBooksFn } from '@/server/books'
import { getLibraryOverviewFn, listMyLibrariesFn } from '@/server/libraries'
import { createShelfFn } from '@/server/shelves'

export interface MoveTarget {
  libraryId: string
  shelfId: string | null
  shelfName: string
}

interface ShelfItem {
  id: string
  name: string
  bookCount: number
}

/**
 * «Переместить на полку…» для одной или нескольких книг.
 * Библиотека предвыбирается по перемещаемым книгам; полки — списком,
 * новую полку можно создать не выходя из окна.
 */
export function MoveDialog({
  open,
  onOpenChange,
  bookIds,
  defaultLibraryId,
  defaultShelfId,
  contextLabel,
  onMoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookIds: Array<string>
  /** Библиотека перемещаемых книг — предвыбор вместо «первой по списку». */
  defaultLibraryId?: string
  /** Полка перемещаемых книг (null = «Неразобранное»), чтобы пометить «уже здесь». */
  defaultShelfId?: string | null
  /** Подпись «Из «Офис · Неразобранное»» под заголовком. */
  contextLabel?: string
  onMoved: (target: MoveTarget) => void
}) {
  const [libraries, setLibraries] = useState<
    Array<{ id: string; name: string }>
  >([])
  const [shelves, setShelves] = useState<Array<ShelfItem>>([])
  const [libraryId, setLibraryId] = useState('')
  const [shelfId, setShelfId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setCreating(false)
    setNewName('')
    void listMyLibrariesFn().then((libs) => {
      setLibraries(libs)
      setLibraryId(defaultLibraryId ?? libs[0]?.id ?? '')
    })
  }, [open, defaultLibraryId])

  useEffect(() => {
    if (!libraryId) return
    void getLibraryOverviewFn({ data: { libraryId } }).then((o) => {
      setShelves(
        o.shelves.map((s) => ({
          id: s.id,
          name: s.name,
          bookCount: s.bookCount,
        })),
      )
      // возвращение в свою библиотеку — отмечаем текущую полку книг
      setShelfId(
        libraryId === defaultLibraryId && defaultShelfId ? defaultShelfId : '',
      )
    })
  }, [libraryId, defaultLibraryId, defaultShelfId])

  const targetName =
    shelfId === ''
      ? 'Неразобранное'
      : (shelves.find((s) => s.id === shelfId)?.name ?? '')

  // Тап по готовой полке закрывает форму создания — выбор всегда один
  const selectShelf = (id: string) => {
    setShelfId(id)
    setCreating(false)
    setNewName('')
  }
  const isCurrent = (id: string) =>
    libraryId === defaultLibraryId &&
    defaultShelfId !== undefined &&
    (defaultShelfId ?? '') === id

  async function createShelf() {
    const name = newName.trim()
    if (!name) return
    setCreateBusy(true)
    setError(null)
    try {
      const { id } = await createShelfFn({ data: { libraryId, name } })
      setShelves((cur) => [...cur, { id, name, bookCount: 0 }])
      setShelfId(id)
      setCreating(false)
      setNewName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось создать полку')
    } finally {
      setCreateBusy(false)
    }
  }

  async function submit() {
    if (!libraryId) return
    setBusy(true)
    setError(null)
    try {
      await moveBooksFn({
        data: { bookIds, libraryId, shelfId: shelfId || null },
      })
      onOpenChange(false)
      onMoved({ libraryId, shelfId: shelfId || null, shelfName: targetName })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось переместить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            Переместить{' '}
            {bookIds.length === 1
              ? 'книгу'
              : `${bookIds.length} ${plural(bookIds.length, 'книгу', 'книги', 'книг')}`}
          </DrawerTitle>
          <DrawerDescription>
            {contextLabel ??
              'Книга встанет на выбранную полку; из «Хочу» — переедет в библиотеку.'}
          </DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-4">
          {libraries.length > 1 && (
            <div className="grid gap-1.5">
              <Label>Библиотека</Label>
              <select
                className="h-12 rounded-xl border bg-card px-3 text-[16px]"
                value={libraryId}
                onChange={(e) => setLibraryId(e.target.value)}
              >
                {libraries.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>На полку</Label>
            <div className="grid gap-1.5">
              <ShelfOption
                name="Неразобранное"
                checked={!creating && shelfId === ''}
                current={isCurrent('')}
                onSelect={() => selectShelf('')}
              />
              {shelves.map((s) => (
                <ShelfOption
                  key={s.id}
                  name={s.name}
                  count={s.bookCount}
                  checked={!creating && shelfId === s.id}
                  current={isCurrent(s.id)}
                  onSelect={() => selectShelf(s.id)}
                />
              ))}
              {creating ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Название полки"
                    className="h-12 rounded-xl text-[16px]"
                    onKeyDown={(e) => e.key === 'Enter' && void createShelf()}
                  />
                  <Button
                    className="h-12 rounded-xl"
                    loading={createBusy}
                    disabled={!newName.trim()}
                    onClick={() => void createShelf()}
                  >
                    Создать
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-dashed border-primary/40 px-3 text-left text-[15px] font-medium text-accent-foreground"
                  onClick={() => setCreating(true)}
                >
                  <span
                    aria-hidden
                    className="grid size-5 flex-none place-items-center rounded-full border-[1.5px] border-dashed border-primary text-sm leading-none text-primary"
                  >
                    +
                  </span>
                  Новая полка
                </button>
              )}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DrawerFooter>
          <Button
            size="lg"
            onClick={() => void submit()}
            loading={busy}
            disabled={!libraryId || creating}
          >
            {creating ? (
              'Сначала создайте полку'
            ) : (
              <>
                Переместить{' '}
                {shelfId === '' ? 'в «Неразобранное»' : `на «${targetName}»`}
              </>
            )}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function ShelfOption({
  name,
  count,
  checked,
  current,
  onSelect,
}: {
  name: string
  count?: number
  checked: boolean
  current: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      className={`flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-3 text-left text-[15px] font-medium ${
        checked ? 'border-primary/50 bg-accent' : 'bg-card'
      }`}
      onClick={onSelect}
    >
      <span
        aria-hidden
        className={`grid size-5 flex-none place-items-center rounded-full border-[1.5px] ${
          checked ? 'border-primary' : 'border-border'
        }`}
      >
        {checked && <span className="size-2.5 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 truncate">{name}</span>
      {current ? (
        <span className="ml-auto flex-none text-[11px] font-normal text-muted-foreground">
          книги уже здесь
        </span>
      ) : (
        count !== undefined && (
          <span className="ml-auto flex-none font-mono text-xs text-muted-foreground">
            {count}
          </span>
        )
      )}
    </button>
  )
}
