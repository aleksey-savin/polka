import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { giftBookFn } from '@/server/books'
import { lendBookFn } from '@/server/loans'

/* Диалоги управляемые: открываются из ленты обращения и меню «Ещё». */

export function LendDialog({
  bookId,
  bookTitle,
  open,
  onOpenChange,
  onDone,
}: {
  bookId: string
  bookTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await lendBookFn({
        data: { bookId, borrowerName: name.trim(), dueAt: dueAt || null },
      })
      onOpenChange(false)
      setName('')
      setDueAt('')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось записать выдачу')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>«{bookTitle}» — кому даёте?</DialogTitle>
          <DialogDescription>
            Книга останется на полке со штампом «НА РУКАХ», а на этой странице
            появится запись в формуляре.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="lend-name">Кому</Label>
            <Input
              id="lend-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя"
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lend-due">
              Вернуть к{' '}
              <span className="font-normal text-muted-foreground">
                (не обязательно)
              </span>
            </Label>
            <Input
              id="lend-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!name.trim()}
          >
            Дать почитать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function GiftDialog({
  bookId,
  bookTitle,
  open,
  onOpenChange,
  onDone,
}: {
  bookId: string
  bookTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!to.trim()) return
    setBusy(true)
    setError(null)
    try {
      await giftBookFn({ data: { bookId, giftedTo: to.trim() } })
      onOpenChange(false)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>«{bookTitle}» уезжает насовсем?</DialogTitle>
          <DialogDescription>
            Книга уйдёт с полки, но останется в каталоге со штампом «ПОДАРЕНА» —
            найдётся фильтром. Если передумаете, на карточке будет кнопка «Снова
            в библиотеку».
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="gift-to">Кому подарили</Label>
          <Input
            id="gift-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Имя"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!to.trim()}
          >
            Подарить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
