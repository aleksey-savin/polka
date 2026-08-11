import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { EyeOff } from 'lucide-react'

import { SectionLabel } from '@/components/layout/SectionLabel'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { dateHuman, dateShort } from '@/lib/dates'
import { plural } from '@/lib/plural'
import { getReadingHubFn } from '@/server/reading'
import { returnLoanFn } from '@/server/loans'
import { spineFor } from '@/services/spine'

export const Route = createFileRoute('/_app/reading')({
  loader: () => getReadingHubFn(),
  component: ReadingPage,
})

function ReadingPage() {
  const hub = Route.useLoaderData()
  const router = useRouter()
  const [returningId, setReturningId] = useState<string | null>(null)

  async function returnLoan(loanId: string) {
    setReturningId(loanId)
    try {
      await returnLoanFn({ data: { loanId } })
      toast.success('Вернули — книга снова дома')
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setReturningId(null)
    }
  }

  const empty =
    hub.reading.length === 0 &&
    hub.loans.length === 0 &&
    hub.wishlistTotal === 0 &&
    hub.yearCount === 0

  return (
    <div className="mx-auto max-w-[640px]">
      <h1 className="text-3xl font-semibold">Чтение</h1>

      {empty && (
        <Card className="mt-5">
          <CardContent className="grid justify-items-center gap-3 py-10 text-center text-muted-foreground">
            <p className="max-w-sm">
              Здесь соберётся ваша читательская жизнь: отметьте на карточке
              книги «Читаю», дайте книгу другу или добавьте что-нибудь в «Хочу».
            </p>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/books" search={{}}>
                  В каталог
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/add">Добавить книгу</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {hub.reading.length > 0 && (
        <section className="mt-6">
          <SectionLabel>Читаю сейчас</SectionLabel>
          <div className="flex gap-4 overflow-x-auto pb-2.5">
            {hub.reading.map((b) => {
              const look = spineFor(b.title, b.pages)
              return (
                <Link
                  key={b.id}
                  to="/books/$bookId"
                  params={{ bookId: b.id }}
                  className="w-24 flex-none"
                >
                  {b.coverPath ? (
                    <img
                      src={`/api/covers/${b.id}?v=${b.coverPath}`}
                      alt=""
                      className="aspect-[7/10] w-24 rounded-[4px] object-cover shadow-[inset_3px_0_0_rgba(255,255,255,.25),0_8px_16px_-8px_rgba(35,43,56,.5)]"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="grid aspect-[7/10] w-24 content-end overflow-hidden rounded-[4px] p-2 shadow-[0_8px_16px_-8px_rgba(35,43,56,.5)]"
                      style={{
                        background: `linear-gradient(160deg, ${b.coverColor ?? look.color}, color-mix(in oklab, ${b.coverColor ?? look.color} 70%, #232B38))`,
                        boxShadow: 'inset 3px 0 0 rgba(255,255,255,.3)',
                      }}
                    >
                      <span
                        className="font-display text-[11px] leading-tight font-bold"
                        style={{ color: 'rgba(35,43,56,.9)' }}
                      >
                        {b.title}
                      </span>
                    </span>
                  )}
                  <p className="mt-2 line-clamp-2 text-[13.5px] leading-tight font-semibold">
                    {b.hidden && (
                      <EyeOff
                        aria-label="Скрыта от гостей"
                        className="mr-1 inline size-3.5 text-muted-foreground"
                      />
                    )}
                    {b.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {b.authors}
                  </p>
                  {b.since && (
                    <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                      с {dateHuman(b.since)}
                    </p>
                  )}
                </Link>
              )
            })}
          </div>
          {/* полочная линия под читаемыми */}
          <div
            aria-hidden
            className="-mt-1 mb-1 h-1 rounded-full"
            style={{
              background:
                'linear-gradient(to right, var(--patina-old), var(--patina-fresh))',
              boxShadow: '0 3px 6px -2px rgba(35,43,56,.22)',
            }}
          />
        </section>
      )}

      {hub.loans.length > 0 && (
        <section className="mt-7">
          <SectionLabel
            trailing={
              <Link
                to="/loans"
                className="font-sans text-[12.5px] font-medium tracking-normal normal-case text-accent-foreground"
              >
                Вся история →
              </Link>
            }
          >
            На руках <span className="text-stamp">· {hub.loans.length}</span>
          </SectionLabel>
          <div>
            {hub.loans.map((l) => {
              const look = spineFor(l.bookTitle, l.bookPages)
              return (
                <div
                  key={l.loanId}
                  className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
                >
                  <span
                    aria-hidden
                    className="h-10 w-[26px] flex-none rounded-[3px]"
                    style={{
                      background: look.color,
                      boxShadow:
                        'inset 1.5px 0 0 rgba(255,255,255,.35), inset -1px 0 0 rgba(35,43,56,.15)',
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/books/$bookId"
                      params={{ bookId: l.bookId }}
                      className="block truncate text-sm font-semibold hover:underline"
                    >
                      {l.bookTitle}
                    </Link>
                    <p className="text-[12.5px] text-muted-foreground">
                      у «{l.borrowerName}» · с{' '}
                      <span className="font-mono text-xs">
                        {dateShort(l.lentAt)}
                      </span>
                      {l.dueAt && (
                        <span className={l.overdue ? 'text-destructive' : ''}>
                          {' '}
                          · вернуть к{' '}
                          <span className="font-mono text-xs">
                            {dateShort(l.dueAt)}
                          </span>
                        </span>
                      )}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    loading={returningId === l.loanId}
                    onClick={() => void returnLoan(l.loanId)}
                  >
                    Вернули
                  </Button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {hub.wishlistTotal > 0 && (
        <section className="mt-7">
          <SectionLabel
            trailing={
              <Link
                to="/wishlist"
                className="font-sans text-[12.5px] font-medium tracking-normal normal-case text-accent-foreground"
              >
                Весь список →
              </Link>
            }
          >
            Хочу <span className="text-stamp">· {hub.wishlistTotal}</span>
          </SectionLabel>
          <div>
            {hub.wishlistHead.map((b) => (
              <Link
                key={b.id}
                to="/books/$bookId"
                params={{ bookId: b.id }}
                className="flex items-baseline gap-2 border-t py-2 first:border-t-0"
              >
                <span className="truncate text-sm font-semibold">
                  {b.title}
                </span>
                <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                  {b.authors}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {hub.yearCount > 0 && (
        <section className="mt-7">
          <SectionLabel>Прочитано в {hub.year}</SectionLabel>
          <Link
            to="/books"
            search={{ reading: 'read' }}
            className="flex items-center gap-3.5 rounded-xl border bg-card px-4 py-3"
          >
            <span className="font-mono text-[26px] font-medium text-accent-foreground">
              {hub.yearCount}
            </span>
            <span className="min-w-0 flex-1 text-[13.5px] text-muted-foreground">
              <b className="font-semibold text-foreground">
                {plural(hub.yearCount, 'книга', 'книги', 'книг')} за год
              </b>
              {hub.yearAvgRating !== null && (
                <>
                  {' '}
                  · средняя оценка <span className="text-[#C9A23B]">
                    ★
                  </span>{' '}
                  {hub.yearAvgRating.toLocaleString('ru-RU', {
                    maximumFractionDigits: 1,
                  })}
                </>
              )}
            </span>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
          </Link>
        </section>
      )}
    </div>
  )
}
