import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { toast } from 'sonner'

import { Logo } from '@/components/layout/Logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

/** Переход по ссылке из письма: задаём новый пароль (M22). */
export const Route = createFileRoute('/reset')({
  validateSearch: z.object({ token: z.string().optional() }),
  component: ResetPage,
})

function ResetPage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!token) return
    setBusy(true)
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (result.error) throw new Error(result.error.message)
      toast.success('Пароль изменён — входите')
      await navigate({ to: '/login' })
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : 'Ссылка не подошла — запросите новую',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-[420px] content-center px-5 py-8">
      <Logo />
      <h1 className="mt-5 text-[25px] leading-tight font-semibold">
        Новый пароль
      </h1>

      {!token ? (
        <p className="mt-3 text-[14.5px] text-muted-foreground">
          Ссылка неполная. Откройте её из письма целиком или{' '}
          <Link to="/forgot" className="underline">
            запросите новую
          </Link>
          .
        </p>
      ) : (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="r-pass">Пароль</Label>
            <Input
              id="r-pass"
              type="password"
              autoComplete="new-password"
              className="h-12 rounded-xl text-[16px]"
              placeholder="не короче 8 символов"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            className="h-12"
            loading={busy}
            disabled={password.length < 8}
          >
            Сохранить и войти
          </Button>
        </form>
      )}
    </main>
  )
}
