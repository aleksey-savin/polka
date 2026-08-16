import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { toast } from 'sonner'

import { SectionLabel } from '@/components/layout/SectionLabel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { changePasswordFn, updateProfileFn } from '@/server/profile'
import { getSession } from '@/server/session'

export const Route = createFileRoute('/_app/settings')({
  loader: async () => {
    const session = await getSession()
    return { user: session!.user }
  },
  component: SettingsPage,
})

const FIELD = 'h-12 rounded-xl text-[16px]'

function SettingsPage() {
  const { user } = Route.useLoaderData()
  const router = useRouter()

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  async function saveProfile() {
    setSavingProfile(true)
    try {
      await updateProfileFn({ data: { name, email } })
      toast.success('Профиль сохранён')
      setEditing(false)
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword() {
    setSavingPassword(true)
    try {
      await changePasswordFn({ data: { currentPassword, newPassword } })
      setCurrentPassword('')
      setNewPassword('')
      toast.success('Пароль изменён — другие устройства разлогинены')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="mx-auto max-w-[560px] pb-6">
      <h1 className="text-[25px] leading-tight font-semibold">Настройки</h1>

      <section className="mt-5">
        <div className="flex items-center gap-3.5 rounded-2xl border bg-card p-3.5">
          <span
            aria-hidden
            className="grid size-[54px] flex-none place-items-center rounded-2xl bg-accent text-[22px] font-semibold text-accent-foreground"
          >
            {user.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold">{user.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
          {!editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Изменить
            </Button>
          )}
        </div>

        {editing && (
          <div className="mt-4 grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="s-name">Имя</Label>
              <Input
                id="s-name"
                className={FIELD}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="s-mail">Почта</Label>
              <Input
                id="s-mail"
                type="email"
                className={FIELD}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-[12.5px] text-muted-foreground">
                Это и логин: письма приложение не шлёт, почта нужна только для
                входа.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                className="h-11"
                loading={savingProfile}
                disabled={!name.trim() || !email.trim()}
                onClick={() => void saveProfile()}
              >
                Сохранить
              </Button>
              <Button
                variant="ghost"
                className="h-11"
                onClick={() => {
                  setName(user.name)
                  setEmail(user.email)
                  setEditing(false)
                }}
              >
                Отмена
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-7">
        <SectionLabel>Пароль</SectionLabel>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="s-old">Текущий пароль</Label>
            <Input
              id="s-old"
              type="password"
              autoComplete="current-password"
              className={FIELD}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-new">Новый пароль</Label>
            <Input
              id="s-new"
              type="password"
              autoComplete="new-password"
              className={FIELD}
              placeholder="не короче 8 символов"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            Восстановления по почте нет — приложение не отправляет писем. Пароль
            меняется только так; забытый сбрасывает владелец сервера.
          </p>
          <div>
            <Button
              className="h-11"
              loading={savingPassword}
              disabled={!currentPassword || newPassword.length < 8}
              onClick={() => void savePassword()}
            >
              Сменить пароль
            </Button>
          </div>
        </div>
      </section>

      <section className="mt-7">
        <SectionLabel>Аккаунт</SectionLabel>
        <Button
          variant="outline"
          className="text-destructive"
          onClick={() =>
            void authClient.signOut().then(() => {
              window.location.href = '/login'
            })
          }
        >
          <LogOut aria-hidden /> Выйти из аккаунта
        </Button>
      </section>
    </div>
  )
}
