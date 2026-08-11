import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface ActionMenuItem {
  key: string
  label: string
  icon?: ReactNode
  /** Подстрока-пояснение — показывается только в мобильной шторке. */
  sub?: string
  danger?: boolean
  onSelect: () => void
}
export type ActionMenuEntry = ActionMenuItem | 'separator'

const MOBILE_QUERY = '(max-width: 639px)'
const subscribeMobile = (cb: () => void) => {
  const m = window.matchMedia(MOBILE_QUERY)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const useIsMobile = () =>
  useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  )

/**
 * Меню действий по гайдлайну: на телефоне — шторка с крупными строками,
 * на десктопе — компактный дропдаун. Один список пунктов на обе подачи.
 */
export function ActionMenu({
  trigger,
  caption,
  entries,
}: {
  trigger: ReactNode
  /** Контекст в шапке шторки, например название книги. */
  caption?: string
  entries: Array<ActionMenuEntry>
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  if (!isMobile) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {entries.map((entry, i) =>
            entry === 'separator' ? (
              <DropdownMenuSeparator key={`sep-${i}`} />
            ) : (
              <DropdownMenuItem
                key={entry.key}
                className={entry.danger ? 'text-destructive' : undefined}
                onSelect={entry.onSelect}
              >
                {entry.icon}
                {entry.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-1 px-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      >
        <DialogTitle className="sr-only">Действия</DialogTitle>
        {caption && (
          <p className="truncate px-2.5 pt-1 text-center text-[12.5px] text-muted-foreground">
            {caption}
          </p>
        )}
        {entries.map((entry, i) =>
          entry === 'separator' ? (
            <div
              key={`sep-${i}`}
              aria-hidden
              className="mx-3 my-1 h-px bg-border"
            />
          ) : (
            <button
              key={entry.key}
              type="button"
              className={`flex min-h-[52px] w-full items-center gap-3.5 rounded-xl px-3 text-left text-[16px] font-medium active:bg-background [&_svg]:size-[21px] [&_svg]:flex-none ${
                entry.danger
                  ? 'text-destructive'
                  : '[&_svg]:text-muted-foreground'
              }`}
              onClick={() => {
                setOpen(false)
                entry.onSelect()
              }}
            >
              {entry.icon}
              <span className="min-w-0">
                {entry.label}
                {entry.sub && (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {entry.sub}
                  </span>
                )}
              </span>
            </button>
          ),
        )}
      </DialogContent>
    </Dialog>
  )
}
