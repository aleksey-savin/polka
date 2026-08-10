import { useState } from 'react'
import { X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

/** Тэги книги: чипы + ввод через Enter или запятую. */
export function TagsInput({
  value,
  onChange,
  suggestions = [],
}: {
  value: Array<string>
  onChange: (tags: Array<string>) => void
  suggestions?: Array<string>
}) {
  const [draft, setDraft] = useState('')

  function add(raw: string) {
    const name = raw.trim().replace(/,+$/, '')
    if (!name) return
    if (!value.some((t) => t.toLowerCase() === name.toLowerCase())) {
      onChange([...value, name])
    }
    setDraft('')
  }

  const unusedSuggestions = suggestions.filter(
    (s) => !value.some((t) => t.toLowerCase() === s.toLowerCase()),
  )

  return (
    <div className="grid gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 pr-1">
              {t}
              <button
                type="button"
                aria-label={`Убрать тэг ${t}`}
                onClick={() => onChange(value.filter((x) => x !== t))}
                className="rounded-full p-0.5 hover:bg-foreground/10"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => {
          if (e.target.value.endsWith(',')) add(e.target.value)
          else setDraft(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add(draft)
          }
        }}
        onBlur={() => add(draft)}
        placeholder="фантастика, перечитать… (Enter добавляет)"
      />
      {unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {unusedSuggestions.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-accent-foreground"
              onClick={() => add(s)}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
