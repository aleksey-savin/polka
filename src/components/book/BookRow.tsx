import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { Badge } from '@/components/ui/badge'
import { spineFor } from '@/services/spine'

const STATUS_LABEL: Record<string, string> = {
  wishlist: 'Хочу',
  gifted: 'Подарена',
  lost: 'Потеряна',
}

/** Строка книги в списках (каталог, полка, серия). */
export function BookRow({
  book,
  place,
  before,
  after,
}: {
  book: {
    id: string
    title: string
    authors: string
    year: number | null
    pages?: number | null
    status?: string
    seriesName?: string | null
    coverPath?: string | null
    lentTo?: string | null
  }
  place?: string | null
  before?: ReactNode
  after?: ReactNode
}) {
  const look = spineFor(book.title, book.pages ?? null)
  return (
    <div className="flex items-center gap-3.5 rounded-lg border bg-card px-3.5 py-2.5 shadow-xs">
      {before}
      {book.coverPath ? (
        <img
          src={`/api/covers/${book.id}`}
          alt=""
          className="h-16 w-[42px] flex-none rounded-[3px] object-cover shadow-sm"
        />
      ) : (
        <div
          aria-hidden
          className="h-16 w-[26px] flex-none rounded-[3px]"
          style={{
            background: look.color,
            boxShadow:
              'inset -1px 0 0 rgba(35,43,56,.1), inset 1px 0 0 rgba(255,255,255,.35)',
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        <Link
          to="/books/$bookId"
          params={{ bookId: book.id }}
          className="text-base font-semibold hover:underline"
        >
          {book.title}
        </Link>
        <span className="block truncate text-[13px] text-muted-foreground">
          {book.authors}
        </span>
      </div>
      {place && (
        <span className="hidden text-xs whitespace-nowrap text-muted-foreground sm:block">
          {place}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {book.lentTo && (
          <span
            title={`У «${book.lentTo}»`}
            className="inline-block -rotate-2 rounded border-2 border-stamp px-1.5 font-mono text-[10px] font-medium tracking-widest text-stamp uppercase"
          >
            На руках
          </span>
        )}
        {book.seriesName && (
          <Badge variant="outline" className="border-stamp/30 text-stamp">
            {book.seriesName}
          </Badge>
        )}
        {book.status && STATUS_LABEL[book.status] && (
          <Badge variant="secondary">{STATUS_LABEL[book.status]}</Badge>
        )}
        {book.year && (
          <span className="font-mono text-xs text-muted-foreground">
            {book.year}
          </span>
        )}
        {after}
      </div>
    </div>
  )
}
