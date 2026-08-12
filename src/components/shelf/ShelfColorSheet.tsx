import { useState } from 'react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { updateShelfFn } from '@/server/shelves'

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

/** Шторка «Цвет полки»: авто-патина / 8 пресетов / свой цвет. */
export function ShelfColorSheet({
  shelfId,
  accentColor,
  open,
  onOpenChange,
  onChanged,
}: {
  shelfId: string
  accentColor: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function apply(color: string | null) {
    setBusy(true)
    try {
      await updateShelfFn({ data: { shelfId, accentColor: color } })
      onOpenChange(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const swatchCls =
    'relative grid size-11 place-items-center rounded-full border-2 disabled:opacity-50'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <DialogTitle className="text-[17px] font-semibold">
          Цвет полки
        </DialogTitle>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            title="Автопатина"
            disabled={busy}
            onClick={() => void apply(null)}
            className={`${swatchCls} ${
              accentColor === null ? 'border-primary' : 'border-transparent'
            }`}
            style={{
              background:
                'linear-gradient(120deg, var(--patina-old), var(--patina-fresh))',
            }}
          >
            {accentColor === null && (
              <span className="font-semibold text-accent-foreground">✓</span>
            )}
          </button>
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              title={p.name}
              disabled={busy}
              onClick={() => void apply(p.value)}
              className={`${swatchCls} ${
                accentColor === p.value
                  ? 'border-primary'
                  : 'border-transparent'
              }`}
              style={{ background: p.value }}
            >
              {accentColor === p.value && (
                <span className="font-semibold text-white/90">✓</span>
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Автопатина: полка сама темнеет к старым книгам и светлеет к новым.
        </p>
        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="color"
            className="size-[30px] cursor-pointer rounded-full border-0 bg-transparent p-0"
            value={accentColor ?? '#E9ADBC'}
            onChange={(e) => void apply(e.target.value.toUpperCase())}
            aria-label="Свой цвет"
          />
          Свой цвет…
        </label>
      </DialogContent>
    </Dialog>
  )
}
