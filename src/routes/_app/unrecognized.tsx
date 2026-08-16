import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { dateHuman } from '@/lib/dates'
import { plural } from '@/lib/plural'
import { listUnrecognizedFn, retryLookupFn } from '@/server/unrecognized'

/** Болванки из сканера: ISBN есть, названия нет — здесь их добивают (M18). */
export const Route = createFileRoute('/_app/unrecognized')({
  loader: () => listUnrecognizedFn(),
  component: UnrecognizedPage,
})

function UnrecognizedPage() {
  const rows = Route.useLoaderData()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function retry(bookIds: Array<string>, key: string) {
    setBusyId(key)
    try {
      const { resolved, missed } = await retryLookupFn({ data: { bookIds } })
      if (resolved > 0) {
        toast.success(
          `Нашлось ${resolved} ${plural(resolved, 'книга', 'книги', 'книг')}` +
            (missed > 0 ? `, осталось ${missed}` : ''),
        )
      } else {
        toast.error('Источники снова ничего не знают об этих номерах')
      }
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <p className="mb-4 truncate text-[13px] text-muted-foreground">
        <Link to="/add" className="hover:text-foreground">
          Добавить
        </Link>{' '}
        / Не распознано
      </p>

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[25px] leading-tight font-semibold">
          Не распознано
        </h1>
        {rows.length > 0 && (
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {rows.length}{' '}
            {plural(rows.length, 'книга ждёт', 'книги ждут', 'книг ждут')}{' '}
            названия
          </span>
        )}
        {rows.length > 0 && (
          <Button
            className="ml-auto"
            loading={busyId === 'all'}
            onClick={() =>
              void retry(
                rows.map((r) => r.id),
                'all',
              )
            }
          >
            Проверить все
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <Card className="mt-5">
          <CardContent className="py-8 text-sm text-muted-foreground">
            Пусто — все отсканированные книги распознались. Если источники
            промолчат, книга сохранится по одному ISBN и попадёт сюда.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
            >
              <span
                aria-hidden
                className="h-14 w-[38px] flex-none rounded-[3px] bg-[repeating-linear-gradient(135deg,#E8E4DA,#E8E4DA_5px,#DDD8CC_5px,#DDD8CC_10px)] shadow-[inset_1.5px_0_0_rgba(255,255,255,.5)]"
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-medium">
                  {row.isbn13 ?? 'без ISBN'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="mr-1.5 inline-block rounded-[3px] border-[1.5px] border-destructive/70 px-1 align-[1px] font-mono text-[9.5px] tracking-[0.07em] text-destructive uppercase">
                    не распознана
                  </span>
                  {dateHuman(row.createdAt)}
                  {row.libraryName && ` · ${row.libraryName}`}
                  {` · ${row.shelfName ?? 'Неразобранное'}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="flex-none text-accent-foreground"
                loading={busyId === row.id}
                disabled={!row.isbn13}
                onClick={() => void retry([row.id], row.id)}
              >
                Найти снова
              </Button>
              <Button size="sm" variant="outline" className="flex-none" asChild>
                <Link to="/books/$bookId/edit" params={{ bookId: row.id }}>
                  Заполнить
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
