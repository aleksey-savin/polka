import { useEffect, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { toast } from 'sonner'

import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { dateHuman } from '@/lib/dates'
import {
  moderationQueueFn,
  queueCountsFn,
  resolveModerationFn,
} from '@/server/moderation'
import type { QueueRow } from '@/services/moderation'

/** Очередь модератора (M21): публикация не ждёт, разбираем потом. */
export const Route = createFileRoute('/_app/service_/queue')({
  validateSearch: z.object({
    filter: z.enum(['reported', 'pending', 'resolved']).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [page, counts] = await Promise.all([
      moderationQueueFn({ data: { filter: deps.filter ?? 'reported' } }),
      queueCountsFn(),
    ])
    return { page, counts }
  },
  component: ModerationPage,
})

const KIND_LABEL: Record<QueueRow['kind'], string> = {
  book_cover: 'обложка',
  share: 'публичная ссылка',
  ref_work: 'эталон · произведение',
  ref_book: 'эталон · издание',
}

const REASONS = [
  'Запрещённая символика или экстремизм',
  'Порнография',
  'Оскорбления и травля',
  'Реклама и спам',
  'Чужие права (пиратский скан)',
  'Другое',
]

/** Куда ведёт «Открыть»: у ссылки объекта на своей странице нет. */
function targetLink(
  item: QueueRow,
): { to: string; params?: Record<string, string> } | null {
  if (item.kind === 'book_cover') {
    return { to: '/books/$bookId', params: { bookId: item.targetId } }
  }
  if (item.kind === 'ref_work') {
    return { to: '/works/$workId', params: { workId: item.targetId } }
  }
  if (item.kind === 'ref_book') {
    return { to: '/editions/$refBookId', params: { refBookId: item.targetId } }
  }
  return null
}

function ModerationPage() {
  const { page, counts } = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const filter = search.filter ?? 'reported'

  // докрученные страницы держим отдельно: лоадер отдаёт только первую
  const [extra, setExtra] = useState<Array<QueueRow>>([])
  const [cursor, setCursor] = useState<string | null>(page.cursor)
  const [loadingMore, setLoadingMore] = useState(false)
  const rows = [...page.rows, ...extra]

  useEffect(() => {
    setExtra([])
    setCursor(page.cursor)
  }, [page])

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const next = await moderationQueueFn({ data: { filter, cursor } })
      setExtra((prev) => [...prev, ...next.rows])
      setCursor(next.cursor)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setLoadingMore(false)
    }
  }

  const [openId, setOpenId] = useState<string | null>(null)
  const [reason, setReason] = useState(REASONS[0]!)
  const [note, setNote] = useState('')
  const [deleteFile, setDeleteFile] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  async function decide(
    item: QueueRow,
    decision: 'ok' | 'removed',
    withFile = false,
  ) {
    setBusy(item.id)
    try {
      await resolveModerationFn({
        data: {
          itemId: item.id,
          decision,
          reason:
            decision === 'removed'
              ? [reason, note.trim()].filter(Boolean).join(' — ')
              : null,
          deleteFile: withFile,
        },
      })
      toast.success(decision === 'ok' ? 'Помечено «в порядке»' : 'Снято')
      setOpenId(null)
      setNote('')
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <Breadcrumbs
        items={[
          { label: 'Настройки', to: '/service' },
          { label: 'Очередь модерации' },
        ]}
      />
      <h1 className="mb-4 text-[25px] leading-tight font-semibold">
        Очередь модерации
      </h1>

      <div className="flex gap-1 rounded-full border bg-card p-1">
        {(
          [
            ['reported', 'Жалобы', counts.reported],
            ['pending', 'На проверке', counts.pending],
            ['resolved', 'Разобрано', counts.resolved],
          ] as const
        ).map(([value, label, n]) => (
          <button
            key={value}
            type="button"
            className={`flex-1 rounded-full py-2 text-[13px] font-semibold ${
              filter === value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground'
            }`}
            onClick={() => void navigate({ search: { filter: value } })}
          >
            {label}
            {n > 0 && <span className="ml-1 font-mono text-[11px]">{n}</span>}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="mt-5">
          <CardContent className="py-8 text-sm text-muted-foreground">
            {filter === 'reported'
              ? 'Жалоб нет.'
              : filter === 'pending'
                ? 'Всё разобрано.'
                : 'Пока ничего не разбирали.'}
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 grid gap-2.5">
          {rows.map((item) => (
            <div
              key={item.id}
              className={`flex gap-3 rounded-2xl border p-3 ${
                item.reportCount > 0
                  ? 'border-destructive/40 bg-destructive/5'
                  : 'bg-card'
              }`}
            >
              {item.coverUrl ? (
                <img
                  src={item.coverUrl}
                  alt=""
                  className="h-[78px] w-[54px] flex-none rounded object-cover shadow-sm"
                />
              ) : (
                <span
                  aria-hidden
                  className="h-[78px] w-[54px] flex-none rounded bg-secondary"
                />
              )}
              <div className="min-w-0 flex-1">
                <span
                  className={`inline-block rounded-[3px] border-[1.5px] px-1.5 font-mono text-[9.5px] tracking-[0.07em] uppercase ${
                    item.reportCount > 0
                      ? 'border-destructive text-destructive'
                      : 'border-muted-foreground/50 text-muted-foreground'
                  }`}
                >
                  {item.reportCount > 0
                    ? `жалоба · ${item.reportCount}`
                    : KIND_LABEL[item.kind]}
                </span>
                <h2 className="mt-1.5 text-[15.5px] leading-[1.25] font-semibold [overflow-wrap:anywhere]">
                  {item.title}
                </h2>
                <p className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">
                  {[item.subtitle, item.ownerName && `автор ${item.ownerName}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {item.reports.slice(0, 2).map((rep, i) => (
                  <p
                    key={i}
                    className="mt-1.5 border-l-2 pl-2 text-[12.5px] text-muted-foreground"
                  >
                    «{rep.reason}
                    {rep.note ? `: ${rep.note}` : ''}» ·{' '}
                    {dateHuman(rep.createdAt)}
                  </p>
                ))}
                {item.status === 'removed' && item.reason && (
                  <p className="mt-1.5 text-[12.5px] text-destructive">
                    снято: {item.reason}
                  </p>
                )}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {item.status === 'pending' && (
                    <Button
                      size="sm"
                      loading={busy === item.id && openId === null}
                      onClick={() => void decide(item, 'ok')}
                    >
                      В порядке
                    </Button>
                  )}
                  {item.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() =>
                        setOpenId(openId === item.id ? null : item.id)
                      }
                    >
                      Снять…
                    </Button>
                  )}
                  {(() => {
                    const link = targetLink(item)
                    return link ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          to={link.to as never}
                          params={link.params as never}
                          search={{} as never}
                        >
                          Открыть
                        </Link>
                      </Button>
                    ) : null
                  })()}
                </div>

                {openId === item.id && (
                  <div className="mt-2.5 grid gap-2 rounded-xl border bg-background p-2.5">
                    <label className="grid gap-1 text-[12.5px] font-semibold">
                      Причина
                      <select
                        className="h-10 rounded-lg border bg-card px-2.5 text-[14px] font-normal"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      >
                        {REASONS.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </label>
                    <textarea
                      rows={2}
                      className="rounded-lg border bg-card px-2.5 py-2 text-[14px]"
                      placeholder="Комментарий владельцу (необязательно)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    {item.kind === 'book_cover' && (
                      <label className="flex items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          checked={deleteFile}
                          onChange={(e) => setDeleteFile(e.target.checked)}
                        />
                        Удалить файл обложки с сервера
                      </label>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        loading={busy === item.id}
                        onClick={() =>
                          void decide(
                            item,
                            'removed',
                            item.kind === 'book_cover' && deleteFile,
                          )
                        }
                      >
                        Снять с публикации
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenId(null)}
                      >
                        Отмена
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {cursor && (
            <Button
              variant="outline"
              className="mt-2 h-12 w-full"
              loading={loadingMore}
              onClick={() => void loadMore()}
            >
              Показать ещё
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
