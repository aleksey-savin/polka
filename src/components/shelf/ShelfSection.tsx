import type { ReactNode } from 'react'

import { Spine } from './Spine'
import { ShelfBoard } from './ShelfBoard'

export interface ShelfSectionBook {
  id: string
  title: string
  authors: string
  pages: number | null
  lentTo?: string | null
  coverColor?: string | null
}

/** Секция полки: заголовок с легендой, ряд корешков, доска. */
export function ShelfSection({
  name,
  meta,
  boardColor,
  books,
  actions,
  emptyHint,
}: {
  name?: string
  meta?: ReactNode
  boardColor: string
  books: Array<ShelfSectionBook>
  actions?: ReactNode
  emptyHint?: string
}) {
  return (
    <section className="mt-8 first:mt-2">
      {(name || meta) && (
        <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          {name && <h2 className="text-[21px] font-semibold">{name}</h2>}
          {meta && (
            <span className="font-mono text-xs text-muted-foreground">
              {meta}
            </span>
          )}
        </div>
      )}
      <div className="shelf-books flex min-h-[150px] items-end gap-[3px] overflow-x-auto px-3.5">
        {books.length === 0 ? (
          <p className="pb-4 text-sm text-muted-foreground">
            {emptyHint ?? 'На этой полке пока пусто.'}
          </p>
        ) : (
          books.map((b) => (
            <Spine
              key={b.id}
              bookId={b.id}
              title={b.title}
              authors={b.authors}
              pages={b.pages}
              lentTo={b.lentTo}
              coverColor={b.coverColor}
            />
          ))
        )}
      </div>
      <ShelfBoard color={boardColor} />
      {actions && (
        <div className="flex justify-between px-3.5 pt-2">{actions}</div>
      )}
    </section>
  )
}
