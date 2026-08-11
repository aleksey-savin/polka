import { Link } from '@tanstack/react-router'

import { spineFor, textToneFor } from '@/services/spine'

/** Корешок книги на полке: текст снизу вверх (отечественный стандарт). */
export function Spine({
  bookId,
  title,
  authors,
  pages,
  lentTo,
  coverColor,
}: {
  bookId: string
  title: string
  authors?: string
  pages?: number | null
  /** Книга на руках — корешок «вынут»: наклон и полупрозрачность. */
  lentTo?: string | null
  /** Акцентный цвет обложки — если есть, красит корешок. */
  coverColor?: string | null
}) {
  const look = spineFor(title, pages)
  const color = coverColor ?? look.color
  const darkBg = coverColor ? textToneFor(coverColor) === 'light' : look.dark
  const label = authors ? `${lastName(authors)} · ${title}` : title
  return (
    <Link
      to="/books/$bookId"
      params={{ bookId }}
      title={lentTo ? `${title} — на руках у «${lentTo}»` : title}
      className={
        lentTo
          ? 'group relative mx-[7px] flex-none -translate-y-2 -rotate-6 rounded-t-[3px] rounded-b-[1px] opacity-50 transition-transform hover:-translate-y-3'
          : 'group relative flex-none rounded-t-[3px] rounded-b-[1px] transition-transform hover:-translate-y-1.5 focus-visible:-translate-y-1.5'
      }
      style={{
        width: look.width,
        height: look.height,
        background: color,
        boxShadow:
          'inset -1px 0 0 rgba(35,43,56,.10), inset 1px 0 0 rgba(255,255,255,.35), inset 0 -1px 0 rgba(35,43,56,.06)',
      }}
    >
      <span
        className="absolute inset-0 grid place-items-center overflow-hidden font-display text-xs font-medium whitespace-nowrap"
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: darkBg ? 'rgba(255,255,255,.9)' : 'rgba(35,43,56,.82)',
        }}
      >
        <span className="max-h-[92%] overflow-hidden">{label}</span>
      </span>
    </Link>
  )
}

function lastName(authors: string): string {
  const first = authors.split(/[;,]/)[0]?.trim() ?? ''
  const parts = first.split(/\s+/)
  return parts[parts.length - 1] ?? first
}
