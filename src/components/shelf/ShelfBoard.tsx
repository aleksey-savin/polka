/** Доска полки: цвет — ручной акцент или авто-патина. */
export function ShelfBoard({ color }: { color: string }) {
  return (
    <div
      aria-hidden
      className="h-3 rounded-[3px]"
      style={{
        background: `linear-gradient(180deg, color-mix(in oklab, ${color} 88%, #fff) 0%, ${color} 55%, color-mix(in oklab, ${color} 82%, #232B38) 100%)`,
        boxShadow: `0 6px 14px -8px color-mix(in oklab, ${color} 60%, #232B38)`,
      }}
    />
  )
}
