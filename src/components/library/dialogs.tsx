import { useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createLibraryFn, createInviteFn } from '@/server/libraries'
import { createShelfFn } from '@/server/shelves'

export function NewLibraryDialog({
  onCreated,
  trigger,
}: {
  onCreated: (id: string) => void
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      const { id } = await createLibraryFn({ data: { name: name.trim() } })
      setOpen(false)
      setName('')
      onCreated(id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" className="text-accent-foreground">
            + библиотека
          </Button>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Новая библиотека</DrawerTitle>
          <DrawerDescription>
            Физическое место, где стоят книги: дом, дача, кабинет.
          </DrawerDescription>
        </DrawerHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="lib-name">Название</Label>
          <Input
            id="lib-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Дом"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </div>
        <DrawerFooter>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!name.trim()}
          >
            Создать библиотеку
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function NewShelfDialog({
  libraryId,
  onCreated,
  trigger,
}: {
  libraryId: string
  onCreated: () => void
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createShelfFn({ data: { libraryId, name: name.trim() } })
      setOpen(false)
      setName('')
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось создать полку')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {trigger ?? <Button variant="outline">+ Полка</Button>}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Новая полка</DrawerTitle>
        </DrawerHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="shelf-name">Название</Label>
          <Input
            id="shelf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Классика"
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DrawerFooter>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!name.trim()}
          >
            Создать полку
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function InviteDialog({
  libraryId,
  libraryName,
  trigger,
}: {
  libraryId: string
  libraryName: string
  trigger?: ReactNode
}) {
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setBusy(true)
    try {
      const { token } = await createInviteFn({ data: { libraryId } })
      setLink(`${window.location.origin}/invite/${token}`)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Drawer>
      <DrawerTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="text-sm font-semibold text-accent-foreground"
          >
            + пригласить
          </button>
        )}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Совладелец для «{libraryName}»</DrawerTitle>
          <DrawerDescription>
            Отправьте ссылку — человек войдёт в свой аккаунт и станет
            полноправным участником библиотеки: книги, полки и выдачи станут
            общими. Оценки и заметки у каждого останутся свои.
          </DrawerDescription>
        </DrawerHeader>
        {link ? (
          <div className="grid gap-2">
            <Input
              readOnly
              value={link}
              className="font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button onClick={() => void copy()}>
              {copied ? 'Скопировано' : 'Скопировать ссылку'}
            </Button>
          </div>
        ) : (
          <DrawerFooter>
            <Button onClick={() => void generate()} loading={busy}>
              Создать ссылку-приглашение
            </Button>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  )
}
