import { describe, expect, test } from 'bun:test'

import { refChecksum } from './checksum'

const base = {
  title: 'Дети-билингвы',
  authors: 'Абделила-Боэр Барбара',
  publisher: 'Дискурс',
  year: 2020,
  pages: 256,
  language: 'ru',
  seriesName: 'Наше будущее',
  annotation: 'О детях в двуязычной среде.',
  coverUrl: 'https://example.org/cover.jpg',
}

describe('контрольная сумма эталона', () => {
  test('одинаковые данные — одинаковая сумма', () => {
    expect(refChecksum(base)).toBe(refChecksum({ ...base }))
  })

  test('правка любого значимого поля меняет сумму', () => {
    for (const field of [
      'title',
      'authors',
      'publisher',
      'annotation',
      'seriesName',
    ] as const) {
      const changed = { ...base, [field]: `${String(base[field])} (ред.)` }
      expect(refChecksum(changed)).not.toBe(refChecksum(base))
    }
    expect(refChecksum({ ...base, year: 2021 })).not.toBe(refChecksum(base))
    expect(refChecksum({ ...base, pages: 300 })).not.toBe(refChecksum(base))
  })

  test('пустое и отсутствующее — одно и то же', () => {
    expect(refChecksum({ ...base, annotation: null })).toBe(
      refChecksum({ ...base, annotation: '' }),
    )
  })

  test('лишние пробелы не считаются правкой', () => {
    expect(refChecksum({ ...base, title: '  Дети-билингвы  ' })).toBe(
      refChecksum(base),
    )
  })

  test('сумма короткая и стабильная между запусками', () => {
    const sum = refChecksum(base)
    expect(sum).toHaveLength(16)
    expect(sum).toMatch(/^[0-9a-f]{16}$/)
  })
})
