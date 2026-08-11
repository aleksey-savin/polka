import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { MoveDialog } from './MoveDialog'
import type { MoveTarget } from './MoveDialog'

/** Компактная липкая панель массовых действий: «N кн. · Переместить · ✕». */
export function BatchBar({
  selected,
  onClear,
  onMoved,
  defaultLibraryId,
  defaultShelfId,
  contextLabel,
}: {
  selected: Array<string>
  onClear: () => void
  onMoved: (target: MoveTarget) => void
  defaultLibraryId?: string
  defaultShelfId?: string | null
  contextLabel?: string
}) {
  const [moveOpen, setMoveOpen] = useState(false)
  if (selected.length === 0) return null
  return (
    <>
      {/* На мобильном панель встаёт на место таббара (z выше), на десктопе — плашка снизу */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2.5 bg-foreground p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-4 text-white shadow-[0_-8px_24px_-12px_rgba(35,43,56,.5)] md:inset-x-auto md:bottom-6 md:left-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:rounded-2xl md:pb-3 md:shadow-lg">
        <b className="flex-none font-mono text-sm font-medium whitespace-nowrap">
          {selected.length} кн.
        </b>
        <Button className="h-12 flex-1" onClick={() => setMoveOpen(true)}>
          Переместить
        </Button>
        <button
          type="button"
          aria-label="Снять выбор"
          className="grid size-11 flex-none place-items-center rounded-full bg-white/10 text-[15px] text-white/85"
          onClick={onClear}
        >
          ✕
        </button>
      </div>
      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        bookIds={selected}
        defaultLibraryId={defaultLibraryId}
        defaultShelfId={defaultShelfId}
        contextLabel={contextLabel}
        onMoved={onMoved}
      />
    </>
  )
}
