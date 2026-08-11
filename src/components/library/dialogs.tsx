import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createLibraryFn, createInviteFn } from '@/server/libraries'
import { createShelfFn } from '@/server/shelves'

export function NewLibraryDialog({
  onCreated,
}: {
  onCreated: (id: string) => void
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="text-accent-foreground">
          + библиотека
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая библиотека</DialogTitle>
          <DialogDescription>
            Физическое место, где стоят книги: дом, дача, кабинет.
          </DialogDescription>
        </DialogHeader>
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
        <DialogFooter>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!name.trim()}
          >
            Создать библиотеку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function NewShelfDialog({
  libraryId,
  onCreated,
}: {
  libraryId: string
  onCreated: () => void
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">+ Полка</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая полка</DialogTitle>
        </DialogHeader>
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
        <DialogFooter>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!name.trim()}
          >
            Создать полку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function InviteDialog({
  libraryId,
  libraryName,
}: {
  libraryId: string
  libraryName: string
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
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-sm font-semibold text-accent-foreground"
        >
          + пригласить
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Совладелец для «{libraryName}»</DialogTitle>
          <DialogDescription>
            Отправьте ссылку — человек войдёт в свой аккаунт и станет
            полноправным участником библиотеки: книги, полки и выдачи станут
            общими. Оценки и заметки у каждого останутся свои.
          </DialogDescription>
        </DialogHeader>
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
          <DialogFooter>
            <Button onClick={() => void generate()} loading={busy}>
              Создать ссылку-приглашение
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
