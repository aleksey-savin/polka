import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

// адаптеры тянут @/db через reference: временная база нужна до импорта
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-adapters-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-adapters-module'

const { ADAPTERS, looksLikeCover, parseGuessDrafts } =
  await import('./adapters')

describe('реестр адаптеров', () => {
  test('в реестре все шесть ступеней', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual([
      'fantlab',
      'google',
      'neuro',
      'openlibrary',
      'reference',
      'web',
    ])
  })

  test('платными помечены только веб-ступени', () => {
    const paid = Object.values(ADAPTERS)
      .filter((a) => a.paid)
      .map((a) => a.key)
      .sort()
    expect(paid).toEqual(['neuro', 'web'])
  })

  test('у каждой ступени есть таймаут', () => {
    for (const adapter of Object.values(ADAPTERS)) {
      expect(adapter.timeoutMs).toBeGreaterThan(0)
    }
  })
})

describe('разбор ответа модели', () => {
  test('массив по книге на страницу', () => {
    const found = parseGuessDrafts(
      '[{"known":true,"title":"Зона","authors":"Довлатов","year":1982,"sourceUrl":"https://a.ru"},' +
        '{"known":true,"title":"Зона","year":2001,"sourceUrl":"https://b.ru"}]',
    )
    expect(found).toHaveLength(2)
    expect(found[0]?.draft.title).toBe('Зона')
    expect(found[0]?.sourceUrl).toBe('https://a.ru')
    expect(found[1]?.draft.year).toBe(2001)
  })

  test('одиночный объект тоже принимаем', () => {
    const found = parseGuessDrafts(
      'Вот что нашлось: {"known":true,"title":"Зона","authors":"Довлатов"} — всё.',
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.draft.authors).toBe('Довлатов')
  })

  test('known:false отсеивается, остальное остаётся', () => {
    const found = parseGuessDrafts(
      '[{"known":false},{"known":true,"title":"Зона","sourceUrl":"https://a.ru"}]',
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.draft.title).toBe('Зона')
  })

  test('мусор вместо JSON — находок нет', () => {
    expect(parseGuessDrafts('не знаю такой книги')).toEqual([])
  })

  test('пустой массив — находок нет', () => {
    expect(parseGuessDrafts('[]')).toEqual([])
  })

  test('несуразный год отбрасывается', () => {
    const found = parseGuessDrafts('[{"known":true,"title":"Зона","year":99}]')
    expect(found[0]?.draft.year).toBeUndefined()
  })

  test('без sourceUrl вариант остаётся, ссылку проверит адаптер', () => {
    const found = parseGuessDrafts('[{"known":true,"title":"Зона"}]')
    expect(found[0]?.sourceUrl).toBeNull()
  })
})

describe('картинка со страницы', () => {
  test('обложка магазина принимается', () => {
    expect(looksLikeCover('https://cv1.litres.ru/pub/c/cover/12345.jpg')).toBe(
      true,
    )
  })

  test('логотип поисковика — не обложка', () => {
    // ровно этот случай: со страницы выдачи приезжал логотип Яндекса и
    // перечёркивал человеку нормальную обложку книги
    expect(looksLikeCover('https://yastatic.net/s3/home/logo.png')).toBe(false)
    expect(looksLikeCover('https://shop.ru/img/logo-header.png')).toBe(false)
    expect(looksLikeCover('https://shop.ru/i/sprite.svg')).toBe(false)
    expect(looksLikeCover('https://shop.ru/img/placeholder.jpg')).toBe(false)
  })

  test('пустое и не-http отсеиваются', () => {
    expect(looksLikeCover(null)).toBe(false)
    expect(looksLikeCover('data:image/png;base64,iVBOR')).toBe(false)
  })
})
