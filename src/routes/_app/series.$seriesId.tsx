import { Link, createFileRoute } from '@tanstack/react-router'

import { BookRow } from '@/components/book/BookRow'
import { plural } from '@/lib/plural'
import { getSeriesViewFn } from '@/server/series'

export const Route = createFileRoute('/_app/series/$seriesId')({
  loader: ({ params }) =>
    getSeriesViewFn({ data: { seriesId: params.seriesId } }),
  component: SeriesPage,
})

function SeriesPage() {
  const series = Route.useLoaderData()
  return (
    <div>
      <p className="mb-3.5 text-[13px] text-muted-foreground">
        <Link to="/series" className="hover:text-foreground">
          Серии
        </Link>{' '}
        / {series.name}
      </p>
      <div className="mb-5 flex flex-wrap items-baseline gap-4">
        <h1 className="text-3xl font-semibold">{series.name}</h1>
        <span className="font-mono text-xs text-muted-foreground">
          {series.books.length}{' '}
          {plural(series.books.length, 'том', 'тома', 'томов')}
        </span>
      </div>
      <div className="grid gap-2">
        {series.books.map((b) => (
          <BookRow
            key={b.id}
            book={b}
            before={
              <span className="w-10 flex-none text-center font-mono text-sm text-muted-foreground">
                {b.seriesNumber ?? '—'}
              </span>
            }
          />
        ))}
      </div>
    </div>
  )
}
