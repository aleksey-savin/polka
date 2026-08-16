/** Доска полки: цвет — ручной акцент или авто-патина. */
export function ShelfBoard({ color }: { color: string }) {
  return (
    <div
      aria-hidden
      className="h-3 rounded-[3px]"
      style={{
        // блик и кромка берутся из темы: в тёмной доска не должна светиться
        // белым, а тень — тонуть в чёрном
        background: `linear-gradient(180deg, color-mix(in oklab, ${color} 88%, var(--card)) 0%, ${color} 55%, color-mix(in oklab, ${color} 82%, var(--foreground)) 100%)`,
        boxShadow: `0 6px 14px -8px color-mix(in oklab, ${color} 60%, var(--foreground))`,
      }}
    />
  )
}
