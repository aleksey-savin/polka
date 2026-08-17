import { useEffect, useRef, useState } from 'react'

/**
 * Текст с ограничением по строкам и кнопкой «Развернуть».
 *
 * Кнопка появляется не по длине строки (это гадание: на узком экране обрезается
 * и короткий текст), а по факту — когда содержимое не поместилось.
 */
export function ExpandableText({
  text,
  lines = 4,
  className = '',
  size = 'md',
}: {
  text: string
  lines?: 2 | 3 | 4
  className?: string
  size?: 'sm' | 'md'
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || open) return
    const check = () => setClipped(el.scrollHeight > el.clientHeight + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, open, lines])

  const clamp = { 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' }[
    lines
  ]

  return (
    <>
      <p
        ref={ref}
        className={`${open ? '' : clamp} ${
          size === 'md'
            ? 'text-[15px] leading-[1.65]'
            : 'text-[12.5px] leading-[1.5]'
        } whitespace-pre-line ${className}`}
      >
        {text}
      </p>
      {clipped && (
        <button
          type="button"
          className={`mt-1 font-medium text-accent-foreground ${
            size === 'md' ? 'text-[13.5px]' : 'text-[12px]'
          }`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Свернуть' : 'Развернуть'}
        </button>
      )}
    </>
  )
}
