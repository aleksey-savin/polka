import { useState } from 'react'
import {
  Link,
  createFileRoute,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { z } from 'zod'

import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { resetAvailableFn } from '@/server/mail'
import { getPublicConfig, getSession } from '@/server/session'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ search }) => {
    const session = await getSession()
    if (session) {
      throw redirect({ href: search.redirect ?? '/libraries' })
    }
  },
  loader: async () => {
    const [config, resetAvailable] = await Promise.all([
      getPublicConfig(),
      resetAvailableFn(),
    ])
    return { ...config, resetAvailable }
  },
  component: LoginPage,
})

function LoginPage() {
  const { selfSignupOpen, resetAvailable } = Route.useLoaderData()
  const { redirect: redirectTo } = Route.useSearch()
  const router = useRouter()
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result =
      mode === 'signIn'
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            email,
            password,
            name: name.trim() || email,
          })
    setBusy(false)
    if (result.error) {
      setError(
        mode === 'signIn'
          ? 'Не получилось войти — проверьте почту и пароль.'
          : 'Не получилось создать аккаунт: ' +
              (result.error.message ?? 'попробуйте другую почту.'),
      )
      return
    }
    if (redirectTo) {
      await router.navigate({ href: redirectTo })
    } else {
      await router.navigate({ to: '/libraries' })
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 pb-10">
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid justify-items-center gap-2 text-center">
          <Logo large />
          <p className="text-muted-foreground">
            Домашняя библиотека, в которой всё стоит на своих местах
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form className="grid gap-4" onSubmit={(e) => void handleSubmit(e)}>
              {mode === 'signUp' && (
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Имя</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Алексей"
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="email">Почта</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.ru"
                  autoComplete="email"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="минимум 8 символов"
                  autoComplete={
                    mode === 'signIn' ? 'current-password' : 'new-password'
                  }
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" loading={busy}>
                {mode === 'signIn' ? 'Войти' : 'Создать аккаунт'}
              </Button>
              {mode === 'signIn' && resetAvailable && (
                <Link
                  to="/forgot"
                  className="text-center text-[13px] font-semibold text-accent-foreground"
                >
                  Забыли пароль?
                </Link>
              )}
            </form>
          </CardContent>
        </Card>

        {selfSignupOpen ? (
          <p className="text-center text-sm text-muted-foreground">
            {mode === 'signIn' ? (
              <>
                Система пуста — создайте первый аккаунт.{' '}
                <button
                  type="button"
                  className="font-semibold text-accent-foreground"
                  onClick={() => setMode('signUp')}
                >
                  Создать аккаунт
                </button>
              </>
            ) : (
              <>
                Уже есть аккаунт?{' '}
                <button
                  type="button"
                  className="font-semibold text-accent-foreground"
                  onClick={() => setMode('signIn')}
                >
                  Войти
                </button>
              </>
            )}
          </p>
        ) : (
          <p className="text-center text-[13px] text-muted-foreground">
            Регистрация — по ссылке-приглашению от того, кто уже в Полке.
          </p>
        )}
      </div>
    </main>
  )
}
