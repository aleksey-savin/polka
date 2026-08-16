import { Link } from '@tanstack/react-router'
import { Heart, Layers } from 'lucide-react'

import type { ListBadge } from '@/services/lists'

/** Где книга состоит: чипы вишлистов и подборок со ссылкой на список. */
export function ListBadges({
  lists,
  className = '',
}: {
  lists: Array<ListBadge>
  className?: string
}) {
  if (lists.length === 0) return null
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {lists.map((list) => (
        <Link
          key={list.id}
          to="/lists/$listId"
          params={{ listId: list.id }}
          className="flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-primary/40 bg-accent/40 px-2.5 py-1 text-[12.5px] font-medium text-accent-foreground"
        >
          {list.kind === 'wishlist' ? (
            <Heart aria-hidden className="size-3.5 flex-none" />
          ) : (
            <Layers aria-hidden className="size-3.5 flex-none" />
          )}
          <span className="truncate">{list.title}</span>
        </Link>
      ))}
    </div>
  )
}
