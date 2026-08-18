import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, test } from 'bun:test'

import type { SourceAdapter, SourceKey } from './types'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-findqueue-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-find-queue'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { book, findTask } = await import('@/db/schema/catalog')
const { eq } = await import('drizzle-orm')
const { createLibrary } = await import('@/services/libraries')
const { createShelf } = await import('@/services/shelves')
const { createBook } = await import('@/services/books')
const { enqueueFind, runNextFind } = await import('./queue')

const ME = 'queue-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'queue@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const lib = await createLibrary(ME, { name: 'Дом' })
const shelfRow = await createShelf(ME, { libraryId: lib.id, name: 'Полка' })

const ISBN = '9785171636951'

const stub = (key: SourceKey, title?: string): SourceAdapter => ({
  key,
  paid: key === 'web' || key === 'neuro',
  timeoutMs: 500,
  probe: async () =>
    title
      ? [
          {
            key,
            variantKey: key,
            draft: { title },
            proof: null,
            refBookId: null,
            workId: null,
            covers: [],
            weak: false,
          },
        ]
      : [],
})

const ADAPTERS: Partial<Record<SourceKey, SourceAdapter>> = {
  reference: stub('reference'),
  fantlab: stub('fantlab'),
  google: stub('google'),
  openlibrary: stub('openlibrary'),
  web: stub('web', 'Зона'),
  neuro: stub('neuro'),
}

const makeBook = async () => {
  const created = await createBook(ME, {
    title: ISBN,
    authors: '',
    isbn13: ISBN,
    libraryId: lib.id,
    shelfId: shelfRow.id,
  })
  await db
    .update(book)
    .set({ unrecognized: true })
    .where(eq(book.id, created.id))
  return created
}

beforeEach(async () => {
  await db.delete(findTask)
})

describe('очередь доигровки', () => {
  test('задача ставится один раз на книгу', async () => {
    const created = await makeBook()
    await enqueueFind(created.id, ME, ISBN)
    await enqueueFind(created.id, ME, ISBN)
    const rows = await db
      .select()
      .from(findTask)
      .where(eq(findTask.bookId, created.id))
    expect(rows).toHaveLength(1)
  })

  test('выполненная задача дописывает карточку', async () => {
    const created = await makeBook()
    await enqueueFind(created.id, ME, ISBN)
    await runNextFind({ adapters: ADAPTERS, force: true })
    const [row] = await db.select().from(book).where(eq(book.id, created.id))
    expect(row?.title).toBe('Зона')
    expect(row?.unrecognized).toBe(false)
  })

  test('выполненная задача закрывается', async () => {
    const created = await makeBook()
    await enqueueFind(created.id, ME, ISBN)
    await runNextFind({ adapters: ADAPTERS, force: true })
    const [task] = await db
      .select()
      .from(findTask)
      .where(eq(findTask.bookId, created.id))
    expect(task?.status).toBe('done')
  })

  test('пустая очередь не падает', async () => {
    await expect(runNextFind({ adapters: ADAPTERS })).resolves.toBeUndefined()
  })

  test('упавшая задача помечается, а не роняет воркер', async () => {
    const created = await makeBook()
    await enqueueFind(created.id, ME, ISBN)
    const broken: Partial<Record<SourceKey, SourceAdapter>> = {
      ...ADAPTERS,
      reference: {
        key: 'reference',
        paid: false,
        timeoutMs: 500,
        probe: () => {
          throw new Error('всё сломалось')
        },
      },
    }
    await expect(
      runNextFind({ adapters: broken, force: true }),
    ).resolves.toBeUndefined()
  })
})
