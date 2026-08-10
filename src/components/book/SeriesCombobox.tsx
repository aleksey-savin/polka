import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { suggestSeriesFn } from '@/server/series'

/** Серия: свободный ввод с подсказками; новая серия создастся при сохранении книги. */
export function SeriesCombobox({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [hints, setHints] = useState<Array<{ id: string; name: string }>>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!value.trim()) {
      setHints([])
      return
    }
    timer.current = setTimeout(() => {
      void suggestSeriesFn({ data: { query: value } }).then((found) => {
        setHints(found.filter((h) => h.name !== value))
      })
    }, 200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value])

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Например: Миры братьев Стругацких"
        autoComplete="off"
      />
      {open && hints.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-popover shadow-md">
          {hints.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(h.name)
                  setOpen(false)
                }}
              >
                {h.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
