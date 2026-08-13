import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { WorkSheet } from '@/components/book/WorkSheet'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { createBookFn } from '@/server/books'
import { plural } from '@/lib/plural'
import type { CycleMember, CycleView } from '@/services/cycles'

/**
 * Шторка цикла: произведения по порядку чтения.
 * В строке две независимые оси — чтение (штамп) и наличие (подпись + «В Хочу»).
 * Прочитать можно и не владея книгой, поэтому кнопка живёт по наличию.
 */

/** Штамп чтения — общий для шторки и секции «Цикл» на карточке книги. */
export function ReadingStamp({ value }: { value: 'read' | 'reading' }) {
  return (
    <span
      className={`flex-none rounded-[3px] border-[1.5px] px-1.5 py-px font-mono text-[9.5px] tracking-[0.07em] uppercase ${
        value === 'read'
          ? 'border-primary text-accent-foreground'
          : 'border-stamp text-stamp'
      }`}
    >
      {value === 'read' ? 'прочитана' : 'читаю'}
    </span>
  )
}

export function CycleRow({
  member,
  authorName,
  onOpenBook,
  onOpenWork,
  onChanged,
}: {
  member: CycleMember
  authorName: string | null
  onOpenBook: (bookId: string) => void
  onOpenWork: (workId: string) => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function wish() {
    setBusy(true)
    try {
      await createBookFn({
        data: {
          title: member.title,
          authors: authorName ?? '',
          year: member.year,
          wishlist: true,
          refWorkId: member.workId,
        },
      })
      toast.success(`«${member.title}» — в списке «Хочу»`)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  const open = () =>
    member.bookId ? onOpenBook(member.bookId) : onOpenWork(member.workId)

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex cursor-pointer items-center gap-2.5 border-t py-2.5 select-none first:border-t-0"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
    >
      <span className="w-[26px] flex-none font-mono text-[11.5px] text-muted-foreground">
        #{member.position}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm ${
            member.current
              ? 'font-semibold text-accent-foreground'
              : 'font-medium'
          }`}
        >
          {member.title}
          {member.current && ' — вы здесь'}
        </p>
        <p className="truncate text-[11.5px] text-muted-foreground">
          {member.year && (
            <span className="font-mono text-[11px]">{member.year}</span>
          )}
          {member.year && (member.place || !member.owned) && ' · '}
          {member.place ?? (member.owned ? '' : 'нет в библиотеке')}
        </p>
      </div>
      {member.reading && <ReadingStamp value={member.reading} />}
      {!member.owned && !member.wished && (
        <Button
          size="sm"
          variant="outline"
          className="flex-none text-accent-foreground"
          loading={busy}
          onClick={(e) => {
            e.stopPropagation()
            void wish()
          }}
        >
          В Хочу
        </Button>
      )}
      <span aria-hidden className="flex-none text-muted-foreground">
        ›
      </span>
    </div>
  )
}

export function CycleSheet({
  cycle,
  open,
  onClose,
  onChanged,
}: {
  cycle: CycleView
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [workId, setWorkId] = useState<string | null>(null)

  const readShare = cycle.total > 0 ? cycle.readCount / cycle.total : 0
  const stats = [
    `${cycle.total} ${plural(cycle.total, 'произведение', 'произведения', 'произведений')}`,
    `прочитано ${cycle.readCount}`,
    `на полках ${cycle.ownedCount}`,
    cycle.wishedCount > 0 ? `в «Хочу» ${cycle.wishedCount}` : null,
  ].filter(Boolean)

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          aria-describedby={undefined}
          className="grid max-h-[86dvh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-md"
        >
          <div className="px-4 pt-2 pb-2.5">
            <DialogTitle className="text-[19px] font-semibold">
              {cycle.title}
            </DialogTitle>
            <p className="font-mono text-[11.5px] text-muted-foreground">
              цикл · {stats.join(' · ')}
              {cycle.authorName && ` · ${cycle.authorName}`}
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${Math.round(readShare * 100)}%` }}
              />
            </div>
          </div>
          <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {cycle.members.map((m) => (
              <CycleRow
                key={m.workId}
                member={m}
                authorName={cycle.authorName}
                onOpenBook={(bookId) => {
                  onClose()
                  void navigate({ to: '/books/$bookId', params: { bookId } })
                }}
                onOpenWork={setWorkId}
                onChanged={onChanged}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <WorkSheet
        workId={workId}
        onClose={() => setWorkId(null)}
        onChanged={onChanged}
      />
    </>
  )
}
