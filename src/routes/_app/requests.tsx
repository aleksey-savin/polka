import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { plural } from '@/lib/plural'
import {
  approveRequestFn,
  declineRequestFn,
  listPendingRequestsFn,
} from '@/server/shares'

export const Route = createFileRoute('/_app/requests')({
  loader: () => listPendingRequestsFn(),
  component: RequestsPage,
})

function RequestsPage() {
  const requests = Route.useLoaderData()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(requestId: string, action: 'approve' | 'decline') {
    setBusyId(requestId)
    setError(null)
    try {
      if (action === 'approve') await approveRequestFn({ data: { requestId } })
      else await declineRequestFn({ data: { requestId } })
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-3xl font-semibold">Заявки</h1>
        {requests.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground">
            <b className="font-medium text-foreground">{requests.length}</b>{' '}
            {plural(
              requests.length,
              'ждёт ответа',
              'ждут ответа',
              'ждут ответа',
            )}
          </span>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-5 grid gap-2.5">
        {requests.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Заявок нет. Они появляются, когда кто-то нажимает «Хочу почитать»
              на витрине вашей ссылки из «Друзей».
            </CardContent>
          </Card>
        ) : (
          requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-wrap items-center gap-3.5 py-3.5">
                <div className="min-w-48 flex-1">
                  <b className="text-base">{r.guestName}</b>{' '}
                  <span className="text-sm text-muted-foreground">просит</span>{' '}
                  <Link
                    to="/books/$bookId"
                    params={{ bookId: r.bookId }}
                    className="font-semibold hover:underline"
                  >
                    «{r.bookTitle}»
                  </Link>
                  {r.note && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      «{r.note}»
                    </p>
                  )}
                  <span className="mt-0.5 block font-mono text-[11.5px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString('ru-RU')}
                    {r.place && ` · ${r.place}`}
                    {r.bookOnLoan && ' · книга сейчас на руках'}
                  </span>
                </div>
                <Button
                  disabled={busyId === r.id || r.bookOnLoan}
                  title={
                    r.bookOnLoan
                      ? 'Книга на руках — сначала возврат'
                      : undefined
                  }
                  onClick={() => void act(r.id, 'approve')}
                >
                  Одобрить — выдать
                </Button>
                <Button
                  variant="ghost"
                  disabled={busyId === r.id}
                  onClick={() => void act(r.id, 'decline')}
                >
                  Отклонить
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
