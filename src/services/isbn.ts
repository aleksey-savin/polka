/** ISBN: валидация чек-цифр, конверсия 10↔13, разбор пользовательского ввода и EAN-13 со сканера. */

export interface ParsedIsbn {
  isbn13: string
  isbn10: string | null
}

/** Убирает дефисы/пробелы, приводит X к верхнему регистру. */
export function normalizeIsbnInput(raw: string): string {
  return raw.replace(/[\s-]+/g, '').toUpperCase()
}

export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const ch = value[i] ?? '0'
    const digit = ch === 'X' ? 10 : Number(ch)
    sum += digit * (10 - i)
  }
  return sum % 11 === 0
}

export function isValidIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false
  let sum = 0
  for (let i = 0; i < 13; i++) {
    sum += Number(value[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return sum % 10 === 0
}

function isbn13CheckDigit(first12: string): string {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return String((10 - (sum % 10)) % 10)
}

function isbn10CheckDigit(first9: string): string {
  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += Number(first9[i]) * (10 - i)
  }
  const rem = (11 - (sum % 11)) % 11
  return rem === 10 ? 'X' : String(rem)
}

export function isbn10to13(isbn10: string): string {
  const first12 = `978${isbn10.slice(0, 9)}`
  return first12 + isbn13CheckDigit(first12)
}

/** Обратная конверсия возможна только для префикса 978. */
export function isbn13to10(isbn13: string): string | null {
  if (!isbn13.startsWith('978')) return null
  const first9 = isbn13.slice(3, 12)
  return first9 + isbn10CheckDigit(first9)
}

/**
 * Разбирает ввод пользователя или EAN-13 со сканера.
 * Принимает ISBN-10 и ISBN-13 (префиксы 978/979); прочие штрихкоды — null.
 */
export function parseIsbn(raw: string): ParsedIsbn | null {
  const s = normalizeIsbnInput(raw)
  if (s.length === 13) {
    if (!isValidIsbn13(s) || !/^97[89]/.test(s)) return null
    return { isbn13: s, isbn10: isbn13to10(s) }
  }
  if (s.length === 10) {
    if (!isValidIsbn10(s)) return null
    return { isbn13: isbn10to13(s), isbn10: s }
  }
  return null
}
