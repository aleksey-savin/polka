import { Link, createFileRoute } from '@tanstack/react-router'

import { Card, CardContent } from '@/components/ui/card'
import { plural } from '@/lib/plural'
import { listSeriesFn } from '@/server/series'

export const Route = createFileRoute('/_app/series/')({
  loader: () => listSeriesFn(),
  component: SeriesListPage,
})

function SeriesListPage() {
  const series = Route.useLoaderData()
  return (
    <div>
      <h1 className="mb-5 text-3xl font-semibold">Серии</h1>
      {series.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Серий пока нет. Укажите серию в карточке книги — она появится здесь,
            и тома соберутся по порядку.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => (
            <Link key={s.id} to="/series/$seriesId" params={{ seriesId: s.id }}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="grid gap-1 pt-5">
                  <span className="font-display text-lg font-semibold text-stamp">
                    {s.name}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {s.bookCount}{' '}
                    {plural(s.bookCount, 'книга', 'книги', 'книг')}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
