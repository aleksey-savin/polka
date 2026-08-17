import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { ServiceTabs } from '@/components/layout/ServiceTabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { dateHuman } from '@/lib/dates'
import {
  getSourceSettingsFn,
  probeSourcesFn,
  saveSourceSettingsFn,
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

function SourcesPage() {
  const settings = Route.useLoaderData()
  const router = useRouter()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'save' | 'probe' | null>(null)
  const [probe, setProbe] = useState<Array<SourceProbe> | null>(null)

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
