import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface ActionMenuItem {
  key: string
  label: string
  icon?: ReactNode
  /** Подстрока-пояснение под названием пункта. */
  sub?: string
  danger?: boolean
  /** Переход: пункт рендерится ссылкой через asChild, как в доке shadcn. */
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

/**
 * Меню действий — стандартный DropdownMenu shadcn, без надстроек.
 *
 * Раньше на телефоне подменялось шторкой vaul: она держит на body
 * pointer-events: none, и при переходе во время закрытия страница залипала,
 * а сами переходы терялись. Поэтому подача одна на все размеры экрана,
 * а «крупно на телефоне» решается классами.
 */
export function ActionMenu({
  trigger,
  caption,
  entries,
}: {
  trigger: ReactNode
  /** Контекст в шапке меню, например название книги. */
  caption?: string
  entries: Array<ActionMenuEntry>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[248px] p-1.5">
        {caption && (
          <DropdownMenuLabel className="truncate text-muted-foreground">
            {caption}
          </DropdownMenuLabel>
        )}
        {entries.map((entry, index) =>
          entry === 'separator' ? (
            <DropdownMenuSeparator key={`sep-${index}`} />
          ) : isCustom(entry) ? (
            <div key={entry.key} className="px-1 py-1.5">
              {entry.custom}
            </div>
          ) : (
            <MenuRow key={entry.key} entry={entry} />
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const ROW = 'min-h-11 gap-3 px-2.5 text-[15px]'

function MenuRow({ entry }: { entry: ActionMenuItem }) {
  const body = (
    <>
      {entry.icon}
      <span className="min-w-0">
        {entry.label}
        {entry.sub && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {entry.sub}
          </span>
        )}
      </span>
    </>
  )

  if (entry.to) {
    return (
      <DropdownMenuItem
        variant={entry.danger ? 'destructive' : 'default'}
        className={ROW}
        asChild
      >
        <Link
          to={entry.to as never}
          params={entry.params as never}
          search={(entry.search ?? {}) as never}
        >
          {body}
        </Link>
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuItem
      variant={entry.danger ? 'destructive' : 'default'}
      className={ROW}
      onSelect={entry.onSelect}
    >
      {body}
    </DropdownMenuItem>
  )
}
