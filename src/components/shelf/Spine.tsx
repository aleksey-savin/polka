import { Link } from '@tanstack/react-router'

import { spineFor, textToneFor } from '@/services/spine'
import type { CoverType } from '@/services/spine'

const BINDING_CLASS: Record<CoverType, string> = {
  soft: 'spine-soft rounded-[2px]',
  hard: 'spine-hard',
  gift: 'spine-gift',
}

/**
 * Корешок книги на полке: текст снизу вверх (отечественный стандарт).
 * Толщина — страницы, высота — формат, вид — переплёт (см. spineFor).
 */
export function Spine({
  bookId,
  title,
  authors,
  pages,
  heightMm,
  coverType,
  lentTo,
  coverColor,
}: {
  bookId: string
  title: string
  authors?: string
  pages?: number | null
  heightMm?: number | null
  coverType?: CoverType | null
  /** Книга на руках — корешок «вынут»: наклон и полупрозрачность. */
  lentTo?: string | null
  /** Акцентный цвет обложки — если есть, красит корешок. */
  coverColor?: string | null
}) {
  const look = spineFor(title, pages, { heightMm, coverType })
  const color = coverColor ?? look.color
  const darkBg = coverColor ? textToneFor(coverColor) === 'light' : look.dark
  const author = authors ? lastName(authors) : ''
  // на толстом корешке автор и название — двумя вертикальными строками
  const twoLines = Boolean(author) && look.width >= 30
  const gift = coverType === 'gift'
  return (
    <Link
      to="/books/$bookId"
      params={{ bookId }}
      title={lentTo ? `${title} — на руках у «${lentTo}»` : title}
      className={`${
        lentTo
          ? 'group relative mx-[7px] flex-none -translate-y-2 -rotate-6 rounded-t-[3px] rounded-b-[1px] opacity-50 transition-transform hover:-translate-y-3'
          : 'group relative flex-none rounded-t-[3px] rounded-b-[1px] transition-transform hover:-translate-y-1.5 focus-visible:-translate-y-1.5'
      } ${coverType ? BINDING_CLASS[coverType] : ''}`}
      style={{
        width: look.width,
        height: look.height,
        background: color,
        ['--sc' as string]: color,
        boxShadow:
          'inset -1px 0 0 rgba(35,43,56,.10), inset 1px 0 0 rgba(255,255,255,.35), inset 0 -1px 0 rgba(35,43,56,.06)',
      }}
    >
      {gift && (
        <>
          <span
            aria-hidden
            className="absolute inset-x-1 top-[9px] h-px"
            style={{ background: 'rgba(201,162,84,.75)' }}
          />
          <span
            aria-hidden
            className="absolute inset-x-1 bottom-[9px] h-px"
            style={{ background: 'rgba(201,162,84,.75)' }}
          />
          <span
            aria-hidden
            className="absolute -bottom-[11px] left-1/2 h-[14px] w-[7px] -translate-x-1/2 rotate-[4deg] rounded-b-[2px]"
            style={{
              background: '#B23F38',
              clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%)',
            }}
          />
        </>
      )}
      <span
        className="absolute inset-0 grid place-items-center overflow-hidden font-display text-xs font-medium whitespace-nowrap"
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: gift
            ? '#C9A254'
            : darkBg
              ? 'rgba(255,255,255,.9)'
              : 'rgba(35,43,56,.82)',
        }}
      >
        {twoLines ? (
          <span className="flex max-h-[94%] flex-col items-center gap-[2px] overflow-hidden">
            <span className="block max-h-full overflow-hidden text-[10px] leading-[1.15] font-normal text-ellipsis opacity-75">
              {author}
            </span>
            <span className="block max-h-full overflow-hidden text-ellipsis">
              {title}
            </span>
          </span>
        ) : (
          <span className="block max-h-[94%] overflow-hidden text-ellipsis">
            {author ? `${author} · ${title}` : title}
          </span>
        )}
      </span>
    </Link>
  )
}

function lastName(authors: string): string {
  const first = authors.split(/[;,]/)[0]?.trim() ?? ''
  const parts = first.split(/\s+/)
  return parts[parts.length - 1] ?? first
}
