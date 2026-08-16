import { useState } from 'react'
import { Flag } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { reportContentFn } from '@/server/moderation'

/** Жалоба с публичной витрины (M21) — доступна и гостю без аккаунта. */

const REASONS = [
  'Запрещённая символика или экстремизм',
  'Порнография',
  'Реклама, спам, мошенничество',
  'Другое',
]

export function ReportButton({
  kind,
  targetId,
  subject,
}: {
  kind: 'share' | 'book_cover' | 'ref_work' | 'ref_book'
  targetId: string
  /** Что обжалуют — показываем в шапке шторки. */
  subject: string
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(REASONS[0]!)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function send() {
    setBusy(true)
    try {
      await reportContentFn({
        data: { kind, targetId, reason, note: note.trim() || null },
      })
      setSent(true)
      setOpen(false)
      toast.success('Жалоба отправлена — модератор посмотрит')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
        disabled={sent}
        onClick={() => setOpen(true)}
      >
        <Flag aria-hidden className="size-3.5" />
        {sent ? 'Жалоба отправлена' : 'Пожаловаться'}
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader className="pt-1">
            <DrawerTitle>Пожаловаться</DrawerTitle>
            <DrawerDescription className="truncate">{subject}</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-2">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 text-left text-sm ${
                  reason === r
                    ? 'border-destructive/45 bg-destructive/5'
                    : 'bg-card'
                }`}
                onClick={() => setReason(r)}
              >
                <span
                  aria-hidden
                  className={`grid size-[18px] flex-none place-items-center rounded-full border-[1.5px] ${
                    reason === r ? 'border-destructive' : 'border-border'
                  }`}
                >
                  {reason === r && (
                    <span className="size-2 rounded-full bg-destructive" />
                  )}
                </span>
                {r}
              </button>
            ))}
            <textarea
              rows={2}
              className="rounded-xl border bg-card px-3 py-2 text-[16px]"
              placeholder="Что не так (необязательно)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DrawerFooter>
            <Button loading={busy} onClick={() => void send()}>
              Отправить
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  )
}
