import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'

import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
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
import { getAiSettingsFn, saveAiSettingsFn } from '@/server/ai'
import {
  getSourceSettingsFn,
  listSourcesFn,
  moveSourceFn,
  probeSourcesFn,
  saveSourceSettingsFn,
  saveWebSettingsFn,
  setSourceEnabledFn,
} from '@/server/sources'
import type { SourceProbe } from '@/services/sources'

/**
 * Источники книг (M30).
 *
 * Один список — он же порядок опроса: код поиска читает его из базы. Раньше
 * порядок был зашит, FantLab и OpenLibrary нельзя было выключить, а настройки
 * ИИ жили в двух местах.
 */
export const Route = createFileRoute('/_app/service_/sources')({
  loader: async () => {
    const [sources, settings, ai] = await Promise.all([
      listSourcesFn(),
      getSourceSettingsFn(),
      getAiSettingsFn(),
    ])
    return { sources, settings, ai }
  },
  component: SourcesPage,
})

function SourcesPage() {
  const { sources, settings, ai } = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [probe, setProbe] = useState<Array<SourceProbe> | null>(null)
  const [googleOpen, setGoogleOpen] = useState(false)
  const [googleKey, setGoogleKey] = useState('')
  const [modelLimit, setModelLimit] = useState(
    ai.settings.dailyLimit.toString(),
  )
  const [searchLimit, setSearchLimit] = useState(
    settings.web.dailyLimit.toString(),
  )

  const refresh = () => void router.invalidate()

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key)
    try {
      await action()
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(null)
    }
  }

  async function saveLimits() {
    setBusy('limits')
    try {
      await Promise.all([
        saveAiSettingsFn({
          data: {
            enabled: ai.settings.enabled,
            provider: ai.settings.provider,
            folderId: ai.settings.folderId,
            model: ai.settings.model,
            endpoint: ai.settings.endpoint,
            dailyLimit: Number(modelLimit) || 0,
          },
        }),
        saveWebSettingsFn({
          data: {
            enabled: settings.web.enabled,
            paidFallback: settings.web.paidFallback,
            dailyLimit: Number(searchLimit) || 0,
          },
        }),
      ])
      toast.success('Лимиты сохранены')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-[580px] pb-6">
      <Breadcrumbs
        items={[{ label: 'Настройки', to: '/service' }, { label: 'Источники' }]}
      />
      <h1 className="text-[25px] leading-tight font-semibold">
        Источники книг
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Спрашиваем сверху вниз и останавливаемся на первом, кто ответил.
      </p>

      <div className="mt-4">
        {sources.map((source, index) => (
          <div
            key={source.key}
            className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
          >
            <span className="w-[22px] flex-none text-center font-mono text-xs text-muted-foreground">
              {index + 1}
            </span>
            <button
              type="button"
              disabled={!source.settings}
              className={`min-w-0 flex-1 text-left ${
                source.enabled || source.locked ? '' : 'opacity-50'
              }`}
              onClick={() => {
                if (source.settings === 'google') setGoogleOpen(true)
                if (source.settings === 'ai')
                  void router.navigate({ to: '/service/ai' })
              }}
            >
              <span className="block text-[15px] font-semibold">
                {source.name}
              </span>
              <span className="block text-[12.5px] text-muted-foreground">
                <span
                  className={source.paid ? 'text-[#6F5227]' : 'text-primary'}
                >
                  {source.paid ? 'платно' : 'бесплатно'}
                </span>
                {' · '}
                {source.key === 'google' && !settings.hasGoogleKey
                  ? 'нужен ключ'
                  : source.hint}
              </span>
            </button>

            {source.locked ? (
              <span className="flex-none rounded border px-1.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                всегда
              </span>
            ) : (
              <>
                <span className="grid flex-none gap-[3px]">
                  <button
                    type="button"
                    aria-label={`${source.name}: выше`}
                    disabled={index <= 1 || busy !== null}
                    className="grid h-6 w-[34px] place-items-center rounded-lg border bg-card text-muted-foreground disabled:opacity-30"
                    onClick={() =>
                      void run(source.key, () =>
                        moveSourceFn({
                          data: { key: source.key, direction: 'up' },
                        }),
                      )
                    }
                  >
                    <ChevronUp className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`${source.name}: ниже`}
                    disabled={index >= sources.length - 1 || busy !== null}
                    className="grid h-6 w-[34px] place-items-center rounded-lg border bg-card text-muted-foreground disabled:opacity-30"
                    onClick={() =>
                      void run(source.key, () =>
                        moveSourceFn({
                          data: { key: source.key, direction: 'down' },
                        }),
                      )
                    }
                  >
                    <ChevronDown className="size-3.5" aria-hidden />
                  </button>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={source.enabled}
                  aria-label={source.name}
                  className={`relative h-7 w-[46px] flex-none rounded-full transition-colors ${
                    source.enabled ? 'bg-primary' : 'bg-border'
                  }`}
                  onClick={() =>
                    void run(source.key, () =>
                      setSourceEnabledFn({
                        data: { key: source.key, enabled: !source.enabled },
                      }),
                    )
                  }
                >
                  <span
                    aria-hidden
                    className={`absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white shadow transition-transform ${
                      source.enabled ? 'translate-x-[18px]' : ''
                    }`}
                  />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-11"
          loading={busy === 'probe'}
          onClick={() =>
            void run('probe', async () => {
              setProbe(await probeSourcesFn())
            })
          }
        >
          Проверить источники
        </Button>
      </div>

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

      <section className="mt-7">
        <SectionLabel>Расходы</SectionLabel>
        <p className="mb-3 text-[13px] text-muted-foreground">
          Два счёта: модель тарифицируется по токенам, поиск — за запрос.
        </p>
        <div className="grid gap-2.5">
          <LimitCard
            title="Запросы к модели"
            price="по токенам"
            used={ai.usage.used}
            limit={ai.usage.limit}
            value={modelLimit}
            onChange={setModelLimit}
          />
          <LimitCard
            title="Запросы к поиску"
            price="за запрос"
            used={settings.web.used}
            limit={settings.web.dailyLimit}
            value={searchLimit}
            onChange={setSearchLimit}
          />
        </div>
        <Button
          className="mt-3 h-11"
          loading={busy === 'limits'}
          onClick={() => void saveLimits()}
        >
          Сохранить лимиты
        </Button>
      </section>

      <Drawer open={googleOpen} onOpenChange={setGoogleOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Google Books</DrawerTitle>
          </DrawerHeader>
          <p className="text-[13px] text-muted-foreground">
            Широкий охват, бесплатно. Без ключа отвечает «квота исчерпана».
          </p>
          <div className="mt-3 grid gap-1.5">
            <Label htmlFor="g-key">Ключ</Label>
            <Input
              id="g-key"
              type="password"
              autoComplete="new-password"
              className="h-12 rounded-xl font-mono text-[16px]"
              placeholder={settings.hasGoogleKey ? '(задан)' : 'AIza…'}
              value={googleKey}
              onChange={(e) => setGoogleKey(e.target.value)}
            />
            <p className="text-[12.5px] text-muted-foreground">
              Из консоли Google Cloud, услуга Books API. Ограничение по домену
              подходит: запрос уходит с реферером этого сайта.
            </p>
          </div>
          <DrawerFooter>
            <Button
              className="h-12 w-full text-[15px]"
              loading={busy === 'google'}
              disabled={!googleKey.trim()}
              onClick={() =>
                void run('google', async () => {
                  await saveSourceSettingsFn({ data: { googleKey } })
                  setGoogleKey('')
                  setGoogleOpen(false)
                  toast.success('Ключ сохранён')
                })
              }
            >
              Сохранить
            </Button>
            <Button
              variant="outline"
              className="h-12 w-full text-[15px]"
              onClick={() => setGoogleOpen(false)}
            >
              Отмена
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

/** Лимит с расходом за сегодня: видно, что куда уходит. */
function LimitCard({
  title,
  price,
  used,
  limit,
  value,
  onChange,
}: {
  title: string
  price: string
  used: number
  limit: number
  value: string
  onChange: (next: string) => void
}) {
  const share = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="flex items-baseline gap-2">
        <b className="text-[14.5px]">{title}</b>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {price}
        </span>
      </div>
      <div className="my-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div className="h-full bg-primary" style={{ width: `${share}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>сегодня {used}</span>
        <span>из {limit}</span>
      </div>
      <Input
        inputMode="numeric"
        aria-label={`Лимит: ${title}`}
        className="mt-2 h-11 w-[110px] rounded-xl font-mono text-[16px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
