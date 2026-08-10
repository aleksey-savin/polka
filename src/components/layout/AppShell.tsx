import type { ReactNode } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { BookOpen, Handshake, House, LogOut, Plus, Users } from 'lucide-react'

import { LogoLink } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { authClient } from '@/lib/auth-client'

const sections = [
  { to: '/libraries', label: 'Библиотека' },
  { to: '/books', label: 'Каталог' },
  { to: '/series', label: 'Серии' },
  { to: '/wishlist', label: 'Хочу' },
  { to: '/loans', label: 'На руках' },
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

  async function handleSignOut() {
    await authClient.signOut()
    await router.navigate({ to: '/login' })
  }

  return (
    <div className="min-h-full pb-20 md:pb-0">
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
              </Link>
            ))}
          </nav>
          <div className="grow" />
          <Button asChild className="hidden md:inline-flex">
            <Link to="/add">
              <Plus /> Добавить книгу
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {userName}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{userName}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void handleSignOut()}>
                <LogOut /> Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          to="/libraries"
          label="Библиотека"
          icon={<House className="size-5" />}
        />
        <TabLink
          to="/books"
          label="Каталог"
          icon={<BookOpen className="size-5" />}
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
          to="/loans"
          label="На руках"
          icon={<Handshake className="size-5" />}
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
}: {
  to: string
  label: string
  icon: ReactNode
}) {
  return (
    <Link
      to={to}
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
