import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { ServiceTabs } from '@/components/layout/ServiceTabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { dateHuman } from '@/lib/dates'
import {
  getMailSettingsFn,
  saveMailSettingsFn,
  sendTestMailFn,
} from '@/server/mail'
import { getSession } from '@/server/session'

/** Настройки почты (M22): всё в приложении, пароль — зашифрованным в базе. */
export const Route = createFileRoute('/_app/service_/mail')({
  loader: async () => {
    const [settings, session] = await Promise.all([
      getMailSettingsFn(),
      getSession(),
    ])
    return { settings, myEmail: session?.user.email ?? '' }
  },
  component: MailPage,
})

const FIELD = 'h-12 rounded-xl text-[16px]'

const SECURE = [
  { value: 'none' as const, label: 'Нет' },
  { value: 'starttls' as const, label: 'STARTTLS' },
  { value: 'tls' as const, label: 'TLS' },
]

const LETTERS = [
  {
    key: 'sendReset' as const,
    title: 'Сброс пароля',
    sub: 'Ссылка на час; на входе появляется «Забыли пароль?»',
  },
  {
    key: 'sendInvites' as const,
    title: 'Приглашения',
    sub: 'Ввели адрес — человеку пришла ссылка на регистрацию',
  },
  {
    key: 'sendEmailChange' as const,
    title: 'Подтверждение смены почты',
    sub: 'Пока новый адрес не подтверждён, вход по старому',
  },
  {
    key: 'sendNotifications' as const,
    title: 'Уведомления',
    sub: 'Заявка «хочу почитать» и снятие публикации модератором',
  },
]

function MailPage() {
  const { settings, myEmail } = Route.useLoaderData()
  const router = useRouter()

  const [form, setForm] = useState({
    host: settings.host,
    port: settings.port?.toString() ?? '465',
    secure: settings.secure,
    username: settings.username,
    password: '',
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    sendReset: settings.sendReset,
    sendInvites: settings.sendInvites,
    sendEmailChange: settings.sendEmailChange,
    sendNotifications: settings.sendNotifications,
  })
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(
    null,
  )

  const set = <TKey extends keyof typeof form>(
    key: TKey,
    value: (typeof form)[TKey],
  ) => setForm((f) => ({ ...f, [key]: value }))

  async function save() {
    setBusy('save')
    try {
      await saveMailSettingsFn({
        data: { ...form, port: Number(form.port) || 465 },
      })
      setForm((f) => ({ ...f, password: '' }))
      toast.success('Настройки сохранены')
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(null)
    }
  }

  async function sendTest() {
    setBusy('test')
    setTest(null)
    try {
      setTest(await sendTestMailFn({ data: { to: myEmail } }))
      void router.invalidate()
    } catch (e) {
      setTest({
        ok: false,
        message: e instanceof Error ? e.message : 'Не получилось',
      })
    } finally {
      setBusy(null)
    }
  }

  const state = settings.configured
    ? settings.lastResult?.startsWith('ошибка')
      ? 'bad'
      : 'ok'
    : 'off'

  return (
    <div className="mx-auto max-w-[580px] pb-6">
      <h1 className="mb-4 text-[25px] leading-tight font-semibold">Сервис</h1>
      <ServiceTabs isAdmin />

      <div
        className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 ${
          state === 'ok'
            ? 'border-primary/40 bg-accent/40'
            : state === 'bad'
              ? 'border-destructive/40 bg-destructive/5'
              : 'bg-card'
        }`}
      >
        <span
          aria-hidden
          className={`size-2.5 flex-none rounded-full ${
            state === 'ok'
              ? 'bg-primary'
              : state === 'bad'
                ? 'bg-destructive'
                : 'bg-muted-foreground'
          }`}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {state === 'ok'
              ? 'Почта настроена'
              : state === 'bad'
                ? 'Последняя отправка не удалась'
                : 'Почта не настроена'}
          </p>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {settings.lastResult
              ? `${settings.lastResult}${
                  settings.lastResultAt
                    ? ` · ${dateHuman(settings.lastResultAt)}`
                    : ''
                }`
              : 'Письма не отправляются, сброс пароля недоступен'}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_110px] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="m-host">Сервер</Label>
          <Input
            id="m-host"
            className={FIELD}
            placeholder="smtp.yandex.ru"
            value={form.host}
            onChange={(e) => set('host', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-port">Порт</Label>
          <Input
            id="m-port"
            inputMode="numeric"
            className={`${FIELD} font-mono`}
            value={form.port}
            onChange={(e) => set('port', e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-1.5">
        <Label>Шифрование</Label>
        <div className="grid grid-cols-3 gap-1 rounded-xl border bg-card p-1">
          {SECURE.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`min-h-10 rounded-lg text-[13.5px] font-semibold ${
                form.secure === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground'
              }`}
              onClick={() => set('secure', opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-1.5">
        <Label htmlFor="m-user">Логин</Label>
        <Input
          id="m-user"
          className={FIELD}
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
        />
      </div>

      <div className="mt-3 grid gap-1.5">
        <Label htmlFor="m-pass">Пароль</Label>
        <Input
          id="m-pass"
          type="password"
          autoComplete="new-password"
          className={FIELD}
          placeholder={
            settings.hasPassword ? 'введите, чтобы заменить' : 'пароль почты'
          }
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
        />
        {settings.hasPassword && (
          <p className="text-[12.5px] text-muted-foreground">
            <b className="font-medium text-accent-foreground">сохранён</b> ·
            показать нельзя, только заменить
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="m-from-name">Отправитель — имя</Label>
          <Input
            id="m-from-name"
            className={FIELD}
            value={form.fromName}
            onChange={(e) => set('fromName', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-from">Адрес</Label>
          <Input
            id="m-from"
            className={FIELD}
            placeholder="polka@example.ru"
            value={form.fromEmail}
            onChange={(e) => set('fromEmail', e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="h-11"
          loading={busy === 'save'}
          onClick={() => void save()}
        >
          Сохранить
        </Button>
        <Button
          variant="outline"
          className="h-11"
          loading={busy === 'test'}
          disabled={!settings.configured}
          onClick={() => void sendTest()}
        >
          Отправить тестовое
        </Button>
      </div>

      {test && (
        <div
          className={`mt-3 rounded-xl border px-3 py-2.5 text-[13px] ${
            test.ok
              ? 'border-primary/45 bg-accent/40'
              : 'border-destructive/40 bg-destructive/5'
          }`}
        >
          <b>{test.ok ? 'Отправлено.' : 'Не отправилось.'}</b> Сервер ответил:{' '}
          <code className="font-mono text-[12px]">{test.message}</code>
          {test.ok && ` Проверьте ящик ${myEmail}.`}
        </div>
      )}

      <h2 className="mt-7 text-[17px] font-semibold">Какие письма отправлять</h2>
      <div className="mt-2">
        {LETTERS.map((letter) => (
          <div
            key={letter.key}
            className="flex items-center gap-3 border-t py-3 first:border-t-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold">{letter.title}</p>
              <p className="text-[12.5px] text-muted-foreground">
                {letter.sub}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form[letter.key]}
              aria-label={letter.title}
              className={`relative h-7 w-[46px] flex-none rounded-full transition-colors ${
                form[letter.key] ? 'bg-primary' : 'bg-border'
              }`}
              onClick={() => set(letter.key, !form[letter.key])}
            >
              <span
                aria-hidden
                className={`absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white shadow transition-transform ${
                  form[letter.key] ? 'translate-x-[18px]' : ''
                }`}
              />
            </button>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Переключатели вступают в силу после «Сохранить».
      </p>
    </div>
  )
}
