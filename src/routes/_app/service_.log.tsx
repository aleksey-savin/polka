import { createFileRoute } from '@tanstack/react-router'

import { Card, CardContent } from '@/components/ui/card'
import { dateHuman } from '@/lib/dates'
import { moderationLogFn } from '@/server/moderation'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'

/** Журнал модерации: кто, что, когда и почему (M21). */
export const Route = createFileRoute('/_app/service_/log')({
  loader: () => moderationLogFn(),
  component: LogPage,
})

const ACTION_LABEL: Record<string, string> = {
  approve: 'пометил «в порядке»',
  remove: 'снял с публикации',
  'publish-ban': 'запретил публиковать',
  'publish-unban': 'вернул право публиковать',
  block: 'заблокировал аккаунт',
  unblock: 'разблокировал аккаунт',
  'role:admin': 'назначил админом',
  'role:moderator': 'назначил модератором',
  'role:user': 'снял права',
}

function LogPage() {
  const rows = Route.useLoaderData()
  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <Breadcrumbs
        items={[
          { label: 'Настройки', to: '/service' },
          { label: 'Журнал решений' },
        ]}
      />
      <h1 className="mb-4 text-[25px] leading-tight font-semibold">
        Журнал решений
      </h1>
      <h2 className="text-[17px] font-semibold">Журнал модерации</h2>

      {rows.length === 0 ? (
        <Card className="mt-5">
          <CardContent className="py-8 text-sm text-muted-foreground">
            Пока пусто — действий модераторов не было.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex gap-3 border-t py-2 text-[12.5px] first:border-t-0"
            >
              <span className="w-[104px] flex-none font-mono text-[11px] text-muted-foreground">
                {dateHuman(row.createdAt)}
              </span>
              <span className="min-w-0 flex-1">
                <b className="font-semibold">{row.actorName ?? 'кто-то'}</b>{' '}
                {ACTION_LABEL[row.action] ?? row.action}
                {row.subjectName && <> · {row.subjectName}</>}
                {row.reason && (
                  <span className="text-muted-foreground"> · {row.reason}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
