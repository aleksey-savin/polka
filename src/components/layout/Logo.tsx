import { Link } from '@tanstack/react-router'

// Логотип: слово «Полка» стоит на доске, рядом прислонены мини-корешки.
export function Logo({ large = false }: { large?: boolean }) {
  const word = large
    ? 'border-b-[5px] pb-0.5 text-5xl'
    : 'border-b-[3px] text-[22px]'
  const spineW = large ? 'w-2' : 'w-[5px]'
  const board = large ? 'border-b-[5px]' : 'border-b-[3px]'
  return (
    <span
      className="inline-flex items-end gap-1.5"
      role="img"
      aria-label="Полка"
    >
      <span
        className={`${word} border-foreground pr-1 font-display font-bold leading-none`}
      >
        Полка
      </span>
      <span className={`${spineW} ${board} border-foreground`}>
        <span
          className={`block rounded-t-[2px] bg-primary ${large ? 'h-6' : 'h-3.5'}`}
        />
      </span>
      <span className={`${spineW} ${board} border-foreground`}>
        <span
          className={`block rounded-t-[2px] bg-stamp ${large ? 'h-5' : 'h-[11px]'}`}
        />
      </span>
      {large && (
        <span className={`${spineW} ${board} border-foreground`}>
          <span className="block h-[22px] rounded-t-[2px] bg-patina-old" />
        </span>
      )}
    </span>
  )
}

export function LogoLink() {
  return (
    <Link to="/libraries" aria-label="Полка — на главную">
      <Logo />
    </Link>
  )
}
