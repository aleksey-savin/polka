import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-refsync-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-reference-sync'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { book, refBook } = await import('@/db/schema/catalog')
const { eq } = await import('drizzle-orm')
const { createLibrary } = await import('@/services/libraries')
const { createShelf } = await import('@/services/shelves')
const { createBook } = await import('@/services/books')
const { refChecksum } = await import('./checksum')
const { refUpdateFor, staleBooks, applyRefUpdate, muteRefUpdate } =
  await import('./sync')
const { revertRecognition } = await import('@/services/aiRecognize')

const ME = 'sync-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'sync@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const lib = await createLibrary(ME, { name: 'Дом' })
const shelfRow = await createShelf(ME, { libraryId: lib.id, name: 'Полка' })

let seq = 0
/** Книга со ссылкой на эталон; `synced` — версия уже применена. */
async function bookWithReference(opts: { synced: boolean }) {
  seq++
  const full = {
    title: `Полная книга ${seq}`,
    authors: 'Автор Полный',
    publisher: 'Дискурс',
    year: 2020,
    pages: 256,
    language: 'ru',
    seriesName: 'Наше будущее',
    annotation: 'Описание книги достаточной длины, чтобы пройти проверку.',
    coverUrl: null,
  }
  const [ref] = await db
    .insert(refBook)
    .values({
      source: 'manual',
      sourceRef: `sync-ref-${seq}`,
      title: full.title,
      titleNorm: full.title.toLowerCase(),
      authors: full.authors,
      publisher: full.publisher,
      year: full.year,
      pages: full.pages,
      language: full.language,
      seriesName: full.seriesName,
      annotation: full.annotation,
      checksum: refChecksum(full),
    })
    .returning({ id: refBook.id, checksum: refBook.checksum })

  const created = await createBook(ME, {
    title: `Неполная книга ${seq}`,
    authors: '',
    libraryId: lib.id,
    shelfId: shelfRow.id,
  })
  await db
    .update(book)
    .set({
      refBookId: ref!.id,
      refChecksum: opts.synced ? ref!.checksum : null,
    })
    .where(eq(book.id, created.id))
  return { bookId: created.id, refId: ref!.id }
}

describe('что можно обновить из эталона', () => {
  test('суммы совпадают — обновлять нечего', async () => {
    const { bookId } = await bookWithReference({ synced: true })
    expect(await refUpdateFor(ME, bookId)).toBeNull()
  })

  test('эталон дополнили — видно, какие поля добавятся', async () => {
    const { bookId } = await bookWithReference({ synced: false })
    const update = await refUpdateFor(ME, bookId)
    expect(update?.fields.map((f) => f.field)).toContain('annotation')
    expect(update?.fields.map((f) => f.field)).toContain('pages')
  })

  test('книга без ссылки на эталон обновлений не имеет', async () => {
    const plain = await createBook(ME, {
      title: 'Сама по себе',
      authors: '',
      libraryId: lib.id,
      shelfId: shelfRow.id,
    })
    expect(await refUpdateFor(ME, plain.id)).toBeNull()
  })

  test('чужая книга недоступна', async () => {
    const { bookId } = await bookWithReference({ synced: false })
    await expect(refUpdateFor('stranger', bookId)).rejects.toThrow(/доступа/i)
  })

  test('сводка перечисляет книги с расхождением', async () => {
    const { bookId } = await bookWithReference({ synced: false })
    const list = await staleBooks(ME)
    expect(list.some((b) => b.bookId === bookId)).toBe(true)
    expect(list.every((b) => b.fields.length > 0)).toBe(true)
  })
})

describe('обновление карточки', () => {
  test('данные издания заменяются, версия запоминается', async () => {
    const { bookId, refId } = await bookWithReference({ synced: false })
    await applyRefUpdate(ME, bookId)

    const [row] = await db.select().from(book).where(eq(book.id, bookId))
    const [ref] = await db.select().from(refBook).where(eq(refBook.id, refId))
    expect(row?.annotation).toBe(ref!.annotation)
    expect(row?.pages).toBe(256)
    expect(row?.refChecksum).toBe(ref!.checksum)
    // второй раз обновлять нечего
    expect(await refUpdateFor(ME, bookId)).toBeNull()
  })

  test('личный слой не трогается', async () => {
    const { bookId } = await bookWithReference({ synced: false })
    const [before] = await db.select().from(book).where(eq(book.id, bookId))
    await applyRefUpdate(ME, bookId)
    const [after] = await db.select().from(book).where(eq(book.id, bookId))
    expect(after?.shelfId).toBe(before!.shelfId)
    expect(after?.libraryId).toBe(before!.libraryId)
    expect(after?.status).toBe(before!.status)
  })

  test('обновление откатывается', async () => {
    const { bookId } = await bookWithReference({ synced: false })
    const [before] = await db.select().from(book).where(eq(book.id, bookId))
    await applyRefUpdate(ME, bookId)
    await revertRecognition(ME, bookId)
    const [after] = await db.select().from(book).where(eq(book.id, bookId))
    expect(after?.title).toBe(before!.title)
    expect(after?.annotation).toBe(before!.annotation)
  })
})

describe('больше не напоминать', () => {
  test('приглушённая книга исчезает из напоминаний', async () => {
    const { bookId } = await bookWithReference({ synced: false })
    expect(await refUpdateFor(ME, bookId)).not.toBeNull()

    await muteRefUpdate(ME, bookId)
    expect(await refUpdateFor(ME, bookId)).toBeNull()
    expect((await staleBooks(ME)).some((b) => b.bookId === bookId)).toBe(false)
  })

  test('обновить руками всё равно можно, и молчание снимается', async () => {
    const { bookId, refId } = await bookWithReference({ synced: false })
    await muteRefUpdate(ME, bookId)

    // «Заменить данные» на карточке проходит мимо приглушения
    await applyRefUpdate(ME, bookId, { force: true })
    const [row] = await db.select().from(book).where(eq(book.id, bookId))
    const [ref] = await db.select().from(refBook).where(eq(refBook.id, refId))
    expect(row?.refChecksum).toBe(ref!.checksum)
    expect(row?.refSyncMuted).toBe(false)
  })
})

describe('сводка в «Чтении»', () => {
  test('книга с дополненным эталоном видна в хабе', async () => {
    const { getReadingHub } = await import('@/services/reading')
    const { bookId } = await bookWithReference({ synced: false })
    const hub = await getReadingHub(ME)
    expect(hub.stale.some((b) => b.bookId === bookId)).toBe(true)
  })

  test('приглушённая книга в хаб не попадает', async () => {
    const { getReadingHub } = await import('@/services/reading')
    const { bookId } = await bookWithReference({ synced: false })
    await muteRefUpdate(ME, bookId)
    const hub = await getReadingHub(ME)
    expect(hub.stale.some((b) => b.bookId === bookId)).toBe(false)
  })
})
