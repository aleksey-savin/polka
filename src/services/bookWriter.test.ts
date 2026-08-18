import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-writer-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-writer'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { book } = await import('@/db/schema/catalog')
const { eq } = await import('drizzle-orm')
const { createLibrary } = await import('./libraries')
const { createShelf } = await import('./shelves')
const { createBook } = await import('./books')
const { applyDraftToBook } = await import('./bookWriter')

const ME = 'writer-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'writer@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const lib = await createLibrary(ME, { name: 'Дом' })
const shelfRow = await createShelf(ME, { libraryId: lib.id, name: 'Полка' })

// `BookInput` поля `status` не имеет: статус выводится из размещения
const makeBook = async (title: string) =>
  createBook(ME, {
    title,
    authors: '',
    libraryId: lib.id,
    shelfId: shelfRow.id,
  })

const read = async (id: string) => {
  const [row] = await db.select().from(book).where(eq(book.id, id))
  return row!
}

describe('запись найденного в карточку', () => {
  test('пишет все поля черновика разом', async () => {
    const created = await makeBook('Болванка 1')
    await applyDraftToBook(created.id, {
      title: 'Зона',
      authors: 'Довлатов',
      publisher: 'Азбука',
      year: 2020,
      pages: 224,
      language: 'ru',
      coverType: 'hard',
      heightMm: 215,
    })
    const row = await read(created.id)
    expect(row.title).toBe('Зона')
    expect(row.pages).toBe(224)
    expect(row.coverType).toBe('hard')
    expect(row.heightMm).toBe(215)
  })

  test('нормализованные поля пишутся вместе с исходными', async () => {
    const created = await makeBook('Болванка 2')
    await applyDraftToBook(created.id, { title: 'Зона', authors: 'Довлатов' })
    const row = await read(created.id)
    expect(row.titleNorm).toBe('зона')
    expect(row.authorsNorm).toBe('довлатов')
  })

  test('появилось название — пометка «не распознано» снимается', async () => {
    const created = await makeBook('Болванка 3')
    await db
      .update(book)
      .set({ unrecognized: true })
      .where(eq(book.id, created.id))
    await applyDraftToBook(created.id, { title: 'Зона' })
    expect((await read(created.id)).unrecognized).toBe(false)
  })

  test('режим «только пустое» не затирает заполненное', async () => {
    const created = await makeBook('Болванка 4')
    await applyDraftToBook(created.id, { title: 'Зона', publisher: 'Азбука' })
    await applyDraftToBook(
      created.id,
      { title: 'Другое', publisher: 'АСТ', year: 1999 },
      { mode: 'fill' },
    )
    const row = await read(created.id)
    expect(row.title).toBe('Зона')
    expect(row.publisher).toBe('Азбука')
    expect(row.year).toBe(1999)
  })

  test('название-болванка считается пустым: номер уступает названию', async () => {
    const isbn = '9785171636951'
    const created = await createBook(ME, {
      title: isbn,
      authors: '',
      isbn13: isbn,
      libraryId: lib.id,
      shelfId: shelfRow.id,
    })
    await db
      .update(book)
      .set({ unrecognized: true })
      .where(eq(book.id, created.id))
    // режим «только пустое» обязан заменить номер: иначе фоновая доигровка
    // никогда не дописала бы книгу, отсканированную пачкой
    await applyDraftToBook(created.id, { title: 'Зона' }, { mode: 'fill' })
    expect((await read(created.id)).title).toBe('Зона')
  })

  test('пустой черновик карточку не трогает', async () => {
    const created = await makeBook('Болванка 5')
    await applyDraftToBook(created.id, {})
    expect((await read(created.id)).title).toBe('Болванка 5')
  })
})
