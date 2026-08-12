import { Link } from '@tanstack/react-router'

import { fitSpineText, spineFor, textToneFor } from '@/services/spine'
import type { CoverType } from '@/services/spine'

const BINDING_CLASS: Record<CoverType, string> = {
  soft: 'spine-soft rounded-[2px]',
  hard: 'spine-hard',
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
  giftEdition,
  lentTo,
  coverColor,
}: {
  bookId: string
  title: string
  authors?: string
  pages?: number | null
  heightMm?: number | null
  coverType?: CoverType | null
  giftEdition?: boolean
  /** Книга на руках — корешок «вынут»: наклон и полупрозрачность. */
  lentTo?: string | null
  /** Акцентный цвет обложки — если есть, красит корешок. */
  coverColor?: string | null
}) {
  const look = spineFor(title, pages, { heightMm, coverType, giftEdition })
  const color = coverColor ?? look.color
  const darkBg = coverColor ? textToneFor(coverColor) === 'light' : look.dark
  const author = authors ? lastName(authors) : ''
  // на толстом корешке автор и название — двумя вертикальными строками
  const twoLines = Boolean(author) && look.width >= 30
  const textSpace = look.height - 12
  const titleFit = fitSpineText(
    twoLines || !author ? title : `${author} · ${title}`,
    textSpace,
  )
  const authorFit = twoLines ? fitSpineText(author, textSpace, 10, 8) : null
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
      <span
        className="absolute inset-0 grid place-items-center overflow-hidden font-display text-xs font-medium whitespace-nowrap"
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          color: darkBg ? 'rgba(255,255,255,.9)' : 'rgba(35,43,56,.82)',
        }}
      >
        {twoLines && authorFit ? (
          <span className="flex max-h-[96%] flex-col items-center gap-[2px] overflow-hidden">
            <span
              className="block leading-[1.15] font-normal opacity-75"
              style={{ fontSize: authorFit.fontSize }}
            >
              {authorFit.text}
            </span>
            <span
              className="block leading-[1.15]"
              style={{ fontSize: titleFit.fontSize }}
            >
              {titleFit.text}
            </span>
          </span>
        ) : (
          <span
            className="block max-h-[96%] overflow-hidden leading-[1.15]"
            style={{ fontSize: titleFit.fontSize }}
          >
            {titleFit.text}
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
