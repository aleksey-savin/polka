import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { dateHuman } from '@/lib/dates'
import {
  checkAiFn,
  getAiSettingsFn,
  listAiModelsFn,
  saveAiSettingsFn,
} from '@/server/ai'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'

/**
 * Подключение ИИ (M24). Только доступность модели: ключ, каталог, модель,
 * проверка связи, суточный лимит. Функции придут дальше по одной.
 */
export const Route = createFileRoute('/_app/service_/ai')({
  loader: () => getAiSettingsFn(),
  component: AiPage,
})

const FIELD = 'h-12 rounded-xl text-[16px]'

const PROVIDERS = [
  { value: 'yandex' as const, label: 'Yandex AI Studio' },
  { value: 'openai' as const, label: 'OpenAI-совместимый' },
]

function AiPage() {
  const { settings } = Route.useLoaderData()
  const router = useRouter()

  const [form, setForm] = useState({
    // тумблер уехал в «Источники»; здесь только учётные данные
    enabled: settings.enabled,
    provider: settings.provider,
    apiKey: '',
    folderId: settings.folderId,
    model: settings.model,
    endpoint: settings.endpoint,
  })
  const [busy, setBusy] = useState<'save' | 'check' | null>(null)
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(
    null,
  )
  const [picker, setPicker] = useState<{
    open: boolean
    query: string
    models: Array<string>
    note: string | null
    loading: boolean
  }>({ open: false, query: '', models: [], note: null, loading: false })

  const set = <TKey extends keyof typeof form>(
    key: TKey,
    value: (typeof form)[TKey],
  ) => setForm((f) => ({ ...f, [key]: value }))

  async function save() {
    setBusy('save')
    try {
      await saveAiSettingsFn({
        data: { ...form, dailyLimit: settings.dailyLimit },
      })
      setForm((f) => ({ ...f, apiKey: '' }))
      toast.success('Настройки сохранены')
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(null)
    }
  }

  async function runCheck() {
    setBusy('check')
    setCheck(null)
    try {
      setCheck(await checkAiFn())
      void router.invalidate()
    } catch (e) {
      setCheck({
        ok: false,
        message: e instanceof Error ? e.message : 'Не получилось',
      })
    } finally {
      setBusy(null)
    }
  }

  async function openPicker() {
    setPicker((p) => ({ ...p, open: !p.open }))
    if (picker.models.length > 0 || picker.loading) return
    setPicker((p) => ({ ...p, loading: true }))
    try {
      const result = await listAiModelsFn()
      setPicker((p) => ({
        ...p,
        models: result.models,
        note: result.note,
        loading: false,
      }))
    } catch {
      setPicker((p) => ({
        ...p,
        loading: false,
        note: 'Список не пришёл — впишите модель руками',
      }))
    }
  }

  const failed = settings.lastResult?.startsWith('ошибка') ?? false
  const state = !settings.enabled
    ? 'off'
    : !settings.configured
      ? 'off'
      : failed
        ? 'bad'
        : 'ok'

  const shown = picker.models.filter((m) =>
    m.toLowerCase().includes(picker.query.trim().toLowerCase()),
  )

  return (
    <div className="mx-auto max-w-[580px] pb-6">
      <Breadcrumbs
        items={[{ label: 'Настройки', to: '/service' }, { label: 'ИИ' }]}
      />
      <h1 className="mb-4 text-[25px] leading-tight font-semibold">ИИ</h1>

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
              ? 'ИИ отвечает'
              : state === 'bad'
                ? 'Последний запрос не удался'
                : 'ИИ не подключён'}
          </p>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {settings.lastResult
              ? `${settings.lastResult}${
                  settings.lastResultAt
                    ? ` · ${dateHuman(settings.lastResultAt)}`
                    : ''
                }`
              : 'Нужны ключ, каталог и модель'}
          </p>
        </div>
      </div>

      <div className="mt-2 grid gap-1.5">
        <Label>Провайдер</Label>
        <div className="grid grid-cols-2 gap-1 rounded-xl border bg-card p-1">
          {PROVIDERS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`min-h-10 rounded-lg text-[13.5px] font-semibold ${
                form.provider === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground'
              }`}
              onClick={() => {
                set('provider', opt.value)
                setPicker({
                  open: false,
                  query: '',
                  models: [],
                  note: null,
                  loading: false,
                })
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[12.5px] text-muted-foreground">
          {form.provider === 'yandex'
            ? 'Зарубежные модели до российских книжных источников не дотягиваются.'
            : 'Любой сервис с API как у OpenAI — укажите адрес до /v1.'}
        </p>
      </div>

      <div className="mt-3 grid gap-1.5">
        <Label htmlFor="ai-key">API-ключ</Label>
        <Input
          id="ai-key"
          type="password"
          autoComplete="new-password"
          className={`${FIELD} font-mono`}
          placeholder={settings.hasKey ? '(задан)' : 'AQVN…'}
          value={form.apiKey}
          onChange={(e) => set('apiKey', e.target.value)}
        />
        {settings.hasKey && (
          <p className="text-[12.5px] text-muted-foreground">
            <b className="font-medium text-accent-foreground">сохранён</b> ·
            пустое поле — оставить прежний
          </p>
        )}
      </div>

      {form.provider === 'yandex' ? (
        <div className="mt-3 grid gap-1.5">
          <Label htmlFor="ai-folder">Каталог (folder ID)</Label>
          <Input
            id="ai-folder"
            className={`${FIELD} font-mono`}
            placeholder="b1g…"
            value={form.folderId}
            onChange={(e) => set('folderId', e.target.value)}
          />
          <p className="text-[12.5px] text-muted-foreground">
            Из консоли Yandex Cloud, там же где сервисный аккаунт с ключом.
          </p>
        </div>
      ) : (
        <div className="mt-3 grid gap-1.5">
          <Label htmlFor="ai-endpoint">Адрес API</Label>
          <Input
            id="ai-endpoint"
            className={`${FIELD} font-mono`}
            placeholder="https://api.example.ru/v1"
            value={form.endpoint}
            onChange={(e) => set('endpoint', e.target.value)}
          />
        </div>
      )}

      <div className="mt-3 grid gap-1.5">
        <Label htmlFor="ai-model">Модель</Label>
        <div className="flex gap-2">
          <Input
            id="ai-model"
            className={`${FIELD} font-mono`}
            placeholder="yandexgpt/latest"
            value={form.model}
            onChange={(e) => set('model', e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            className="h-12 flex-none rounded-xl"
            onClick={() => void openPicker()}
          >
            Выбрать
          </Button>
        </div>

        {picker.open && (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b p-2">
              <Input
                className="h-10 rounded-lg text-[15px]"
                placeholder="Поиск по названию"
                value={picker.query}
                onChange={(e) =>
                  setPicker((p) => ({ ...p, query: e.target.value }))
                }
              />
            </div>
            {picker.loading ? (
              <p className="px-3 py-3 text-[13px] text-muted-foreground">
                Загружаю список…
              </p>
            ) : shown.length > 0 ? (
              <div className="max-h-[240px] overflow-y-auto">
                {shown.map((model) => (
                  <button
                    key={model}
                    type="button"
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left font-mono text-[13px] ${
                      form.model === model
                        ? 'bg-accent/60 font-semibold text-accent-foreground'
                        : ''
                    }`}
                    onClick={() => {
                      set('model', model)
                      setPicker((p) => ({ ...p, open: false }))
                    }}
                  >
                    {model}
                    {form.model === model && (
                      <span className="font-sans text-[11px]">выбрана</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-3 py-3 text-[13px] text-muted-foreground">
                Ничего не нашлось — впишите название в поле выше.
              </p>
            )}
          </div>
        )}

        {picker.note && !picker.loading && (
          <p className="text-[12.5px] text-muted-foreground">{picker.note}</p>
        )}
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
          loading={busy === 'check'}
          disabled={!settings.configured || !settings.enabled}
          onClick={() => void runCheck()}
        >
          Проверить
        </Button>
      </div>
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        Проверка отправляет короткий запрос и тратит один из суточных.
      </p>

      {check && (
        <div
          className={`mt-3 rounded-xl border px-3 py-2.5 text-[13px] ${
            check.ok
              ? 'border-primary/45 bg-accent/40'
              : 'border-destructive/40 bg-destructive/5'
          }`}
        >
          <b>{check.ok ? 'Модель ответила.' : 'Не получилось.'}</b>{' '}
          <code className="font-mono text-[12px]">{check.message}</code>
        </div>
      )}

      <p className="mt-6 rounded-2xl border bg-card px-3.5 py-3 text-[13px] text-muted-foreground">
        Здесь только подключение. Что и в каком порядке спрашивать, включая
        Яндекс Поиск, Нейропоиск и модель, — в{' '}
        <Link
          to="/service/sources"
          className="underline underline-offset-2 hover:text-foreground"
        >
          источниках книг
        </Link>
        ; там же лимиты.
      </p>
    </div>
  )
}
