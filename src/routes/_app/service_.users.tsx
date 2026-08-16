import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { ActionMenu } from '@/components/ui/action-menu'
import { ServiceTabs } from '@/components/layout/ServiceTabs'
import { Button } from '@/components/ui/button'
import { plural } from '@/lib/plural'
import {
  listUsersFn,
  setBlockedFn,
  setPublishBanFn,
  setRoleFn,
} from '@/server/moderation'
import type { UserRow } from '@/services/moderation'

/** Управление аккаунтами — только для админа (M21). */
export const Route = createFileRoute('/_app/service_/users')({
  loader: () => listUsersFn(),
  component: UsersPage,
})

const ROLE_LABEL = {
  user: 'пользователь',
  moderator: 'модератор',
  admin: 'админ',
} as const

function UsersPage() {
  const rows = Route.useLoaderData()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [asking, setAsking] = useState<{
    user: UserRow
    action: 'publish-ban' | 'block'
  } | null>(null)
  const [reason, setReason] = useState('')

  const refresh = () => void router.invalidate()

  async function run(id: string, action: () => Promise<unknown>, done: string) {
    setBusyId(id)
    try {
      await action()
      toast.success(done)
      setAsking(null)
      setReason('')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <h1 className="mb-4 text-[25px] leading-tight font-semibold">Сервис</h1>
      <ServiceTabs isAdmin />

      <div className="mt-4">
        {rows.map((row) => (
          <div key={row.id}>
            <div className="flex items-center gap-3 border-t py-2.5 first:border-t-0">
              <span
                aria-hidden
                className="grid size-10 flex-none place-items-center rounded-xl bg-accent font-semibold text-accent-foreground"
              >
                {row.name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{row.name}</p>
                <p className="truncate font-mono text-[11.5px] text-muted-foreground">
                  {row.email} · {row.bookCount}{' '}
                  {plural(row.bookCount, 'книга', 'книги', 'книг')}
                  {row.removedCount > 0 && ` · ${row.removedCount} снятий`}
                </p>
              </div>
              <span
                className={`flex-none rounded-full border px-2.5 py-0.5 text-xs ${
                  row.blocked || row.publishBanned
                    ? 'border-destructive/45 text-destructive'
                    : row.role === 'admin'
                      ? 'border-primary/45 text-accent-foreground'
                      : row.role === 'moderator'
                        ? 'border-stamp/40 text-stamp'
                        : 'text-muted-foreground'
                }`}
              >
                {row.blocked
                  ? 'заблокирован'
                  : row.publishBanned
                    ? 'без публикаций'
                    : ROLE_LABEL[row.role]}
              </span>
              <ActionMenu
                caption={row.name}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busyId === row.id}
                  >
                    ···
                  </Button>
                }
                entries={[
                  ...(row.role !== 'moderator'
                    ? [
                        {
                          key: 'mod',
                          label: 'Назначить модератором',
                          onSelect: () =>
                            void run(
                              row.id,
                              () =>
                                setRoleFn({
                                  data: { targetId: row.id, role: 'moderator' },
                                }),
                              `${row.name} — модератор`,
                            ),
                        },
                      ]
                    : [
                        {
                          key: 'unmod',
                          label: 'Снять модератора',
                          onSelect: () =>
                            void run(
                              row.id,
                              () =>
                                setRoleFn({
                                  data: { targetId: row.id, role: 'user' },
                                }),
                              'Права сняты',
                            ),
                        },
                      ]),
                  'separator',
                  row.publishBanned
                    ? {
                        key: 'unban',
                        label: 'Вернуть право публиковать',
                        onSelect: () =>
                          void run(
                            row.id,
                            () =>
                              setPublishBanFn({
                                data: {
                                  targetId: row.id,
                                  banned: false,
                                  reason: null,
                                },
                              }),
                            'Публикация разрешена',
                          ),
                      }
                    : {
                        key: 'ban',
                        label: 'Запретить публиковать',
                        danger: true,
                        onSelect: () =>
                          setAsking({ user: row, action: 'publish-ban' }),
                      },
                  row.blocked
                    ? {
                        key: 'unblock',
                        label: 'Разблокировать аккаунт',
                        onSelect: () =>
                          void run(
                            row.id,
                            () =>
                              setBlockedFn({
                                data: {
                                  targetId: row.id,
                                  blocked: false,
                                  reason: null,
                                },
                              }),
                            'Аккаунт разблокирован',
                          ),
                      }
                    : {
                        key: 'block',
                        label: 'Заблокировать аккаунт',
                        danger: true,
                        onSelect: () =>
                          setAsking({ user: row, action: 'block' }),
                      },
                ]}
              />
            </div>

            {asking?.user.id === row.id && (
              <div className="mb-2.5 ml-13 grid gap-2 rounded-xl border bg-background p-2.5">
                <p className="text-[13px]">
                  {asking.action === 'block'
                    ? `Заблокировать «${row.name}»? Войти он больше не сможет.`
                    : `Запретить «${row.name}» публиковать? Аккаунт останется, новые ссылки создавать нельзя.`}
                </p>
                <input
                  className="h-10 rounded-lg border bg-card px-2.5 text-[14px]"
                  placeholder="Причина — попадёт в журнал"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={busyId === row.id}
                    disabled={!reason.trim()}
                    onClick={() =>
                      void run(
                        row.id,
                        () =>
                          asking.action === 'block'
                            ? setBlockedFn({
                                data: {
                                  targetId: row.id,
                                  blocked: true,
                                  reason,
                                },
                              })
                            : setPublishBanFn({
                                data: {
                                  targetId: row.id,
                                  banned: true,
                                  reason,
                                },
                              }),
                        asking.action === 'block'
                          ? 'Аккаунт заблокирован'
                          : 'Публикация запрещена',
                      )
                    }
                  >
                    Подтвердить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAsking(null)
                      setReason('')
                    }}
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
