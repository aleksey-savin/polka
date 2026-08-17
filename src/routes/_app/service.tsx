import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ChevronRight,
  Flag,
  Mail,
  ScrollText,
  Search,
  Sparkles,
  UserRound,
  Wand2,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { SectionLabel } from '@/components/layout/SectionLabel'
import { serviceOverviewFn } from '@/server/moderation'
import { plural } from '@/lib/plural'

/**
 * Настройки приложения (бывший «Сервис»).
 *
 * Шесть вкладок в строку не помещались ни на одном телефоне — значит это не
 * вкладки, а список разделов. Заодно состояние каждого видно сразу: «Google
 * без ключа» или «ИИ выключен» не приходится искать, заходя внутрь.
 */
export const Route = createFileRoute('/_app/service')({
  loader: () => serviceOverviewFn(),
  component: AppSettingsPage,
})

type Tone = 'ok' | 'bad' | 'off'

function AppSettingsPage() {
  const data = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-[560px] pb-6">
      <h1 className="text-[25px] leading-tight font-semibold">Настройки</h1>

      <section className="mt-5">
        <SectionLabel>Содержимое</SectionLabel>
        <Row
          icon={<Flag />}
          label="Очередь модерации"
          to="/service/queue"
          badge={data.pending || undefined}
          state={
            data.pending > 0 ? undefined : { tone: 'ok', text: 'жалоб нет' }
          }
        />
        {data.isAdmin && (
          <Row
            icon={<Sparkles />}
            label="Проверка находок"
            to="/service/ai-review"
            badge={data.aiPending || undefined}
            state={
              data.aiPending > 0
                ? undefined
                : { tone: 'ok', text: 'всё разобрано' }
            }
          />
        )}
        <Row
          icon={<ScrollText />}
          label="Журнал решений"
          sub="кто и что снимал"
          to="/service/log"
        />
      </section>

      {data.isAdmin && (
        <>
          <section className="mt-6">
            <SectionLabel>Откуда берутся данные</SectionLabel>
            <Row
              icon={<Search />}
              label="Источники книг"
              to="/service/sources"
              state={
                !data.sources.hasGoogleKey
                  ? { tone: 'bad', text: 'Google без ключа' }
                  : data.sources.webEnabled
                    ? { tone: 'ok', text: 'каталоги и поиск включены' }
                    : { tone: 'off', text: 'поиск в интернете выключен' }
              }
            />
            <Row
              icon={<Wand2 />}
              label="ИИ"
              to="/service/ai"
              state={
                !data.ai.enabled
                  ? { tone: 'off', text: 'выключен' }
                  : !data.ai.configured
                    ? { tone: 'bad', text: 'не настроен' }
                    : data.ai.failed
                      ? { tone: 'bad', text: 'последний запрос не удался' }
                      : { tone: 'ok', text: 'отвечает' }
              }
            />
          </section>

          <section className="mt-6">
            <SectionLabel>Люди и связь</SectionLabel>
            <Row
              icon={<UserRound />}
              label="Пользователи"
              to="/service/users"
              state={{
                tone: 'ok',
                text: `${data.users.count} ${plural(data.users.count, 'человек', 'человека', 'человек')}`,
              }}
            />
            <Row
              icon={<Mail />}
              label="Почта"
              to="/service/mail"
              state={
                data.mail.configured
                  ? { tone: 'ok', text: 'письма уходят' }
                  : { tone: 'off', text: 'не настроена' }
              }
            />
          </section>
        </>
      )}
    </div>
  )
}

/** Строка раздела: состояние подписью — где непорядок, видно из списка. */
function Row({
  icon,
  label,
  sub,
  to,
  badge,
  state,
}: {
  icon: ReactNode
  label: string
  sub?: string
  to: string
  badge?: number
  state?: { tone: Tone; text: string }
}) {
  return (
    <Link
      to={to as never}
      search={{} as never}
      className="flex min-h-14 w-full items-center gap-3 border-t py-2 text-left text-[15.5px] first:border-t-0"
    >
      <span
        aria-hidden
        className="flex w-[22px] flex-none justify-center text-muted-foreground [&_svg]:size-[19px]"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        {label}
        {state && (
          <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <span
              aria-hidden
              className={`size-[7px] flex-none rounded-full ${
                state.tone === 'ok'
                  ? 'bg-primary'
                  : state.tone === 'bad'
                    ? 'bg-destructive'
                    : 'bg-muted-foreground/50'
              }`}
            />
            {state.text}
          </span>
        )}
        {sub && !state && (
          <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
            {sub}
          </span>
        )}
      </span>
      {badge ? (
        <span className="grid h-[22px] min-w-[22px] flex-none place-items-center rounded-full bg-destructive px-1.5 font-mono text-[11.5px] text-white">
          {badge}
        </span>
      ) : null}
      <ChevronRight
        aria-hidden
        className="size-[18px] flex-none text-muted-foreground"
      />
    </Link>
  )
}
