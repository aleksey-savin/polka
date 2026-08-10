import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { MoveDialog } from './MoveDialog'

/** Липкая панель массовых действий над выбранными книгами. */
export function BatchBar({
  selected,
  onClear,
  onDone,
}: {
  selected: Array<string>
  onClear: () => void
  onDone: () => void
}) {
  const [moveOpen, setMoveOpen] = useState(false)
  if (selected.length === 0) return null
  return (
    <>
      <div className="sticky bottom-20 z-10 mt-4 flex items-center gap-3 rounded-xl bg-foreground px-4 py-2.5 text-white shadow-lg md:bottom-4">
        <b className="text-sm">
          {selected.length === 1
            ? 'Выбрана 1 книга'
            : `Выбраны ${selected.length} кн.`}
        </b>
        <Button size="sm" onClick={() => setMoveOpen(true)}>
          Переместить на полку
        </Button>
        <button
          type="button"
          className="text-[13px] font-semibold text-white/75"
          onClick={onClear}
        >
          Снять выбор
        </button>
      </div>
      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        bookIds={selected}
        onMoved={() => {
          onClear()
          onDone()
        }}
      />
    </>
  )
}
