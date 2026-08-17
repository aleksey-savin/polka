import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import {
  Bookmark,
  Library,
  LogOut,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'

import { LogoLink } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { ActionMenu } from '@/components/ui/action-menu'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { authClient } from '@/lib/auth-client'
import { countPendingRequestsFn } from '@/server/shares'
import { myAccountFn } from '@/server/moderation'
import { lastLibrary } from '@/lib/origin'

const sections = [
  { to: '/reading', label: 'Чтение' },
  { to: '/books', label: 'Каталог' },
  { to: '/libraries', label: 'Библиотека' },
  { to: '/series', label: 'Серии' },
  { to: '/friends', label: 'Друзья' },
  { to: '/requests', label: 'Заявки' },
] as const

export function AppShell({
  userName,
  children,
}: {
  userName: string
  children: ReactNode
}) {
  const router = useRouter()
  const navigating = useRouterState({ select: (s) => s.isLoading })
  const path = useRouterState({ select: (s) => s.location.pathname })

  /*
   * Страховка от залипшего оверлея. Radix (под vaul) вешает на body
   * pointer-events: none, пока диалог открыт, и снимает при закрытии — но
   * если во время закрытия страница сменилась, снимать оказывается некому:
   * приложение выглядит живым и не реагирует на касания. Известная беда
   * radix-ui/primitives#1241; после каждого перехода приводим body в чувство.
   */
  useEffect(() => {
    if (document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = ''
    }
  }, [path])
  const [pendingRequests, setPendingRequests] = useState(0)
  const [account, setAccount] = useState<{ role: string } | null>(null)

  useEffect(() => {
    void countPendingRequestsFn()
      .then(setPendingRequests)
      .catch(() => {})
    // роль решает, показывать ли настройки приложения в меню (M21)
    void myAccountFn()
      .then(setAccount)
      .catch(() => {})
  }, [])

  async function handleSignOut() {
    await authClient.signOut()
    await router.navigate({ to: '/login' })
  }

  return (
    <div className="min-h-full pb-24 md:pb-0">
      {navigating && <div aria-hidden className="nav-progress" />}
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="flex items-center gap-4 px-4 py-3 md:px-7">
          <LogoLink />
          <nav aria-label="Разделы" className="hidden gap-0.5 md:flex">
            {sections.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground"
                activeProps={{
                  className:
                    'rounded-lg px-3 py-1.5 text-sm font-semibold bg-accent text-accent-foreground',
                }}
              >
                {s.label}
                {s.to === '/requests' && pendingRequests > 0 && (
                  <span className="ml-1 inline-block min-w-[18px] rounded-full bg-stamp px-1.5 text-center text-[11px] font-semibold text-white">
                    {pendingRequests}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <div className="grow" />
          <Button asChild className="hidden md:inline-flex">
            <Link to="/add">
              <Plus /> Добавить книгу
            </Link>
          </Button>
          <ActionMenu
            caption={userName}
            trigger={
              <Button variant="outline" size="sm">
                {userName}
              </Button>
            }
            entries={[
              {
                key: 'theme',
                label: 'Тема',
                custom: <ThemeToggle compact />,
              },
              ...(account && account.role !== 'user'
                ? ([
                    {
                      key: 'service',
                      label: 'Настройки',
                      icon: <ShieldCheck />,
                      to: '/service',
                      search: {},
                    },
                  ] as const)
                : []),
              {
                key: 'settings',
                label: 'Профиль',
                icon: <Settings />,
                to: '/settings',
              },
              {
                key: 'signout',
                label: 'Выйти',
                icon: <LogOut />,
                onSelect: () => void handleSignOut(),
              },
            ]}
          />
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-4 py-6 md:px-7">
        {children}
      </main>

      {/* Мобильная таб-панель */}
      <nav
        aria-label="Навигация"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t bg-card px-2 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden"
      >
        <TabLink
          to="/reading"
          label="Чтение"
          icon={<Bookmark className="size-5" />}
        />
        <TabLink
          to="/books"
          label="Поиск"
          icon={<Search className="size-5" />}
        />
        <Link
          to="/add"
          aria-label="Добавить книгу"
          className="grid justify-items-center"
        >
          <span className="-mt-4 grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Plus className="size-6" />
          </span>
        </Link>
        <TabLink
          to="/libraries"
          // возвращаемся в ту библиотеку, где были в прошлый раз
          search={{ lib: lastLibrary() ?? undefined }}
          label="Библиотека"
          icon={<Library className="size-5" />}
        />
        <TabLink
          to="/friends"
          label="Друзья"
          icon={<Users className="size-5" />}
        />
      </nav>
    </div>
  )
}

function TabLink({
  to,
  label,
  icon,
  search,
}: {
  to: string
  label: string
  icon: ReactNode
  search?: Record<string, unknown>
}) {
  return (
    <Link
      to={to}
      search={search as never}
      className="grid justify-items-center gap-0.5 py-1 text-[10.5px] text-muted-foreground"
      activeProps={{
        className:
          'grid justify-items-center gap-0.5 py-1 text-[10.5px] font-semibold text-accent-foreground',
      }}
    >
      {icon}
      {label}
    </Link>
  )
}
