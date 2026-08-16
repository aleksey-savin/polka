import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-unrec-'))

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { book } = await import('@/db/schema/catalog')
const { eq } = await import('drizzle-orm')
const { createLibrary } = await import('./libraries')
const { createBook, updateBook, getBookCard, listBooks } =
  await import('./books')
const { countUnrecognized, listUnrecognized } = await import('./unrecognized')
const { createList, getList } = await import('./lists')

const ALEX = 'u-unrec'

await db.insert(user).values({
  id: ALEX,
  name: 'Алексей',
  email: 'unrec@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const library = await createLibrary(ALEX, { name: 'Дом' })

describe('нераспознанные книги', () => {
  test('«Пропустить» сохраняет книгу по одному ISBN', async () => {
    const created = await createBook(ALEX, {
      title: '',
      isbn13: '9785992208757',
      libraryId: library.id,
      unrecognized: true,
    })

    const card = await getBookCard(ALEX, created.id)
    // названием временно служит номер — строка не выглядит пустой
    expect(card.title).toBe('9785992208757')

    expect(await countUnrecognized(ALEX)).toBe(1)
    expect(await listUnrecognized(ALEX)).toMatchObject([
      { id: created.id, isbn13: '9785992208757', libraryName: 'Дом' },
    ])

    // книга находится поиском по номеру
    const found = await listBooks(ALEX, { query: '9785992208757' })
    expect(found.rows.map((r) => r.id)).toContain(created.id)
    expect(found.rows[0]?.unrecognized).toBe(true)
  })

  test('название снимает пометку', async () => {
    const created = await createBook(ALEX, {
      title: '',
      isbn13: '9785171478254',
      libraryId: library.id,
      unrecognized: true,
    })
    expect(await countUnrecognized(ALEX)).toBe(2)

    await updateBook(ALEX, created.id, {
      title: 'Столпы Земли',
      authors: 'Кен Фоллетт',
      isbn13: '9785171478254',
      libraryId: library.id,
    })

    const [row] = await db
      .select({ unrecognized: book.unrecognized, title: book.title })
      .from(book)
      .where(eq(book.id, created.id))
    expect(row).toMatchObject({ unrecognized: false, title: 'Столпы Земли' })
    expect(await countUnrecognized(ALEX)).toBe(1)
  })

  test('без названия и без ISBN сохранить нельзя', async () => {
    expect(
      createBook(ALEX, { title: '', libraryId: library.id }),
    ).rejects.toThrow('Нужно название книги или ISBN')
  })

  test('одного ISBN достаточно — книга помечается как нераспознанная', async () => {
    const created = await createBook(ALEX, {
      title: '',
      isbn13: '9785041739263',
      libraryId: library.id,
    })
    const card = await getBookCard(ALEX, created.id)
    expect(card.title).toBe('9785041739263')
    expect(
      (await listUnrecognized(ALEX)).some((r) => r.id === created.id),
    ).toBe(true)
  })
})

describe('форма: куда положить', () => {
  test('«в список» кладёт книгу в список сразу, без бэкфилла', async () => {
    const { id: listId } = await createList(ALEX, {
      kind: 'wishlist',
      title: 'Хочу почитать',
    })
    const created = await createBook(ALEX, {
      title: 'Вечер и утро',
      authors: 'Кен Фоллетт',
      wishlist: true,
      listId,
    })

    const view = await getList(ALEX, listId)
    expect(view.items).toMatchObject([{ title: 'Вечер и утро', form: 'book' }])
    const card = await getBookCard(ALEX, created.id)
    expect(card.status).toBe('wishlist')
    expect(card.libraryId).toBeNull()
    expect(card.lists.map((l) => l.id)).toContain(listId)
  })
})
