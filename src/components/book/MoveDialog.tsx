import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { getLibraryOverviewFn, listMyLibrariesFn } from '@/server/libraries'
import { moveBooksFn } from '@/server/books'

/** Диалог «Переместить на полку…» для одной или нескольких книг. */
export function MoveDialog({
  open,
  onOpenChange,
  bookIds,
  onMoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookIds: Array<string>
  onMoved: () => void
}) {
  const [libraries, setLibraries] = useState<
    Array<{ id: string; name: string }>
  >([])
  const [shelves, setShelves] = useState<Array<{ id: string; name: string }>>(
    [],
  )
  const [libraryId, setLibraryId] = useState('')
  const [shelfId, setShelfId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    void listMyLibrariesFn().then((libs) => {
      setLibraries(libs)
      if (libs.length > 0 && !libraryId) setLibraryId(libs[0]?.id ?? '')
    })
  }, [open])

  useEffect(() => {
    if (!libraryId) return
    void getLibraryOverviewFn({ data: { libraryId } }).then((o) => {
      setShelves(o.shelves.map((s) => ({ id: s.id, name: s.name })))
      setShelfId('')
    })
  }, [libraryId])

  async function submit() {
    if (!libraryId) return
    setBusy(true)
    try {
      await moveBooksFn({
        data: { bookIds, libraryId, shelfId: shelfId || null },
      })
      onOpenChange(false)
      onMoved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {bookIds.length === 1
              ? 'Переместить книгу'
              : `Переместить ${bookIds.length} кн.`}
          </DialogTitle>
          <DialogDescription>
            Книга встанет на выбранную полку; из «Хочу» — переедет в библиотеку.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Библиотека</Label>
            <select
              className="h-10 rounded-lg border bg-card px-3 text-sm"
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
          <div className="grid gap-1.5">
            <Label>Полка</Label>
            <select
              className="h-10 rounded-lg border bg-card px-3 text-sm"
              value={shelfId}
              onChange={(e) => setShelfId(e.target.value)}
            >
              <option value="">Неразобранное</option>
              {shelves.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={busy || !libraryId}>
            Переместить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
