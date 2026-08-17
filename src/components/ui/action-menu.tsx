import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Link, useRouter } from '@tanstack/react-router'

import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
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
  /** Переход: выполняется после закрытия шторки, как и любое действие. */
  to?: string
  params?: Record<string, string>
  search?: Record<string, unknown>
  onSelect?: () => void
}
/** Произвольный элемент в меню — например переключатель темы (M23). */
export interface ActionMenuCustom {
  key: string
  custom: ReactNode
}
export type ActionMenuEntry = ActionMenuItem | ActionMenuCustom | 'separator'

const isCustom = (entry: ActionMenuEntry): entry is ActionMenuCustom =>
  entry !== 'separator' && 'custom' in entry

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
  // Переход выполняем после полного закрытия: vaul оставляет на body
  // pointer-events: none, пока идёт анимация, и переход «проглатывается».
  const [pending, setPending] = useState<(() => void) | null>(null)

  if (!isMobile) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {entries.map((entry, i) =>
            entry === 'separator' ? (
              <DropdownMenuSeparator key={`sep-${i}`} />
            ) : isCustom(entry) ? (
              <div key={entry.key} className="flex px-1.5 py-1">
                {entry.custom}
              </div>
            ) : (
              <DropdownMenuItem
                key={entry.key}
                className={entry.danger ? 'text-destructive' : undefined}
                asChild={Boolean(entry.to)}
                onSelect={entry.to ? undefined : entry.onSelect}
              >
                {entry.to ? (
                  <Link
                    to={entry.to as never}
                    params={entry.params as never}
                    search={(entry.search ?? {}) as never}
                  >
                    {entry.icon}
                    {entry.label}
                  </Link>
                ) : (
                  <>
                    {entry.icon}
                    {entry.label}
                  </>
                )}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next && pending) {
          const run = pending
          setPending(null)
          // ждём конца анимации закрытия, иначе клик уходит в никуда
          setTimeout(run, 220)
        }
      }}
    >
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent
        aria-describedby={undefined}
        className="gap-1 px-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      >
        <DrawerTitle className="sr-only">Действия</DrawerTitle>
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
          ) : isCustom(entry) ? (
            <div key={entry.key} className="flex px-2 py-1.5">
              {entry.custom}
            </div>
          ) : (
            <MobileRow
              key={entry.key}
              entry={entry}
              onRun={(run) => {
                setPending(() => run)
                setOpen(false)
              }}
            />
          ),
        )}
      </DrawerContent>
    </Drawer>
  )
}

/**
 * Строка мобильной шторки. И переход, и действие выполняются одинаково —
 * после закрытия: ссылка внутри закрывающейся шторки теряет клик так же,
 * как программная навигация.
 */
function MobileRow({
  entry,
  onRun,
}: {
  entry: ActionMenuItem
  onRun: (run: () => void) => void
}) {
  const router = useRouter()
  const className = `flex min-h-[52px] w-full items-center gap-3.5 rounded-xl px-3 text-left text-[16px] font-medium active:bg-background [&_svg]:size-[21px] [&_svg]:flex-none ${
    entry.danger ? 'text-destructive' : '[&_svg]:text-muted-foreground'
  }`
  const body = (
    <>
      {entry.icon}
      <span className="min-w-0">
        {entry.label}
        {entry.sub && (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            {entry.sub}
          </span>
        )}
      </span>
    </>
  )

  return (
    <button
      type="button"
      className={className}
      onClick={() => onRun(() => runEntry(entry, router))}
    >
      {body}
    </button>
  )
}

/** Пункт делает одно из двух: уводит на страницу или запускает действие. */
function runEntry(entry: ActionMenuItem, router: ReturnType<typeof useRouter>) {
  if (entry.to) {
    void router.navigate({
      to: entry.to as never,
      params: entry.params as never,
      search: (entry.search ?? {}) as never,
    })
    return
  }
  entry.onSelect?.()
}
