import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { createBookFn } from '@/server/books'
import type { CycleMember, CycleView } from '@/services/cycles'

/**
 * Шторка цикла: произведения по порядку чтения.
 * В строке две независимые оси — чтение (штамп) и наличие (подпись + «В Хочу»).
 * Прочитать можно и не владея книгой, поэтому кнопка живёт по наличию.
 * Вглубь — только страницами: шторки над шторками в приложении нет.
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
  onNavigate,
  onChanged,
}: {
  member: CycleMember
  authorName: string | null
  /** Закрыть шторку перед уходом на страницу (на карточке книги не нужно). */
  onNavigate?: () => void
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

  const target = member.bookId
    ? ({ to: '/books/$bookId', params: { bookId: member.bookId } } as const)
    : ({ to: '/works/$workId', params: { workId: member.workId } } as const)

  return (
    <div className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0">
      <Link
        {...target}
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-2.5"
      >
        <span className="w-[26px] flex-none font-mono text-[11.5px] text-muted-foreground">
          #{member.position}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm ${
              member.current
                ? 'font-semibold text-accent-foreground'
                : 'font-medium'
            }`}
          >
            {member.title}
            {member.current && ' — вы здесь'}
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {member.year && (
              <span className="font-mono text-[11px]">{member.year}</span>
            )}
            {member.year && (member.place || !member.owned) && ' · '}
            {member.place ?? (member.owned ? '' : 'нет в библиотеке')}
          </span>
        </span>
      </Link>
      {member.reading && <ReadingStamp value={member.reading} />}
      {!member.owned && !member.wished && (
        <Button
          size="sm"
          variant="outline"
          className="flex-none text-accent-foreground"
          loading={busy}
          onClick={() => void wish()}
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
  const readShare = cycle.total > 0 ? cycle.readCount / cycle.total : 0
  const stats = [
    `прочитано ${cycle.readCount} из ${cycle.total}`,
    `на полках ${cycle.ownedCount}`,
    cycle.wishedCount > 0 ? `в «Хочу» ${cycle.wishedCount}` : null,
  ].filter(Boolean)

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[86dvh] gap-0 p-0">
        <DrawerHeader className="px-4 pt-1 pb-2.5">
          <DrawerTitle className="truncate text-[19px] font-semibold">
            {cycle.title}
          </DrawerTitle>
          <DrawerDescription className="truncate text-[12.5px]">
            цикл{cycle.authorName && ` · ${cycle.authorName}`}
          </DrawerDescription>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${Math.round(readShare * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">
            {stats.join(' · ')}
          </p>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {cycle.members.map((m) => (
            <CycleRow
              key={m.workId}
              member={m}
              authorName={cycle.authorName}
              onNavigate={onClose}
              onChanged={onChanged}
            />
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
