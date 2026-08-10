import { describe, expect, test } from 'bun:test'

import {
  isValidIsbn10,
  isValidIsbn13,
  isbn10to13,
  isbn13to10,
  normalizeIsbnInput,
  parseIsbn,
} from './isbn'

describe('isbn', () => {
  test('нормализация ввода', () => {
    expect(normalizeIsbnInput(' 978-5-17-118366-0 ')).toBe('9785171183660')
    expect(normalizeIsbnInput('5-02-013850-x')).toBe('502013850X')
  })

  test('валидация ISBN-13', () => {
    expect(isValidIsbn13('9785171183660')).toBe(true)
    expect(isValidIsbn13('9780306406157')).toBe(true) // классический пример из стандарта
    expect(isValidIsbn13('9785171183661')).toBe(false) // испорчена чек-цифра
    expect(isValidIsbn13('978517118366')).toBe(false) // короткий
  })

  test('валидация ISBN-10, включая X в конце', () => {
    expect(isValidIsbn10('5020138509')).toBe(true)
    expect(isValidIsbn10('517118366X')).toBe(true)
    expect(isValidIsbn10('0306406152')).toBe(true)
    expect(isValidIsbn10('5020138508')).toBe(false)
  })

  test('конверсия 10 → 13 → 10', () => {
    expect(isbn10to13('0306406152')).toBe('9780306406157')
    expect(isbn13to10('9780306406157')).toBe('0306406152')
    expect(isbn10to13('5020138509')).toBe('9785020138506')
    expect(isbn13to10('9785171183660')).toBe('517118366X')
  })

  test('979-префикс не конвертируется в ISBN-10', () => {
    expect(isbn13to10('9791234567896')).toBeNull()
  })

  test('parseIsbn: 13, 10, EAN со сканера, мусор', () => {
    expect(parseIsbn('978-5-17-118366-0')).toEqual({
      isbn13: '9785171183660',
      isbn10: '517118366X',
    })
    expect(parseIsbn('0306406152')).toEqual({
      isbn13: '9780306406157',
      isbn10: '0306406152',
    })
    expect(parseIsbn('9791234567896')).toEqual({
      isbn13: '9791234567896',
      isbn10: null,
    })
    expect(parseIsbn('4600000000000')).toBeNull() // EAN-13, но не книжный префикс
    expect(parseIsbn('привет')).toBeNull()
    expect(parseIsbn('')).toBeNull()
  })
})
