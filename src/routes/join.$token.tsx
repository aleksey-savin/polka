import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'

import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { checkSignupInviteFn } from '@/server/shares'
import { getSession } from '@/server/session'

export const Route = createFileRoute('/join/$token')({
  beforeLoad: async () => {
    const session = await getSession()
    if (session) throw redirect({ to: '/libraries' })
  },
  loader: ({ params }) =>
    checkSignupInviteFn({ data: { token: params.token } }),
  component: JoinPage,
})

function JoinPage() {
  const { valid } = Route.useLoaderData()
  const { token } = Route.useParams()
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await authClient.signUp.email({
      email,
      password,
      name: name.trim() || email,
      fetchOptions: { headers: { 'x-signup-invite': token } },
    })
    setBusy(false)
    if (result.error) {
      setError(
        'Не получилось создать аккаунт: ' +
          (result.error.message ?? 'попробуйте ещё раз'),
      )
      return
    }
    await router.navigate({ to: '/libraries' })
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 pb-10">
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid justify-items-center gap-2 text-center">
          <Logo large />
          <p className="text-muted-foreground">
            Вас пригласили в Полку — домашнюю библиотеку
          </p>
        </div>

        {valid ? (
          <Card>
            <CardContent className="pt-6">
              <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
                <div className="grid gap-1.5">
                  <Label htmlFor="join-name">Имя</Label>
                  <Input
                    id="join-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="join-email">Почта</Label>
                  <Input
                    id="join-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="join-password">Пароль</Label>
                  <Input
                    id="join-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="минимум 8 символов"
                    autoComplete="new-password"
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" size="lg" loading={busy}>
                  Создать аккаунт
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Приглашение не действует: оно одноразовое и живёт 7 дней.
              Попросите новую ссылку у того, кто вас приглашал.
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
