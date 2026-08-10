import { describe, expect, test } from 'bun:test'

import flEdition from './__fixtures__/fantlab-edition-118084.json'
import flSearch from './__fixtures__/fantlab-9785170829835.json'
import gbFixture from './__fixtures__/googlebooks-9785170829835.json'
import olBook from './__fixtures__/openlibrary-9785237014150.json'
import { parseFantlabEdition, parseFantlabSearch, stripBb } from './fantlab'
import { parseGoogleBooks } from './googleBooks'
import { mergeResults } from './merge'
import { parseOpenLibraryBook } from './openLibrary'
import { stripHtml, yearFrom } from './types'

describe('fantlab', () => {
  test('BB-разметка снимается', () => {
    expect(stripBb('[autor=52]Аркадий и Борис Стругацкие[/autor]')).toBe(
      'Аркадий и Борис Стругацкие',
    )
    expect(stripBb('[pub=33]АСТ[/pub]')).toBe('АСТ')
    expect(stripBb('без разметки')).toBe('без разметки')
  })

  test('поиск: реальная фикстура по ISBN', () => {
    const parsed = parseFantlabSearch(flSearch, '9785170829835')
    expect(parsed?.editionId).toBe(118084)
    expect(parsed?.draft.title).toBe('Пикник на обочине')
    expect(parsed?.draft.authors).toBe('Аркадий и Борис Стругацкие')
    expect(parsed?.draft.publisher).toBe('АСТ')
    expect(parsed?.draft.seriesName).toBe('Пикник на обочине')
    expect(parsed?.draft.year).toBe(2014)
  })

  test('пустой ответ — null', () => {
    expect(parseFantlabSearch({ matches: [], total_found: 0 }, 'x')).toBeNull()
    expect(parseFantlabSearch(null, 'x')).toBeNull()
  })

  test('деталка издания: страницы, обложка, аннотация без HTML', () => {
    const extra = parseFantlabEdition(flEdition)
    expect(extra.pages).toBe(192)
    expect(extra.coverUrl).toStartWith(
      'https://fantlab.ru/images/editions/big/118084',
    )
    expect(extra.annotation).toContain('Внецикловый роман')
    expect(extra.annotation).not.toContain('<a')
  })
})

describe('openlibrary', () => {
  test('реальная фикстура книги', () => {
    const parsed = parseOpenLibraryBook(olBook)
    expect(parsed?.draft.title).toContain('Пикник на обочине')
    expect(parsed?.draft.pages).toBe(624)
    expect(parsed?.draft.coverUrl).toBe(
      'https://covers.openlibrary.org/b/id/15232314-L.jpg',
    )
    expect(parsed?.authorKeys).toEqual(['/authors/OL182660A'])
  })
})

describe('google books', () => {
  test('фикстура по документированной схеме', () => {
    const draft = parseGoogleBooks(gbFixture)
    expect(draft?.title).toBe('Пикник на обочине')
    expect(draft?.authors).toBe('Аркадий Стругацкий; Борис Стругацкий')
    expect(draft?.year).toBe(2014)
    expect(draft?.coverUrl).toStartWith('https://')
  })

  test('пустой ответ (квота/не найдено) — null', () => {
    expect(
      parseGoogleBooks({ kind: 'books#volumes', totalItems: 0 }),
    ).toBeNull()
    expect(parseGoogleBooks(null)).toBeNull()
  })
})

describe('merge', () => {
  test('приоритеты: FantLab бьёт Google по библио, Google бьёт FantLab по аннотации', () => {
    const merged = mergeResults([
      {
        source: 'google',
        draft: {
          title: 'Google-заголовок',
          annotation: 'Аннотация Google',
          coverUrl: 'g',
        },
      },
      {
        source: 'fantlab',
        draft: {
          title: 'FantLab-заголовок',
          publisher: 'АСТ',
          annotation: 'Аннотация FantLab',
          coverUrl: 'f',
        },
      },
      {
        source: 'openlibrary',
        draft: { title: 'OL-заголовок', pages: 624, coverUrl: 'o' },
      },
    ])
    expect(merged.draft.title).toBe('FantLab-заголовок')
    expect(merged.draft.publisher).toBe('АСТ')
    expect(merged.draft.annotation).toBe('Аннотация Google')
    expect(merged.draft.pages).toBe(624) // дырки добираются из следующих источников
    expect(merged.coverCandidates).toEqual(['f', 'g', 'o'])
    expect(merged.sources).toEqual(['fantlab', 'google', 'openlibrary'])
  })

  test('все источники пустые', () => {
    const merged = mergeResults([null, null, null])
    expect(merged.draft).toEqual({})
    expect(merged.sources).toEqual([])
  })
})

describe('утилиты', () => {
  test('yearFrom', () => {
    expect(yearFrom('2014-01-01')).toBe(2014)
    expect(yearFrom('Jan 1, 1997')).toBe(1997)
    expect(yearFrom('без даты')).toBeUndefined()
    expect(yearFrom(undefined)).toBeUndefined()
  })
  test('stripHtml', () => {
    expect(stripHtml('Иллюстрация <a href="/art6">В. Ненова</a>.')).toBe(
      'Иллюстрация В. Ненова.',
    )
  })
})
