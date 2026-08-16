import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'
import { resetAvailableFn } from '@/server/mail'

/** Сброс пароля по почте (M22). Доступен, только если SMTP настроен. */
export const Route = createFileRoute('/forgot')({
  loader: () => resetAvailableFn(),
  component: ForgotPage,
})

function ForgotPage() {
  const available = Route.useLoaderData()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: '/reset',
      })
      // отвечаем одинаково независимо от того, есть такой адрес или нет
      setSent(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-[420px] content-center px-5 py-8">
      <Logo />
      <h1 className="mt-5 text-[25px] leading-tight font-semibold">
        Забыли пароль
      </h1>

      {!available ? (
        <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
          Почта в этой Полке не настроена, поэтому письмо со ссылкой отправить
          некому. Попросите владельца сервера сбросить пароль вручную.
        </p>
      ) : sent ? (
        <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
          Если такой адрес зарегистрирован, письмо со ссылкой уже отправлено.
          Ссылка действует час и сработает один раз.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Пришлём письмо со ссылкой на смену пароля.
          </p>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="f-email">Почта</Label>
              <Input
                id="f-email"
                type="email"
                autoComplete="email"
                className="h-12 rounded-xl text-[16px]"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              className="h-12"
              loading={busy}
              disabled={!email.trim()}
            >
              Прислать ссылку
            </Button>
          </form>
        </>
      )}

      <p className="mt-5 text-[13px] text-muted-foreground">
        <Link to="/login" className="underline">
          Вернуться ко входу
        </Link>
      </p>
    </main>
  )
}
