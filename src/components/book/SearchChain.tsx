import { useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * Лента цепочки поиска (M32) — макет `docs/design/add-search.html`.
 *
 * Один список отвечает на три вопроса: кого спросили, докуда дошли и что
 * каждый ответил. Порядок строк — настоящий порядок опроса из «Источников».
 * «Не дошли» кодируется формой точки и линии, а не бледностью: приглушённый
 * текст ушёл бы ниже контраста AA, а читать его надо так же.
 */
export interface Probe {
  name: string
  outcome: string
  detail: string | null
}

/** Событие, а не состояние: рамку получают только находка и отказ. */
const STAMP: Record<string, string> = {
  нашёл: 'border-primary/60 text-primary',
  ошибка: 'border-destructive/60 text-destructive',
}

function Row({ probe }: { probe: Probe }) {
  const skipped = probe.outcome === 'выключен' || probe.outcome === 'не успели'
  const stamp = STAMP[probe.outcome]
  return (
    <li className="relative flex min-h-9 items-center gap-2.5 pl-6.5">
      <span
        aria-hidden
        className={cn(
          'absolute top-0 bottom-0 left-[5px] w-0 border-l-2',
          skipped
            ? 'border-dotted border-muted-foreground/40'
            : 'border-primary/35',
        )}
      />
      <span
        aria-hidden
        className={cn(
          'absolute top-3 left-0 size-3 rounded-full border-2 bg-background',
          probe.outcome === 'нашёл' && 'border-primary bg-primary',
          probe.outcome === 'ошибка' && 'border-destructive bg-destructive',
          skipped && 'border-dotted border-muted-foreground',
          !stamp && !skipped && 'border-border',
        )}
      />
      <span
        className={cn('text-sm', probe.outcome === 'нашёл' && 'font-semibold')}
      >
        {probe.name}
      </span>
      <span className="ml-auto text-right font-mono text-[11.5px] text-muted-foreground">
        {stamp ? (
          <span
            className={cn(
              'inline-block -rotate-2 rounded border-[1.5px] bg-background/60 px-1.5 py-px text-[10px] tracking-[0.1em] uppercase',
              stamp,
            )}
          >
            {probe.outcome}
          </span>
        ) : (
          probe.outcome
        )}
      </span>
    </li>
  )
}

export function SearchChain({
  probes,
  truncated,
  found,
}: {
  probes: Array<Probe>
  truncated: boolean
  /** Кто ответил: когда книга нашлась, подробности прячем за кнопкой. */
  found: Array<string>
}) {
  const [open, setOpen] = useState(false)
  if (probes.length === 0) return null

  const names = probes
    .filter((p) => p.outcome === 'нашёл')
    .map((p) => p.name)
    .join(', ')

  // хорошая новость короткая: экран отдан книге, лента — по запросу
  if (found.length > 0 && !open) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t pt-2.5 text-[13px] text-muted-foreground">
        <span>Нашли: {names}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto min-h-11 pl-2.5 text-[13px] font-medium text-primary"
        >
          Как искали
        </button>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <ol className="list-none p-0">
        {probes.map((probe) => (
          <Row key={probe.name} probe={probe} />
        ))}
      </ol>
      {truncated && (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Сохраним по номеру — карточка дополнится сама.
        </p>
      )}
    </div>
  )
}
