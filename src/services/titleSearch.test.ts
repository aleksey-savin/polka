import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-tsearch-'))

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { createLibrary } = await import('./libraries')
const { createShelf } = await import('./shelves')
const { createBook } = await import('./books')
const { ensureRefWork, linkWorkAuthor } = await import('./reference')
const { ensureAuthor } = await import('./authors')
const { adoptExternalWork, searchByTitle } = await import('./titleSearch')

const ALEX = 'u-tsearch'

await db.insert(user).values({
  id: ALEX,
  name: 'Алексей',
  email: 'tsearch@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const library = await createLibrary(ALEX, { name: 'Дом' })
const shelf = await createShelf(ALEX, {
  libraryId: library.id,
  name: 'Классика',
})

// своя книга без ISBN — как издание «Лексики» 1996 года
await createBook(ALEX, {
  title: 'Братья Карамазовы',
  authors: 'Фёдор Достоевский',
  publisher: 'Лексика',
  year: 1996,
  libraryId: library.id,
  shelfId: shelf.id,
})

// произведение в эталоне с автором
const workId = await ensureRefWork('fantlab', 'w-idiot', 'Идиот', 1869, 'novel')
await linkWorkAuthor(workId, await ensureAuthor('Фёдор Достоевский'))

describe('поиск по названию', () => {
  test('ищет по словам: название плюс автор', async () => {
    const res = await searchByTitle(ALEX, 'карамазовы достоевский')
    expect(res.mine.map((m) => m.title)).toEqual(['Братья Карамазовы'])
    expect(res.mine[0]?.place).toBe('Классика')

    // «идиот достоевский» — слово из названия и слово из имени автора,
    // целиком такой строки нет нигде
    const byAuthor = await searchByTitle(ALEX, 'идиот достоевский')
    expect(byAuthor.reference.map((r) => r.title)).toEqual(['Идиот'])
    expect(byAuthor.reference[0]?.authors).toBe('Фёдор Достоевский')
  })

  test('лишнее слово отсекает совпадение', async () => {
    const res = await searchByTitle(ALEX, 'идиот толстой')
    expect(res.reference).toHaveLength(0)
  })

  test('короткий запрос не ходит никуда', async () => {
    const res = await searchByTitle(ALEX, 'ид')
    expect(res).toMatchObject({ mine: [], reference: [], external: [] })
  })

  test('выбор внешнего результата заводит произведение и автора', async () => {
    const id = await adoptExternalWork(
      'w-external',
      'Бесы',
      'Фёдор Достоевский',
      1872,
      'novel',
    )
    const res = await searchByTitle(ALEX, 'бесы достоевский')
    expect(res.reference.map((r) => r.workId)).toContain(id)
    // повторный выбор не плодит дублей
    expect(
      await adoptExternalWork('w-external', 'Бесы', 'Фёдор Достоевский', 1872, 'novel'),
    ).toBe(id)
  })
})
