import { useState } from 'react'

import { updateShelfFn } from '@/server/shelves'
import type { ShelfTint } from '@/services/shelfTint'

export const ACCENT_PRESETS = [
  { name: 'роза', value: '#E9ADBC' },
  { name: 'охра', value: '#DFAE54' },
  { name: 'шалфей', value: '#A3BE9C' },
  { name: 'небо', value: '#9FBEDC' },
  { name: 'сирень', value: '#B7A3D0' },
  { name: 'кирпич', value: '#CE8B71' },
  { name: 'мята', value: '#A8CFC0' },
  { name: 'графит', value: '#8A93A3' },
]

/** Панель «Цвет полки»: авто-патина / пресеты / свой цвет. */
export function AccentPanel({
  shelfId,
  accentColor,
  tint,
  onChanged,
}: {
  shelfId: string
  accentColor: string | null
  tint: ShelfTint
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function apply(color: string | null) {
    setBusy(true)
    try {
      await updateShelfFn({ data: { shelfId, accentColor: color } })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const optionBase =
    'inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-[13px] text-muted-foreground disabled:opacity-50'
  const activeRing =
    'border-primary font-semibold text-accent-foreground shadow-[0_0_0_1px_var(--primary)]'

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3.5 shadow-xs">
      <b className="text-[13.5px]">Цвет полки:</b>
      <button
        type="button"
        disabled={busy}
        onClick={() => void apply(null)}
        className={`${optionBase} ${accentColor === null ? activeRing : ''}`}
      >
        <i
          className="size-[22px] rounded-full border border-foreground/10"
          style={{
            background: `linear-gradient(90deg, var(--patina-old), var(--patina-fresh))`,
          }}
        />
        Авто-патина
        {tint.medianYear !== null && accentColor === null
          ? ` · сейчас ${tint.medianYear}`
          : ''}
      </button>
      <div className="flex gap-1.5" role="group" aria-label="Пресеты цвета">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            title={p.name}
            disabled={busy}
            onClick={() => void apply(p.value)}
            className={`${optionBase} px-1.5 ${accentColor === p.value ? activeRing : ''}`}
          >
            <i
              className="size-[22px] rounded-full border border-foreground/10"
              style={{ background: p.value }}
            />
          </button>
        ))}
      </div>
      <label className={`${optionBase} cursor-pointer`}>
        <input
          type="color"
          className="size-[22px] cursor-pointer rounded-full border-0 bg-transparent p-0"
          value={accentColor ?? '#E9ADBC'}
          onChange={(e) => void apply(e.target.value.toUpperCase())}
          aria-label="Свой цвет"
        />
        Свой цвет…
      </label>
    </div>
  )
}
