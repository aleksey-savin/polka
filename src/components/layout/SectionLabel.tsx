import type { ReactNode } from 'react'

/** Заголовок секции в библиотечном стиле: mono-капитель и линейка. */
export function SectionLabel({
  children,
  trailing,
}: {
  children: ReactNode
  trailing?: ReactNode
}) {
  return (
    <h2 className="mb-2.5 flex items-baseline gap-2.5 font-mono text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
      {children}
      <span aria-hidden className="h-px flex-1 -translate-y-[3px] bg-border" />
      {trailing}
    </h2>
  )
}
