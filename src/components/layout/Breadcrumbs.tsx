import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/** Одна ступень пути. Без `to` — текущая страница, она не ссылка. */
export interface Crumb {
  label: ReactNode
  to?: string
  params?: Record<string, string>
  search?: Record<string, unknown>
}

/**
 * Хлебные крошки — один компонент на все страницы.
 *
 * Раньше каждая страница верстала их заново: где-то они были, где-то нет, и
 * из карточки книги было непонятно, откуда пришёл. Путь строится от места
 * книги (библиотека → полка) или от того списка, откуда пришли (`useOrigin`).
 */
export function Breadcrumbs({ items }: { items: Array<Crumb> }) {
  const shown = items.filter(Boolean)
  if (shown.length === 0) return null
  return (
    <nav
      aria-label="Где я"
      className="mb-4 overflow-hidden text-[13px] whitespace-nowrap text-ellipsis text-muted-foreground"
    >
      {shown.map((crumb, index) => (
        <span key={index}>
          {index > 0 && <span aria-hidden> / </span>}
          {crumb.to ? (
            <Link
              // роутер типизирует пути строго, а крошки собираются из данных
              to={crumb.to as never}
              params={crumb.params as never}
              search={(crumb.search ?? {}) as never}
              className="hover:text-foreground"
            >
              {crumb.label}
            </Link>
          ) : (
            <span aria-current="page">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
