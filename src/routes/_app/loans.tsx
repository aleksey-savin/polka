import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { plural } from '@/lib/plural'
import { listLoansFn, returnLoanFn } from '@/server/loans'
import { spineFor } from '@/services/spine'

export const Route = createFileRoute('/_app/loans')({
  validateSearch: z.object({ tab: z.enum(['active', 'history']).optional() }),
  loaderDeps: ({ search }) => ({ tab: search.tab ?? 'active' }),
  loader: ({ deps }) => listLoansFn({ data: { kind: deps.tab } }),
  component: LoansPage,
})

const dateRu = (value: Date | string | null) =>
  value ? new Date(value).toLocaleDateString('ru-RU') : ''

function LoansPage() {
  const loans = Route.useLoaderData()
  const { tab = 'active' } = Route.useSearch()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function markReturned(loanId: string) {
    setBusyId(loanId)
    try {
      await returnLoanFn({ data: { loanId } })
      await router.invalidate()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-3xl font-semibold">На руках</h1>
        {tab === 'active' && loans.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground">
            <b className="font-medium text-foreground">{loans.length}</b>{' '}
            {plural(
              loans.length,
              'книга у читателей',
              'книги у читателей',
              'книг у читателей',
            )}
          </span>
        )}
      </div>

      <nav className="mt-4 mb-5 flex gap-1 border-b">
        <Link
          to="/loans"
          search={{ tab: 'active' }}
          className={
            tab === 'active'
              ? '-mb-px border-b-2 border-primary px-3.5 py-2 text-sm font-semibold text-accent-foreground'
              : 'px-3.5 py-2 text-sm font-semibold text-muted-foreground'
          }
        >
          Сейчас
        </Link>
        <Link
          to="/loans"
          search={{ tab: 'history' }}
          className={
            tab === 'history'
              ? '-mb-px border-b-2 border-primary px-3.5 py-2 text-sm font-semibold text-accent-foreground'
              : 'px-3.5 py-2 text-sm font-semibold text-muted-foreground'
          }
        >
          История
        </Link>
      </nav>

      {loans.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {tab === 'active'
              ? 'Все книги дома. «Дать почитать» — на карточке любой книги.'
              : 'История возвратов пока пуста.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {loans.map((l) => {
            const look = spineFor(l.bookTitle, l.bookPages)
            return (
              <Card key={l.loanId}>
                <CardContent className="flex flex-wrap items-center gap-4 py-3.5">
                  <div
                    aria-hidden
                    className="grid h-[74px] w-[30px] flex-none place-items-center rounded-[3px]"
                    style={{
                      background: look.color,
                      boxShadow:
                        'inset -1px 0 0 rgba(35,43,56,.1), inset 1px 0 0 rgba(255,255,255,.35)',
                    }}
                  />
                  <div className="min-w-40 flex-1">
                    <div className="flex items-center gap-2.5">
                      <b className="text-base">{l.borrowerName}</b>
                      {l.overdue && (
                        <span className="inline-block -rotate-2 rounded border-2 border-destructive px-1.5 font-mono text-[10px] font-medium tracking-widest text-destructive uppercase">
                          Просрочено
                        </span>
                      )}
                    </div>
                    <Link
                      to="/books/$bookId"
                      params={{ bookId: l.bookId }}
                      className="text-[13.5px] text-muted-foreground hover:text-foreground"
                    >
                      {l.bookTitle}
                      {l.bookAuthors && ` · ${l.bookAuthors}`}
                    </Link>
                  </div>
                  <div className="grid justify-items-end gap-0.5 font-mono text-xs text-muted-foreground">
                    <span>
                      {tab === 'active' ? 'взял' : 'брал'} {dateRu(l.lentAt)}
                    </span>
                    {l.returnedAt ? (
                      <span>вернул {dateRu(l.returnedAt)}</span>
                    ) : l.dueAt ? (
                      <span>вернуть к {dateRu(l.dueAt)}</span>
                    ) : (
                      <span>срок не задан</span>
                    )}
                  </div>
                  {tab === 'active' && (
                    <Button
                      variant="outline"
                      disabled={busyId === l.loanId}
                      onClick={() => void markReturned(l.loanId)}
                    >
                      Вернули
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
