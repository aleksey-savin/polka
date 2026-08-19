import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-reflink-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-reference-link'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { book, refBook } = await import('@/db/schema/catalog')
const { eq } = await import('drizzle-orm')
const { createLibrary } = await import('@/services/libraries')
const { createShelf } = await import('@/services/shelves')
const { createBook } = await import('@/services/books')
const { linkBooksToReference } = await import('@/services/reference')

const ME = 'link-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'link@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const lib = await createLibrary(ME, { name: 'Дом' })
const shelfRow = await createShelf(ME, { libraryId: lib.id, name: 'Полка' })

describe('связывание книг с эталоном', () => {
  test('книга, сохранённая до модерации, получает ссылку', async () => {
    // номер уникален для этого файла: bun test держит одну базу на процесс
    const isbn = '9785900000015'
    // человек сохранил неполную карточку — эталона тогда ещё не было
    const created = await createBook(ME, {
      title: 'Зона',
      authors: '',
      isbn13: isbn,
      libraryId: lib.id,
      shelfId: shelfRow.id,
    })
    const [before] = await db.select().from(book).where(eq(book.id, created.id))
    expect(before?.refBookId).toBeNull()

    const [ref] = await db
      .insert(refBook)
      .values({
        source: 'manual',
        sourceRef: 'moderated:1',
        isbn13: isbn,
        title: 'Зона: записки надзирателя',
        titleNorm: 'зона записки надзирателя',
        authors: 'Довлатов',
      })
      .returning({ id: refBook.id })

    const linked = await linkBooksToReference(ref!.id, isbn)
    expect(linked).toBe(1)
    const [after] = await db.select().from(book).where(eq(book.id, created.id))
    expect(after?.refBookId).toBe(ref!.id)
  })

  test('чужой номер не связывается', async () => {
    const [ref] = await db
      .insert(refBook)
      .values({
        source: 'manual',
        sourceRef: 'moderated:2',
        isbn13: '9785000000001',
        title: 'Другая',
        titleNorm: 'другая',
        authors: '',
      })
      .returning({ id: refBook.id })
    expect(await linkBooksToReference(ref!.id, '9785000000001')).toBe(0)
  })

  test('без номера связывать нечего', async () => {
    expect(await linkBooksToReference('whatever', null)).toBe(0)
  })
})
