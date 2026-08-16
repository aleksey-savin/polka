import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

/**
 * Переключатель темы (M23). Выбор живёт в браузере, а не в профиле:
 * телефон ночью и ноутбук днём — разные истории.
 */

export type ThemeMode = 'light' | 'system' | 'dark'

const KEY = 'polka.theme'

export function readTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system'
  const stored = localStorage.getItem(KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function applyTheme(mode: ThemeMode): void {
  const dark =
    mode === 'dark' ||
    (mode === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  localStorage.setItem(KEY, mode)
}

const OPTIONS = [
  { value: 'light' as const, label: 'Светлая', icon: Sun },
  { value: 'system' as const, label: 'Авто', icon: Monitor },
  { value: 'dark' as const, label: 'Тёмная', icon: Moon },
]

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    setMode(readTheme())
    // в режиме «как в системе» следим за сменой ночного режима на лету
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (readTheme() === 'system') applyTheme('system')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return (
    <div
      role="radiogroup"
      aria-label="Тема оформления"
      className="grid flex-1 grid-cols-3 gap-1 rounded-full border bg-card p-1"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon
        const active = mode === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.label}
            title={opt.label}
            className={`flex items-center justify-center gap-1.5 rounded-full text-[12.5px] font-semibold ${
              compact ? 'min-h-8' : 'min-h-10'
            } ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground'
            }`}
            onClick={() => {
              setMode(opt.value)
              applyTheme(opt.value)
            }}
          >
            <Icon aria-hidden className="size-4" />
            {!compact && opt.label}
          </button>
        )
      })}
    </div>
  )
}
