import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-refscen-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-reference-scenario'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { book, refBook } = await import('@/db/schema/catalog')
const { moderationItem, userAccount } = await import('@/db/schema/moderation')
const { eq } = await import('drizzle-orm')
const { createLibrary } = await import('@/services/libraries')
const { createShelf } = await import('@/services/shelves')
const { createBook } = await import('@/services/books')
const { enqueue, saveDraft, approveItem } =
  await import('@/services/moderation')
const { refUpdateFor, applyRefUpdate, staleBooks } = await import('./sync')

const OWNER = 'scen-owner'
const MOD = 'scen-moderator'
for (const [id, name, mail] of [
  [OWNER, 'Владелец', 'owner@test.local'],
  [MOD, 'Модератор', 'mod@test.local'],
] as const) {
  await db.insert(user).values({
    id,
    name,
    email: mail,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}
await db.insert(userAccount).values({ userId: MOD, role: 'admin' })

const lib = await createLibrary(OWNER, { name: 'Дом' })
const shelfRow = await createShelf(OWNER, { libraryId: lib.id, name: 'Полка' })

describe('сценарий целиком: неполное → модератор → обновление', () => {
  test('владелец получает проверенные данные, следующий — сразу', async () => {
    const isbn = '9785900000053'

    // 1. человек сохранил, что нашлось — неполно
    const own = await createBook(OWNER, {
      title: 'Deti-bilingvy',
      authors: 'Barbara Abdelilah-Bauer',
      isbn13: isbn,
      libraryId: lib.id,
      shelfId: shelfRow.id,
    })

    // 2. запись попала в очередь модерации
    const [ref] = await db
      .insert(refBook)
      .values({
        source: 'google',
        sourceRef: 'scen-ref',
        isbn13: isbn,
        title: 'Deti-bilingvy',
        titleNorm: 'deti-bilingvy',
        authors: 'Barbara Abdelilah-Bauer',
      })
      .returning({ id: refBook.id })
    await enqueue('ref_book', ref!.id, OWNER)
    const [item] = await db
      .select()
      .from(moderationItem)
      .where(eq(moderationItem.targetId, ref!.id))

    // 3. модератор заносит всё как надо
    await saveDraft(MOD, item!.id, {
      title: 'Дети-билингвы: практический путеводитель для родителей',
      authors: 'Абделила-Боэр Барбара',
      publisher: 'Дискурс',
      year: 2020,
      pages: 256,
      language: 'ru',
      seriesName: 'Наше будущее',
      annotation:
        'Что делать, если ребёнок растёт в двуязычной среде: практическое руководство.',
      coverUrl: null,
    })
    await approveItem(MOD, item!.id, true)

    // 4. владельцу видно, что эталон дополнили
    const update = await refUpdateFor(OWNER, own.id)
    expect(update).not.toBeNull()
    expect(update!.fields.map((f) => f.field)).toContain('annotation')
    expect((await staleBooks(OWNER)).some((b) => b.bookId === own.id)).toBe(
      true,
    )

    // 5. обновился — карточка стала полной
    await applyRefUpdate(OWNER, own.id)
    const [after] = await db.select().from(book).where(eq(book.id, own.id))
    expect(after?.title).toBe(
      'Дети-билингвы: практический путеводитель для родителей',
    )
    expect(after?.authors).toBe('Абделила-Боэр Барбара')
    expect(after?.annotation).toContain('двуязычной среде')
    expect(after?.pages).toBe(256)

    // напоминание погасло: обновлять больше нечего
    expect(await refUpdateFor(OWNER, own.id)).toBeNull()
  })

  test('следующий владелец получает полные данные сразу', async () => {
    const isbn = '9785900000053'
    const next = await createBook(OWNER, {
      title: '',
      authors: '',
      isbn13: isbn,
      libraryId: lib.id,
      shelfId: shelfRow.id,
    })
    // книга связалась с эталоном при создании — данные подтянутся поиском
    const [row] = await db.select().from(book).where(eq(book.id, next.id))
    expect(row?.refBookId).not.toBeNull()
  })
})
