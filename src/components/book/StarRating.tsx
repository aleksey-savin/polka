/**
 * Интерактивная оценка 1–5: клик по текущей звезде снимает оценку.
 * В формуляре звёзды растянуты по ширине, кнопка — 48px в высоту: попасть
 * большим пальцем нужно не глядя.
 */
export function StarRating({
  value,
  onChange,
  readOnly = false,
  size = 'md',
}: {
  value: number | null
  onChange?: (value: number | null) => void
  readOnly?: boolean
  size?: 'sm' | 'md'
}) {
  if (readOnly) {
    return (
      <span
        className={`inline-flex leading-none ${
          size === 'md' ? 'gap-1 text-[30px]' : 'gap-0.5 text-[15px]'
        }`}
        role="img"
        aria-label={value ? `Оценка ${value} из 5` : 'Без оценки'}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <span
            key={star}
            className={star <= (value ?? 0) ? 'text-[#C9A23B]' : 'text-border'}
          >
            ★
          </span>
        ))}
      </span>
    )
  }

  return (
    <div
      className="flex w-full items-center justify-between gap-1"
      aria-label={value ? `Оценка ${value} из 5` : 'Без оценки'}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          aria-label={`Оценка ${star}`}
          className={`min-h-12 flex-1 text-[32px] leading-none transition-transform active:scale-95 ${
            star <= (value ?? 0)
              ? 'text-[#C9A23B]'
              : 'text-border hover:text-[#C9A23B]/60'
          }`}
          onClick={() => onChange?.(star === value ? null : star)}
        >
          ★
        </button>
      ))}
    </div>
  )
}
