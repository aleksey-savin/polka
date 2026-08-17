import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import {
  ChevronRight,
  KeyRound,
  LogOut,
  Mail,
  Pencil,
  Scale,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ReactNode } from 'react'

import { InvitePolkaDialog } from '@/components/layout/InvitePolkaDialog'
import { SectionLabel } from '@/components/layout/SectionLabel'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { resetAvailableFn } from '@/server/mail'
import { myAccountFn } from '@/server/moderation'
import { changePasswordFn, updateProfileFn } from '@/server/profile'
import { getSession } from '@/server/session'

/**
 * Профиль: только то, что человек меняет про себя. Тема живёт в меню шапки,
 * служебное — в «Сервисе». Пароль и почту правят раз в год, поэтому они за
 * одним тапом, а не открытыми полями на весь экран.
 */
export const Route = createFileRoute('/_app/settings')({
  loader: async () => {
    const [session, account, mailReady] = await Promise.all([
      getSession(),
      myAccountFn(),
      resetAvailableFn(),
    ])
    return { user: session!.user, role: account.role, mailReady }
  },
  component: ProfilePage,
})

const FIELD = 'h-12 rounded-xl text-[16px]'

const ROLE_LABEL: Record<string, string> = {
  admin: 'админ',
  moderator: 'модератор',
}

function ProfilePage() {
  const { user, role, mailReady } = Route.useLoaderData()
  const router = useRouter()

  const [sheet, setSheet] = useState<'profile' | 'password' | null>(null)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function saveProfile() {
    setBusy(true)
    try {
      await updateProfileFn({ data: { name, email } })
      toast.success(
        email !== user.email && mailReady
          ? 'Сохранили — подтвердите новый адрес по ссылке из письма'
          : 'Сохранили',
      )
      setSheet(null)
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  async function savePassword() {
    setBusy(true)
    try {
      await changePasswordFn({ data: { currentPassword, newPassword } })
      setCurrentPassword('')
      setNewPassword('')
      setSheet(null)
      toast.success('Пароль изменён — другие устройства разлогинены')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  const host = user.email.split('@')[1] ?? ''

  return (
    <div className="mx-auto max-w-[560px] pb-6">
      <h1 className="text-[25px] leading-tight font-semibold">Профиль</h1>

      <div className="mt-4 flex items-center gap-3.5 rounded-2xl border bg-card p-3.5">
        <span
          aria-hidden
          className="grid size-14 flex-none place-items-center rounded-full bg-accent text-[22px] font-semibold text-accent-foreground"
        >
          {user.name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] leading-tight font-semibold">
            {user.name}
          </p>
          <p className="font-mono text-xs break-words text-muted-foreground">
            {user.email}
          </p>
          {ROLE_LABEL[role] && (
            <span className="mt-1.5 inline-block rounded-full bg-stamp/10 px-2.5 py-0.5 text-[11px] font-semibold text-stamp">
              {ROLE_LABEL[role]}
            </span>
          )}
        </div>
      </div>

      <section className="mt-6">
        <SectionLabel>Аккаунт</SectionLabel>
        <Row
          icon={<Pencil />}
          label="Имя и почта"
          sub={`${user.name} · ${host}`}
          onClick={() => {
            setName(user.name)
            setEmail(user.email)
            setSheet('profile')
          }}
        />
        <Row
          icon={<KeyRound />}
          label="Сменить пароль"
          onClick={() => setSheet('password')}
        />
        <Row
          icon={<LogOut />}
          label="Выйти"
          danger
          onClick={() =>
            void authClient.signOut().then(() => {
              window.location.href = '/login'
            })
          }
        />
      </section>

      <section className="mt-6">
        <SectionLabel>Моя библиотека</SectionLabel>
        <InvitePolkaDialog
          trigger={
            <Row
              icon={<Mail />}
              label="Пригласить"
              sub="Дать доступ к своим полкам"
            />
          }
        />
        <Row icon={<Scale />} label="Правила" to="/rules" />
      </section>

      <Drawer
        open={sheet === 'profile'}
        onOpenChange={(open) => !open && setSheet(null)}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Имя и почта</DrawerTitle>
          </DrawerHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">Имя</Label>
              <Input
                id="p-name"
                className={FIELD}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-mail">Почта</Label>
              <Input
                id="p-mail"
                type="email"
                autoComplete="email"
                className={`${FIELD} font-mono`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {mailReady && email !== user.email && (
                <p className="text-[12.5px] text-accent-foreground">
                  На новый адрес придёт письмо со ссылкой — до подтверждения
                  вход по старому.
                </p>
              )}
            </div>
          </div>
          <DrawerFooter>
            <Button
              className="h-12 w-full text-[15px]"
              loading={busy}
              disabled={!name.trim() || !email.trim()}
              onClick={() => void saveProfile()}
            >
              Сохранить
            </Button>
            <Button
              variant="outline"
              className="h-12 w-full text-[15px]"
              onClick={() => setSheet(null)}
            >
              Отмена
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Drawer
        open={sheet === 'password'}
        onOpenChange={(open) => !open && setSheet(null)}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Сменить пароль</DrawerTitle>
          </DrawerHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-old">Текущий пароль</Label>
              <Input
                id="p-old"
                type="password"
                autoComplete="current-password"
                className={FIELD}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-new">Новый пароль</Label>
              <Input
                id="p-new"
                type="password"
                autoComplete="new-password"
                className={FIELD}
                placeholder="от 8 символов"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            {mailReady && (
              <p className="text-[12.5px] text-muted-foreground">
                Забыли текущий — выйдите и нажмите «Забыли пароль?».
              </p>
            )}
          </div>
          <DrawerFooter>
            <Button
              className="h-12 w-full text-[15px]"
              loading={busy}
              disabled={!currentPassword || newPassword.length < 8}
              onClick={() => void savePassword()}
            >
              Сменить
            </Button>
            <Button
              variant="outline"
              className="h-12 w-full text-[15px]"
              onClick={() => setSheet(null)}
            >
              Отмена
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

/** Строка-переход: 56px, иконка, подпись, шеврон — по гайдлайну тап-таргетов. */
function Row({
  icon,
  label,
  sub,
  to,
  danger = false,
  onClick,
}: {
  icon: ReactNode
  label: string
  sub?: string
  to?: string
  danger?: boolean
  onClick?: () => void
}) {
  const inner = (
    <>
      <span
        aria-hidden
        className={`flex w-[22px] flex-none justify-center [&_svg]:size-[19px] ${
          danger ? 'text-destructive' : 'text-muted-foreground'
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        {label}
        {sub && (
          <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
            {sub}
          </span>
        )}
      </span>
      {!danger && (
        <ChevronRight
          aria-hidden
          className="size-[18px] flex-none text-muted-foreground"
        />
      )}
    </>
  )
  const className = `flex min-h-14 w-full items-center gap-3 border-t py-2 text-left text-[15.5px] first:border-t-0 ${
    danger ? 'text-destructive' : ''
  }`

  if (to) {
    return (
      <Link to={to as never} className={className}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {inner}
    </button>
  )
}
