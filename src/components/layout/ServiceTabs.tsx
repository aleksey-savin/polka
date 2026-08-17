import { Link, useRouterState } from '@tanstack/react-router'

/** Раздел «Сервис» (M22): очередь, пользователи, почта, журнал — в одном месте. */
export function ServiceTabs({
  isAdmin,
  pending = 0,
}: {
  isAdmin: boolean
  pending?: number
}) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const tabs = [
    { to: '/service', label: 'Очередь', badge: pending, admin: false },
    { to: '/service/users', label: 'Пользователи', admin: true },
    { to: '/service/mail', label: 'Почта', admin: true },
    { to: '/service/ai', label: 'ИИ', admin: true },
    { to: '/service/log', label: 'Журнал', admin: false },
  ] as const

  return (
    <div className="mb-4 flex gap-1 rounded-full border bg-card p-1">
      {tabs
        .filter((tab) => isAdmin || !tab.admin)
        .map((tab) => {
          const active =
            tab.to === '/service'
              ? path === '/service'
              : path.startsWith(tab.to)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              search={tab.to === '/service' ? {} : undefined}
              className={`flex-1 rounded-full py-2 text-center text-[12.5px] font-semibold whitespace-nowrap ${
                active
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground'
              }`}
            >
              {tab.label}
              {'badge' in tab && tab.badge ? (
                <span className="ml-1 font-mono text-[11px]">
                  · {tab.badge}
                </span>
              ) : null}
            </Link>
          )
        })}
    </div>
  )
}
