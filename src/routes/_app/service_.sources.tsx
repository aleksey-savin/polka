import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { ServiceTabs } from '@/components/layout/ServiceTabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { dateHuman } from '@/lib/dates'
import {
  checkWebSearchFn,
  getSourceSettingsFn,
  probeSourcesFn,
  saveSourceSettingsFn,
  saveWebSettingsFn,
} from '@/server/sources'
import type { SourceProbe } from '@/services/sources'

/**
 * Источники метаданных (M25.1). Google Books без ключа отвечает 429, и для
 * человека это выглядит как «книга не нашлась» — поэтому ключ здесь, а не
 * только в переменных окружения.
 */
export const Route = createFileRoute('/_app/service_/sources')({
  loader: () => getSourceSettingsFn(),
  component: SourcesPage,
})

const MODES = [
  {
    value: 'extract' as const,
    title: 'Поиск и извлечение',
    sub: 'Берём выдачу, модель читает сниппеты. Принимаем то, где встретился сам ISBN.',
    price: '≈50–200 ₽ / 1000 поисков',
  },
  {
    value: 'generative' as const,
    title: 'Генеративный ответ',
    sub: 'Модель ищет и отвечает сама, со списком источников.',
    price: '≈5 ₽ / книга',
  },
]

function SourcesPage() {
  const settings = Route.useLoaderData()
  const router = useRouter()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<
    'save' | 'probe' | 'web' | 'webcheck' | null
  >(null)
  const [probe, setProbe] = useState<Array<SourceProbe> | null>(null)
  const [web, setWeb] = useState({
    enabled: settings.web.enabled,
    mode: settings.web.mode,
    dailyLimit: settings.web.dailyLimit.toString(),
  })
  const [webCheck, setWebCheck] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  async function save() {
    setBusy('save')
    try {
      await saveSourceSettingsFn({ data: { googleKey: key } })
      setKey('')
      toast.success('Ключ сохранён')
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(null)
    }
  }

  async function check() {
    setBusy('probe')
    try {
      setProbe(await probeSourcesFn())
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(null)
    }
  }

  async function saveWeb() {
    setBusy('web')
    try {
      await saveWebSettingsFn({
        data: {
          enabled: web.enabled,
          mode: web.mode,
          dailyLimit: Number(web.dailyLimit) || 0,
        },
      })
      toast.success('Настройки поиска сохранены')
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(null)
    }
  }

  async function checkWeb() {
    setBusy('webcheck')
    setWebCheck(null)
    try {
      setWebCheck(await checkWebSearchFn())
      void router.invalidate()
    } catch (e) {
      setWebCheck({
        ok: false,
        message: e instanceof Error ? e.message : 'Не получилось',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-[580px] pb-6">
      <h1 className="mb-4 text-[25px] leading-tight font-semibold">Сервис</h1>
      <ServiceTabs isAdmin />

      <div className="rounded-2xl border bg-card px-3.5 py-3">
        <p className="text-sm font-semibold">Откуда берутся данные о книгах</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          По ISBN спрашиваем три источника сразу: FantLab (русская фантастика и
          издания), Google Books (широкий охват) и OpenLibrary. Первым всегда
          смотрим свой эталон.
        </p>
      </div>

      <div className="mt-4 grid gap-1.5">
        <Label htmlFor="gb-key">Ключ Google Books</Label>
        <Input
          id="gb-key"
          type="password"
          autoComplete="new-password"
          className="h-12 rounded-xl font-mono text-[16px]"
          placeholder={settings.hasGoogleKey ? '(задан)' : 'AIza…'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <p className="text-[12.5px] text-muted-foreground">
          {settings.hasGoogleKey ? (
            <>
              <b className="font-medium text-accent-foreground">сохранён</b>
              {settings.fromEnv && ' (из переменной окружения)'} · пустое поле —
              оставить прежний.{' '}
            </>
          ) : (
            <>
              Без ключа Google отвечает «квота исчерпана», и книги перестают
              находиться.{' '}
            </>
          )}
          Ключ из консоли Google Cloud, услуга Books API. Ограничение по домену
          подходит: запрос уходит с реферером этого сайта.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="h-11"
          loading={busy === 'save'}
          disabled={!key.trim()}
          onClick={() => void save()}
        >
          Сохранить
        </Button>
        <Button
          variant="outline"
          className="h-11"
          loading={busy === 'probe'}
          onClick={() => void check()}
        >
          Проверить источники
        </Button>
      </div>

      {settings.lastCheck && !probe && (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Последняя проверка: {settings.lastCheck}
          {settings.lastCheckAt && ` · ${dateHuman(settings.lastCheckAt)}`}
        </p>
      )}

      <h2 className="mt-7 text-[17px] font-semibold">Поиск в интернете</h2>
      <div className="mt-2 flex items-center gap-3 border-t py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold">Искать по ISBN</p>
          <p className="text-[12.5px] text-muted-foreground">
            Yandex Search API · ключ и каталог из вкладки «ИИ» · нужна роль
            search-api.webSearch.user
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={web.enabled}
          aria-label="Искать по ISBN в интернете"
          className={`relative h-7 w-[46px] flex-none rounded-full transition-colors ${
            web.enabled ? 'bg-primary' : 'bg-border'
          }`}
          onClick={() => setWeb((w) => ({ ...w, enabled: !w.enabled }))}
        >
          <span
            aria-hidden
            className={`absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white shadow transition-transform ${
              web.enabled ? 'translate-x-[18px]' : ''
            }`}
          />
        </button>
      </div>

      {!settings.web.ready && (
        <p className="text-[12.5px] text-destructive">
          Сначала задайте ключ и каталог на вкладке «ИИ» — поиск берёт их
          оттуда.
        </p>
      )}

      <div className="mt-2 grid gap-2">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            className={`flex items-start gap-3 rounded-2xl border p-3 text-left ${
              web.mode === mode.value
                ? 'border-primary/45 bg-accent/40'
                : 'bg-card'
            }`}
            onClick={() => setWeb((w) => ({ ...w, mode: mode.value }))}
          >
            <span
              aria-hidden
              className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full border-[1.5px] ${
                web.mode === mode.value ? 'border-primary' : 'border-border'
              }`}
            >
              {web.mode === mode.value && (
                <span className="size-2.5 rounded-full bg-primary" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold">
                {mode.title}
              </span>
              <span className="block text-[12.5px] text-muted-foreground">
                {mode.sub}
              </span>
              <span className="mt-0.5 block font-mono text-[11.5px] text-muted-foreground">
                {mode.price}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-1.5">
        <Label htmlFor="web-limit">Поисков в сутки</Label>
        <Input
          id="web-limit"
          inputMode="numeric"
          className="h-12 max-w-[140px] rounded-xl font-mono text-[16px]"
          value={web.dailyLimit}
          onChange={(e) =>
            setWeb((w) => ({ ...w, dailyLimit: e.target.value }))
          }
        />
        <p className="text-[12.5px] text-muted-foreground">
          Отдельно от лимита модели. Сегодня истрачено {settings.web.used}.
          {!settings.web.enabled &&
            ' Тумблер вступит в силу после «Сохранить поиск».'}
        </p>
      </div>

      {settings.web.lastResult && (
        <p className="mt-2 truncate text-[12.5px] text-muted-foreground">
          Поиск: {settings.web.lastResult}
          {settings.web.lastResultAt &&
            ` · ${dateHuman(settings.web.lastResultAt)}`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          className="h-11"
          loading={busy === 'web'}
          onClick={() => void saveWeb()}
        >
          Сохранить поиск
        </Button>
        <Button
          variant="outline"
          className="h-11"
          loading={busy === 'webcheck'}
          disabled={!settings.web.ready}
          onClick={() => void checkWeb()}
        >
          Проверить поиск
        </Button>
      </div>

      {webCheck && (
        <div
          className={`mt-3 rounded-xl border px-3 py-2.5 text-[13px] ${
            webCheck.ok
              ? 'border-primary/45 bg-accent/40'
              : 'border-destructive/40 bg-destructive/5'
          }`}
        >
          <b>{webCheck.ok ? 'Поиск отвечает.' : 'Не получилось.'}</b>{' '}
          <code className="font-mono text-[12px] break-words">
            {webCheck.message}
          </code>
        </div>
      )}

      {probe && (
        <div className="mt-3 grid gap-2">
          {probe.map((row) => (
            <div
              key={row.name}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[13px] ${
                row.ok
                  ? 'border-primary/40 bg-accent/40'
                  : 'border-destructive/40 bg-destructive/5'
              }`}
            >
              <span
                aria-hidden
                className={`mt-1.5 size-2 flex-none rounded-full ${
                  row.ok ? 'bg-primary' : 'bg-destructive'
                }`}
              />
              <span className="min-w-0">
                <b>{row.name}.</b>{' '}
                <span className="font-mono text-[12px] break-words">
                  {row.message}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
