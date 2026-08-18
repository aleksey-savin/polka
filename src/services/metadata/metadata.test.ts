import { describe, expect, test } from 'bun:test'

import flEditionExtended from './__fixtures__/fantlab-edition-extended-118084.json'
import flSearch from './__fixtures__/fantlab-9785170829835.json'
import flWork from './__fixtures__/fantlab-work-569.json'
import gbFixture from './__fixtures__/googlebooks-9785170829835.json'
import olBook from './__fixtures__/openlibrary-9785237014150.json'
import {
  parseFantlabEdition,
  parseFantlabSearch,
  parseFantlabWork,
  stripBb,
} from './fantlab'
import { parseGoogleBooks } from './googleBooks'
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

  test('деталка издания: страницы, обложка, id произведения; примечания НЕ аннотация', () => {
    const { extra, workId } = parseFantlabEdition(flEditionExtended)
    expect(extra.pages).toBe(192)
    expect(extra.coverUrl).toStartWith(
      'https://fantlab.ru/images/editions/big/118084',
    )
    expect(extra.annotation).toBeUndefined() // «Внецикловый роман» — примечание издания
    expect(workId).toBe(569) // из ссылки /work569 в content
  })

  test('произведение: настоящая аннотация', () => {
    const work = parseFantlabWork(flWork)
    expect(work.annotation).toContain('Зоны')
    expect(work.annotation).not.toContain('Внецикловый')
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
