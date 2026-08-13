import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

// Временная БД на прогон — задаётся ДО импорта db (см. dynamic import ниже).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-test-'))

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const {
  acceptInvite,
  createInvite,
  createLibrary,
  getLibraryOverview,
  listMyLibraries,
} = await import('./libraries')
const { createShelf, deleteShelf, getShelfView, updateShelf } =
  await import('./shelves')
const {
  createBook,
  getBookCard,
  listBooks,
  moveBooks,
  requireBookAccess,
  updateBook,
} = await import('./books')
const { getSeriesView, listSeries, seriesNumberSortKey, suggestSeries } =
  await import('./series')
const { listMyTags } = await import('./tags')
const { AppError } = await import('./errors')

async function makeUser(id: string, name: string) {
  await db.insert(user).values({
    id,
    name,
    email: `${id}@test.local`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

const alex = await makeUser('u-alex', 'Алексей')
const olya = await makeUser('u-olya', 'Оля')
const stranger = await makeUser('u-stranger', 'Посторонний')

describe('каталог: сквозной сценарий', () => {
  let libraryId = ''
  let shelfId = ''
  let bookId = ''

  test('библиотека, полка, инвайт, совладение', async () => {
    libraryId = (await createLibrary(alex, { name: 'Дом' })).id
    shelfId = (await createShelf(alex, { libraryId, name: 'Фантастика' })).id

    const { token } = await createInvite(alex, libraryId)
    const accepted = await acceptInvite(olya, token)
    expect(accepted.libraryId).toBe(libraryId)
    // идемпотентность
    await acceptInvite(olya, token)

    const olyaLibs = await listMyLibraries(olya)
    expect(olyaLibs.map((l) => l.id)).toContain(libraryId)
  })

  test('совладелец добавляет книгу с серией и тэгами', async () => {
    bookId = (
      await createBook(olya, {
        title: 'Трудно быть богом',
        authors: 'Аркадий и Борис Стругацкие',
        year: 1989,
        pages: 320,
        libraryId,
        shelfId,
        seriesName: 'Миры братьев Стругацких',
        seriesNumber: '2',
        tags: ['фантастика', 'классика'],
      })
    ).id

    await createBook(alex, {
      title: 'Пикник на обочине',
      authors: 'Аркадий Стругацкий; Борис Стругацкий',
      year: 1997,
      pages: 384,
      libraryId,
      shelfId,
      seriesName: 'миры братьев стругацких', // то же имя в другом регистре → та же серия
      seriesNumber: '10',
    })

    const card = await getBookCard(alex, bookId)
    expect(card.seriesName).toBe('Миры братьев Стругацких')
    expect(card.tags).toEqual(['классика', 'фантастика'])
    expect(card.libraryName).toBe('Дом')
  })

  test('серия одна на двоих, тома по числовому порядку', async () => {
    const all = await listSeries(alex)
    expect(all).toHaveLength(1)
    const first = all[0]
    if (!first) throw new Error('серия не найдена')
    expect(first.bookCount).toBe(2)

    const view = await getSeriesView(alex, first.id)
    expect(view.books.map((b) => b.seriesNumber)).toEqual(['2', '10'])

    expect(seriesNumberSortKey('3.5')).toBe(3.5)
    expect(seriesNumberSortKey('3–4')).toBe(3)
    expect(seriesNumberSortKey(null)).toBe(Number.POSITIVE_INFINITY)

    const hints = await suggestSeries(olya, 'миры')
    expect(hints).toHaveLength(1)
  })

  test('поиск по-русски и фильтры', async () => {
    // регистр кириллицы сворачивается (норм-колонки), морфологии нет — LIKE по подстроке
    const plural = await listBooks(alex, { query: 'СТРУГАЦКИЕ' })
    expect(plural.rows).toHaveLength(1)

    const stem = await listBooks(alex, { query: 'стругацки' })
    expect(stem.rows).toHaveLength(2)

    // издательская серия из текстового поиска исключена (M16) —
    // для неё есть отдельный фильтр
    const bySeries = await listBooks(alex, { query: 'миры братьев' })
    expect(bySeries.rows).toHaveLength(0)

    const nothing = await listBooks(alex, { query: 'пелевин' })
    expect(nothing.rows).toHaveLength(0)
  })

  test('обзор библиотеки: патина и корешки', async () => {
    const overview = await getLibraryOverview(alex, libraryId)
    expect(overview.members.map((m) => m.name).sort()).toEqual([
      'Алексей',
      'Оля',
    ])
    const shelfRow = overview.shelves.find((s) => s.id === shelfId)
    expect(shelfRow?.bookCount).toBe(2)
    expect(shelfRow?.tint.medianYear).toBe(1993)
    expect(shelfRow?.tint.color).toMatch(/^oklch\(/)
  })

  test('акцент полки перекрывает патину (хранится), удаление полки — книги в «Неразобранное»', async () => {
    await updateShelf(olya, shelfId, { accentColor: '#E9ADBC' })
    expect((await getShelfView(alex, shelfId)).accentColor).toBe('#E9ADBC')

    const second = await createShelf(alex, { libraryId, name: 'Времянка' })
    await moveBooks(alex, [bookId], { libraryId, shelfId: second.id })
    await deleteShelf(alex, second.id)
    const unsorted = await listBooks(alex, { libraryId, shelfId: 'unsorted' })
    expect(unsorted.rows.map((r) => r.id)).toContain(bookId)
  })

  test('виш-лист: личный, «купил» при перемещении на полку', async () => {
    const wish = await createBook(alex, {
      title: 'Град обреченный',
      wishlist: true,
    })
    const wishRows = await listBooks(alex, { status: 'wishlist' })
    expect(wishRows.rows.map((r) => r.id)).toContain(wish.id)
    // у Оли чужой виш не виден
    const olyaWish = await listBooks(olya, { status: 'wishlist' })
    expect(olyaWish.rows).toHaveLength(0)

    await moveBooks(alex, [wish.id], { libraryId, shelfId: null })
    const bought = await getBookCard(alex, wish.id)
    expect(bought.status).toBe('in_library')
  })

  test('посторонний не видит ничего', async () => {
    expect((await listBooks(stranger, {})).rows).toHaveLength(0)
    expect(requireBookAccess(stranger, bookId)).rejects.toThrow(AppError)
    expect(getLibraryOverview(stranger, libraryId)).rejects.toThrow(
      'Нет доступа',
    )
  })

  test('редактирование книги обновляет нормализованные поля', async () => {
    await updateBook(olya, bookId, {
      title: 'Трудно быть богом (переиздание)',
      authors: 'Аркадий и Борис Стругацкие',
      libraryId,
      shelfId: null,
      year: 2015,
    })
    const found = await listBooks(olya, { query: 'переиздание' })
    expect(found.rows).toHaveLength(1)
    const tags = await listMyTags(olya)
    expect(tags.map((t) => t.name).sort()).toEqual(['классика', 'фантастика'])
  })
})
