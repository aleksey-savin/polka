import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { Badge } from '@/components/ui/badge'
import { spineFor } from '@/services/spine'

const STATUS_LABEL: Record<string, string> = {
  wishlist: 'Хочу',
  gifted: 'Подарена',
  lost: 'Потеряна',
}

/**
 * Строка книги в списках. Мобильно-устойчивая: метаданные переносятся
 * под название, длинные чипы обрезаются — карточку распереть нельзя.
 */
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
    coverColor?: string | null
  }
  place?: string | null
  before?: ReactNode
  after?: ReactNode
}) {
  const look = spineFor(book.title, book.pages ?? null)
  const hasMeta = Boolean(place || book.seriesName || book.year || after)
  return (
    <div className="flex min-w-0 gap-3 rounded-lg border bg-card px-3.5 py-2.5 shadow-xs">
      {before && <div className="self-center">{before}</div>}
      {book.coverPath ? (
        <img
          src={`/api/covers/${book.id}`}
          alt=""
          loading="lazy"
          className="h-16 w-[42px] flex-none self-center rounded-[3px] object-cover shadow-sm"
        />
      ) : (
        <div
          aria-hidden
          className="h-16 w-[26px] flex-none self-center rounded-[3px]"
          style={{
            background: book.coverColor ?? look.color,
            boxShadow:
              'inset -1px 0 0 rgba(35,43,56,.1), inset 1px 0 0 rgba(255,255,255,.35)',
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            to="/books/$bookId"
            params={{ bookId: book.id }}
            className="min-w-0 text-base font-semibold hover:underline"
          >
            {book.title}
          </Link>
          {book.lentTo && (
            <span
              title={`У «${book.lentTo}»`}
              className="inline-block -rotate-2 rounded border-2 border-stamp px-1.5 font-mono text-[10px] font-medium tracking-widest whitespace-nowrap text-stamp uppercase"
            >
              На руках
            </span>
          )}
          {book.status && STATUS_LABEL[book.status] && (
            <Badge variant="secondary">{STATUS_LABEL[book.status]}</Badge>
          )}
        </div>
        {book.authors && (
          <span className="block truncate text-[13px] text-muted-foreground">
            {book.authors}
          </span>
        )}
        {hasMeta && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            {book.seriesName && (
              <Badge
                variant="outline"
                className="max-w-full min-w-0 border-stamp/30 text-stamp"
              >
                <span className="truncate">{book.seriesName}</span>
              </Badge>
            )}
            {book.year && (
              <span className="font-mono text-xs text-muted-foreground">
                {book.year}
              </span>
            )}
            {place && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {place}
              </span>
            )}
            {after && <span className="ml-auto">{after}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
