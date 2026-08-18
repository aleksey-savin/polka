import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { moderationLogFn } from '@/server/moderation'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import type { LogRow } from '@/services/moderation'

/**
 * Журнал (M21, переработан в M29.1).
 *
 * Событие отвечает на три вопроса: кто, что сделал с чем и почему. Раньше
 * строка «Алексей пометил в порядке · Алексей» не отвечала ни на один.
 */
export const Route = createFileRoute('/_app/service_/log')({
  loader: () => moderationLogFn({ data: {} }),
  component: LogPage,
})

type Group = 'removals' | 'approvals' | 'undo' | 'people'

interface ActionView {
  verb: string
  mark: string
  tone: 'ok' | 'no' | 'edit' | 'undo'
  group: Group
}

const ACTIONS: Record<string, ActionView> = {
  approve: { verb: 'одобрил', mark: '✓', tone: 'ok', group: 'approvals' },
  'approve-ref': {
    verb: 'одобрил и внёс в эталон',
    mark: '✓',
    tone: 'ok',
    group: 'approvals',
  },
  remove: {
    verb: 'снял с публикации',
    mark: '✕',
    tone: 'no',
    group: 'removals',
  },
  undo: { verb: 'отменил решение по', mark: '↶', tone: 'undo', group: 'undo' },
  'draft-edit': {
    verb: 'поправил копию',
    mark: '✎',
    tone: 'edit',
    group: 'approvals',
  },
  'publish-ban': {
    verb: 'запретил публиковать',
    mark: '✕',
    tone: 'no',
    group: 'people',
  },
  'publish-unban': {
    verb: 'вернул право публиковать',
    mark: '✓',
    tone: 'ok',
    group: 'people',
  },
  block: {
    verb: 'заблокировал аккаунт',
    mark: '✕',
    tone: 'no',
    group: 'people',
  },
  unblock: {
    verb: 'разблокировал аккаунт',
    mark: '✓',
    tone: 'ok',
    group: 'people',
  },
  'role:admin': {
    verb: 'назначил админом',
    mark: '☺',
    tone: 'ok',
    group: 'people',
  },
  'role:moderator': {
    verb: 'назначил модератором',
    mark: '☺',
    tone: 'ok',
    group: 'people',
  },
  'role:user': { verb: 'снял права', mark: '☺', tone: 'undo', group: 'people' },
}

const FILTERS: Array<[Group | 'all', string]> = [
  ['all', 'Всё'],
  ['removals', 'Снятия'],
  ['approvals', 'Одобрения'],
  ['undo', 'Отмены'],
  ['people', 'Люди'],
]

const TONE: Record<ActionView['tone'], string> = {
  ok: 'bg-accent text-accent-foreground',
  no: 'bg-destructive/10 text-destructive',
  edit: 'bg-stamp/10 text-stamp',
  undo: 'bg-muted text-muted-foreground',
}

/** Куда ведёт название объекта. У ссылки своей страницы нет. */
function targetLink(row: LogRow) {
  if (!row.targetId) return null
  if (row.kind === 'book_cover' || row.kind === 'ai_book') {
    return { to: '/books/$bookId', params: { bookId: row.targetId } }
  }
  if (row.kind === 'ref_work') {
    return { to: '/works/$workId', params: { workId: row.targetId } }
  }
  if (row.kind === 'ref_book') {
    return { to: '/editions/$refBookId', params: { refBookId: row.targetId } }
  }
  return null
}

/** «Сегодня», «вчера» или дата — заголовок дня. */
function dayLabel(date: Date): string {
  const today = new Date()
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return 'сегодня'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(date, yesterday)) return 'вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

const timeOf = (date: Date) =>
  date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

function LogPage() {
  const page = Route.useLoaderData()
  // журнал растёт вечно — грузим страницами по требованию
  const [extra, setExtra] = useState<Array<(typeof page.rows)[number]>>([])
  const [cursor, setCursor] = useState<string | null>(page.cursor)
  const [busy, setBusy] = useState(false)
  const [group, setGroup] = useState<Group | 'all'>('all')
  const all = [...page.rows, ...extra]
  const rows = all.filter(
    (row) =>
      group === 'all' || (ACTIONS[row.action]?.group ?? 'approvals') === group,
  )

  useEffect(() => {
    setExtra([])
    setCursor(page.cursor)
  }, [page])

  async function loadMore() {
    if (!cursor) return
    setBusy(true)
    try {
      const next = await moderationLogFn({ data: { cursor } })
      setExtra((prev) => [...prev, ...next.rows])
      setCursor(next.cursor)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <Breadcrumbs
        items={[{ label: 'Настройки', to: '/service' }, { label: 'Журнал' }]}
      />
      <h1 className="mb-1 text-[25px] leading-tight font-semibold">Журнал</h1>
      <p className="mb-3 text-[13px] text-muted-foreground">
        Все решения модерации и настроек — в обратном порядке.
      </p>

      <div className="mb-1 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`flex-none rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold ${
              group === value
                ? 'border-foreground bg-foreground text-background'
                : 'bg-card text-muted-foreground'
            }`}
            onClick={() => setGroup(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="py-8 text-sm text-muted-foreground">
            {all.length === 0
              ? 'Пока пусто — решений не было.'
              : 'В этой группе решений нет.'}
          </CardContent>
        </Card>
      ) : (
        <div className="mt-2">
          {rows.map((row, index) => {
            const view = ACTIONS[row.action]
            const link = targetLink(row)
            const day = dayLabel(row.createdAt)
            const newDay =
              index === 0 || day !== dayLabel(rows[index - 1]!.createdAt)
            return (
              <div key={row.id}>
                {newDay && (
                  <p className="sticky top-0 bg-background pt-3 pb-1.5 font-mono text-[10.5px] tracking-[0.14em] text-muted-foreground uppercase">
                    {day}
                  </p>
                )}
                <div className="flex gap-3 border-t py-2.5">
                  <span
                    aria-hidden
                    className={`grid size-[26px] flex-none place-items-center rounded-lg text-[13px] ${
                      TONE[view?.tone ?? 'edit']
                    }`}
                  >
                    {view?.mark ?? '·'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] leading-[1.35] [overflow-wrap:anywhere]">
                      <b className="font-semibold">
                        {row.actorName ?? 'кто-то'}
                      </b>{' '}
                      {view?.verb ?? row.action}
                      {row.targetTitle && ' '}
                      {row.targetTitle &&
                        (link ? (
                          <Link
                            to={link.to as never}
                            params={link.params as never}
                            search={{} as never}
                            className="underline underline-offset-2"
                          >
                            «{row.targetTitle}»
                          </Link>
                        ) : (
                          <span>«{row.targetTitle}»</span>
                        ))}
                      {row.subjectName && !row.targetTitle && (
                        <>
                          {' '}
                          <b className="font-semibold">{row.subjectName}</b>
                        </>
                      )}
                    </p>
                    {(row.reason || row.details) && (
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">
                        {[row.reason, row.details].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {timeOf(row.createdAt)}
                      {row.subjectName && row.targetTitle && (
                        <> · владелец {row.subjectName}</>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
          {cursor && (
            <Button
              variant="outline"
              className="mt-3 h-12 w-full"
              loading={busy}
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
