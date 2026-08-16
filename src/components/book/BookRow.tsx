import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { EyeOff } from 'lucide-react'

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
  selected = false,
  onPress,
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
    hidden?: boolean
    /** Болванка из сканера: название — сам ISBN (M18). */
    unrecognized?: boolean
  }
  place?: string | null
  before?: ReactNode
  after?: ReactNode
  /** Подсветка в режиме массового выбора. */
  selected?: boolean
  /** Режим выбора: вся карточка — одна кнопка, ссылка на книгу выключена. */
  onPress?: () => void
}) {
  const look = spineFor(book.title, book.pages ?? null)
  const hasMeta = Boolean(
    place ||
    book.seriesName ||
    book.year ||
    after ||
    book.lentTo ||
    book.hidden ||
    book.unrecognized ||
    (book.status && STATUS_LABEL[book.status]),
  )
  return (
    <div
      role={onPress ? 'button' : undefined}
      tabIndex={onPress ? 0 : undefined}
      onClick={onPress}
      onKeyDown={
        onPress
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPress()
              }
            }
          : undefined
      }
      className={`flex min-w-0 gap-3 rounded-lg border px-3.5 py-2.5 shadow-xs ${
        selected ? 'border-primary/45 bg-accent/50' : 'bg-card'
      } ${onPress ? 'cursor-pointer select-none' : ''}`}
    >
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
        {onPress ? (
          <span className="block text-base leading-snug font-semibold">
            {book.title}
          </span>
        ) : (
          <Link
            to="/books/$bookId"
            params={{ bookId: book.id }}
            className={`block leading-snug font-semibold hover:underline ${
              book.unrecognized ? 'font-mono text-[15px]' : 'text-base'
            }`}
          >
            {book.title}
          </Link>
        )}
        {book.authors && (
          <span className="block truncate text-[13px] text-muted-foreground">
            {book.authors}
          </span>
        )}
        {hasMeta && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
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
            {book.unrecognized && (
              <span className="inline-block rounded-[3px] border-[1.5px] border-destructive/70 px-1 font-mono text-[9.5px] tracking-[0.07em] text-destructive uppercase">
                не распознана
              </span>
            )}
            {book.hidden && (
              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                title="Видна только владельцам библиотеки"
              >
                <EyeOff className="size-3.5" aria-hidden />
                скрыта
              </span>
            )}
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
