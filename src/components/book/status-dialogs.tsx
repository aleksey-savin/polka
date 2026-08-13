import { useState } from 'react'

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
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>«{bookTitle}» — кому даёте?</DrawerTitle>
          <DrawerDescription>
            Книга останется на полке со штампом «НА РУКАХ», а на этой странице
            появится запись в формуляре.
          </DrawerDescription>
        </DrawerHeader>
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
        <DrawerFooter>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!name.trim()}
          >
            Дать почитать
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
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
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>«{bookTitle}» уезжает насовсем?</DrawerTitle>
          <DrawerDescription>
            Книга уйдёт с полки, но останется в каталоге со штампом «ПОДАРЕНА» —
            найдётся фильтром. Если передумаете, на карточке будет кнопка «Снова
            в библиотеку».
          </DrawerDescription>
        </DrawerHeader>
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
        <DrawerFooter>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!to.trim()}
          >
            Подарить
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
