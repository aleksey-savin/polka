/** Интерактивная оценка 1–5: клик по текущей звезде снимает оценку. */
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
  const cls = size === 'md' ? 'text-[22px]' : 'text-[15px]'
  return (
    <span
      className={`inline-flex gap-0.5 ${cls} leading-none`}
      role={readOnly ? 'img' : undefined}
      aria-label={value ? `Оценка ${value} из 5` : 'Без оценки'}
    >
      {[1, 2, 3, 4, 5].map((star) =>
        readOnly ? (
          <span
            key={star}
            className={star <= (value ?? 0) ? 'text-[#C9A23B]' : 'text-border'}
          >
            ★
          </span>
        ) : (
          <button
            key={star}
            type="button"
            aria-label={`Оценка ${star}`}
            className={`transition-transform hover:scale-110 ${
              star <= (value ?? 0)
                ? 'text-[#C9A23B]'
                : 'text-border hover:text-[#C9A23B]/60'
            }`}
            onClick={() => onChange?.(star === value ? null : star)}
          >
            ★
          </button>
        ),
      )}
    </span>
  )
}
