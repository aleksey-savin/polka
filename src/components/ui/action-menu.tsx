import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

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
  /**
   * Переход — ссылкой, а не программной навигацией: клик по кнопке совпадал
   * с закрытием шторки, и на тяжёлых страницах переход терялся.
   */
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
    <Drawer open={open} onOpenChange={setOpen}>
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
              onDone={() => setOpen(false)}
            />
          ),
        )}
      </DrawerContent>
    </Drawer>
  )
}

/** Строка мобильной шторки: переход — ссылкой, действие — кнопкой. */
function MobileRow({
  entry,
  onDone,
}: {
  entry: ActionMenuItem
  onDone: () => void
}) {
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

  if (entry.to) {
    return (
      <Link
        to={entry.to as never}
        params={entry.params as never}
        search={(entry.search ?? {}) as never}
        className={className}
        onClick={onDone}
      >
        {body}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onDone()
        // шторка закрывается с анимацией — действие ждёт кадр, иначе
        // vaul успевает погасить клики на странице
        requestAnimationFrame(() => entry.onSelect?.())
      }}
    >
      {body}
    </button>
  )
}
