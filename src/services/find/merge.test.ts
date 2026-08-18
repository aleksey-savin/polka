import { describe, expect, test } from 'bun:test'

import { mergeFindings } from './merge'
import type { Finding, SourceKey } from './types'

const make = (
  key: SourceKey,
  draft: Finding['draft'],
  covers: Array<string> = [],
  weak = false,
): Finding => ({
  key,
  variantKey: key,
  draft,
  proof: null,
  refBookId: null,
  workId: null,
  covers,
  weak,
})

describe('слияние находок', () => {
  test('поле берётся у старшей ступени по порядку', () => {
    const { draft } = mergeFindings(
      [
        make('google', { title: 'Zona', publisher: 'Азбука' }),
        make('fantlab', { title: 'Зона' }),
      ],
      ['reference', 'fantlab', 'google', 'openlibrary'],
    )
    // fantlab выше google — название его, издательство добирается у google
    expect(draft.title).toBe('Зона')
    expect(draft.publisher).toBe('Азбука')
  })

  test('перестановка порядка меняет победителя', () => {
    const findings = [
      make('google', { title: 'Zona' }),
      make('fantlab', { title: 'Зона' }),
    ]
    const asIs = mergeFindings(findings, ['fantlab', 'google'])
    const swapped = mergeFindings(findings, ['google', 'fantlab'])
    expect(asIs.draft.title).toBe('Зона')
    expect(swapped.draft.title).toBe('Zona')
  })

  test('ступень вне порядка игнорируется', () => {
    const { draft } = mergeFindings(
      [make('openlibrary', { title: 'Zone' })],
      ['reference', 'fantlab'],
    )
    expect(draft.title).toBeUndefined()
  })

  test('пустая строка не считается значением', () => {
    const { draft } = mergeFindings(
      [make('fantlab', { publisher: '' }), make('google', { publisher: 'АСТ' })],
      ['fantlab', 'google'],
    )
    expect(draft.publisher).toBe('АСТ')
  })

  test('обложки собираются по порядку и без повторов', () => {
    const { covers } = mergeFindings(
      [
        make('google', { title: 'A' }, ['g.jpg', 'shared.jpg']),
        make('fantlab', { title: 'A' }, ['shared.jpg', 'f.jpg']),
      ],
      ['fantlab', 'google'],
    )
    expect(covers).toEqual(['shared.jpg', 'f.jpg', 'g.jpg'])
  })

  test('находок нет — черновик пуст', () => {
    const { draft, covers } = mergeFindings([], ['fantlab'])
    expect(draft).toEqual({})
    expect(covers).toEqual([])
  })

  test('транслит уступает нормальной находке, даже стоя выше', () => {
    const { draft } = mergeFindings(
      [
        make('google', { title: 'Deti-bilingvy' }, [], true),
        make('web', { title: 'Дети-билингвы' }),
      ],
      ['google', 'web'],
    )
    expect(draft.title).toBe('Дети-билингвы')
  })

  test('транслит всё же лучше пустоты', () => {
    const { draft } = mergeFindings(
      [make('google', { title: 'Deti-bilingvy' }, [], true)],
      ['google', 'web'],
    )
    expect(draft.title).toBe('Deti-bilingvy')
  })
})
