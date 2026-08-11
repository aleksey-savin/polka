/** «11.08.2026». */
export const dateRu = (value: Date | string | null) =>
  value ? new Date(value).toLocaleDateString('ru-RU') : ''

/** «11 августа», с годом — только если он не текущий. */
export const dateHuman = (value: Date | string) => {
  const d = new Date(value)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('ru-RU', opts)
}

/** «11.08.26» — для строк формуляров. */
export const dateShort = (value: Date | string) =>
  new Date(value).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
