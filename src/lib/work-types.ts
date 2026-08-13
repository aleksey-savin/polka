/** Типы произведений FantLab по-русски: подпись в библиографии и на страницах. */
export const WORK_TYPE_RU: Record<string, string> = {
  shortstory: 'рассказ',
  story: 'повесть',
  novel: 'роман',
  collection: 'сборник',
  poem: 'поэма',
  piece: 'пьеса',
  microstory: 'микрорассказ',
  documental: 'документальное',
  cycle: 'цикл',
  other: '',
}

export const workTypeRu = (t: string | null) =>
  t ? (WORK_TYPE_RU[t.toLowerCase()] ?? t) : null
