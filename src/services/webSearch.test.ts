import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-web-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-web-search'

const { parseSearchXml, mentionsIsbn, bareIsbn, parseOpenGraph } =
  await import('./webSearch')

/** Выдача Yandex Search API приходит XML внутри base64. */
const XML = `<?xml version="1.0" encoding="utf-8"?>
<yandexsearch><response><results><grouping>
  <group><doc>
    <url>https://www.labirint.ru/books/700123/</url>
    <title>Кавказская <hlword>война</hlword>: семь историй</title>
    <passages>
      <passage>Урушадзе А. Т. — М.: Новое литературное обозрение, 2018. — 288 с.</passage>
      <passage>ISBN <hlword>978-5-444-80717-0</hlword></passage>
    </passages>
  </doc></group>
  <group><doc>
    <url>https://www.chitai-gorod.ru/product/kavkazskaya-voyna-123</url>
    <title>Кавказская война</title>
    <headline>Издательство &quot;НЛО&quot;, 2018 год</headline>
  </doc></group>
</grouping></results></response></yandexsearch>`

describe('разбор выдачи', () => {
  test('вытаскивает ссылку, заголовок и сниппеты без разметки', () => {
    const hits = parseSearchXml(XML)
    expect(hits.length).toBe(2)
    expect(hits[0]?.url).toBe('https://www.labirint.ru/books/700123/')
    expect(hits[0]?.title).toBe('Кавказская война: семь историй')
    expect(hits[0]?.text).toContain('Новое литературное обозрение')
    expect(hits[0]?.text).not.toContain('hlword')
    // headline тоже идёт в текст, сущности раскодированы
    expect(hits[1]?.text).toContain('"НЛО"')
  })

  test('пустая выдача не роняет разбор', () => {
    expect(parseSearchXml('<yandexsearch></yandexsearch>')).toEqual([])
    expect(parseSearchXml('мусор')).toEqual([])
  })
})

describe('правило приёмки', () => {
  test('номер узнаётся в любой типографике', () => {
    const isbn = '9785444807170'
    expect(mentionsIsbn('ISBN 978-5-444-80717-0', isbn)).toBe(true)
    expect(mentionsIsbn('isbn 978 5 444 80717 0', isbn)).toBe(true)
    // длинное тире и неразрывный дефис встречаются на страницах магазинов
    expect(mentionsIsbn('ISBN 978‑5‑444‑80717‑0', isbn)).toBe(true)
  })

  test('чужой номер не проходит', () => {
    expect(mentionsIsbn('ISBN 978-5-389-21556-4', '9785444807170')).toBe(false)
    expect(mentionsIsbn('нет здесь номеров', '9785444807170')).toBe(false)
  })

  test('bareIsbn оставляет только цифры', () => {
    expect(bareIsbn('978-5-444-80717-0')).toBe('9785444807170')
  })
})

describe('выдача без сниппетов', () => {
  test('текст берётся из заголовка, номер в нём находится', () => {
    const xml = `<yandexsearch><response><results><grouping><group><doc>
      <url>https://m.onlinetrade.ru/catalogue/knigi-c14/vzglyad_nazad-1.html</url>
      <title>Книга Взгляд назад (Радке Хизер) 9785001396666 — купить</title>
    </doc></group></grouping></results></response></yandexsearch>`
    const hits = parseSearchXml(xml)
    expect(hits.length).toBe(1)
    expect(mentionsIsbn(hits[0]?.title ?? '', '9785001396666')).toBe(true)
  })

  test('номер в сниппете маркета с точкой после ISBN', () => {
    expect(
      mentionsIsbn('ISBN. 9785001396666. Автор. Радке Хизер.', '9785001396666'),
    ).toBe(true)
  })
})

describe('тело запроса', () => {
  test('значения перечислений — те, что принимает API', async () => {
    // 400 «invalid value GROUPING_MODE_FLAT» уже ловили на проде: имена
    // перечислений сверены с protobuf-описанием searchapi v2
    const source = await Bun.file(
      new URL('./webSearch.ts', import.meta.url).pathname,
    ).text()
    for (const value of [
      'SEARCH_TYPE_RU',
      'FAMILY_MODE_NONE',
      'FIX_TYPO_MODE_OFF',
      'GROUP_MODE_FLAT',
      'LOCALIZATION_RU',
      'FORMAT_XML',
      'ROLE_USER',
    ]) {
      expect(source).toContain(`'${value}'`)
    }
    expect(source).not.toContain("'GROUPING_MODE_FLAT'")
    // без сниппетов номеру негде встретиться — правило приёмки не сработает
    expect(source).toContain('maxPassages')
  })
})

describe('открытые теги страницы', () => {
  test('обложка и описание вытаскиваются из og-тегов', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.market.ru/cover.jpg" />
      <meta property="og:description" content="Культурная история женских ягодиц" />
    </head></html>`
    const og = parseOpenGraph(html)
    expect(og.image).toBe('https://cdn.market.ru/cover.jpg')
    expect(og.description).toBe('Культурная история женских ягодиц')
  })

  test('падает на обычные meta, если og нет', () => {
    const og = parseOpenGraph(
      `<meta name="description" content="Книга про историю"><meta name="twitter:image" content="/x.jpg">`,
    )
    expect(og.description).toBe('Книга про историю')
    expect(og.image).toBe('/x.jpg')
  })

  test('без тегов — пусто, без исключений', () => {
    expect(parseOpenGraph('<html></html>')).toEqual({
      image: null,
      description: null,
    })
  })
})
