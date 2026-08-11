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
      <div className="sticky bottom-24 z-10 mt-4 flex items-center gap-2.5 rounded-2xl bg-foreground p-2.5 pl-4 text-white shadow-lg md:bottom-4">
        <b className="flex-none font-mono text-sm font-medium whitespace-nowrap">
          {selected.length} кн.
        </b>
        <Button className="h-11 flex-1" onClick={() => setMoveOpen(true)}>
          Переместить
        </Button>
        <button
          type="button"
          aria-label="Снять выбор"
          className="grid size-10 flex-none place-items-center rounded-full bg-white/10 text-[15px] text-white/85"
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
