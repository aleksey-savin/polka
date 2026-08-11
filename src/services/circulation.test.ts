import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-test-'))

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { acceptInvite, createInvite, createLibrary, getLibraryOverview } =
  await import('./libraries')
const { createShelf } = await import('./shelves')
const { createBook, giftBook, listBooks, markLost, restoreToLibrary } =
  await import('./books')
const { activeLoansFor, lendBook, listLoans, returnLoan } =
  await import('./loans')
const { listBookPersonal, upsertPersonal } = await import('./personal')
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

const owner = await makeUser('c-owner', 'Владелец')
const spouse = await makeUser('c-spouse', 'Совладелец')

const { id: libraryId } = await createLibrary(owner, { name: 'Дом' })
const { id: shelfId } = await createShelf(owner, { libraryId, name: 'Полка' })
const { token } = await createInvite(owner, libraryId)
await acceptInvite(spouse, token)
const { id: bookId } = await createBook(owner, {
  title: 'Общая книга',
  authors: 'Автор Тестовый',
  year: 2000,
  libraryId,
  shelfId,
})

describe('выдачи', () => {
  test('дал почитать → на руках; вторая выдача блокируется', async () => {
    await lendBook(owner, bookId, {
      borrowerName: 'Маша',
      dueAt: new Date('2030-01-01'),
    })
    const active = await activeLoansFor([bookId])
    expect(active.get(bookId)?.borrowerName).toBe('Маша')
    expect(active.get(bookId)?.overdue).toBe(false)

    expect(lendBook(spouse, bookId, { borrowerName: 'Дима' })).rejects.toThrow(
      'уже на руках',
    )
  })

  test('подарить, пока на руках, нельзя', () => {
    expect(giftBook(owner, bookId, 'Мама')).rejects.toThrow('на руках')
  })

  test('возврат → история; можно выдать снова', async () => {
    const [активная] = await listLoans(owner, 'active')
    if (!активная) throw new Error('нет активной выдачи')
    await returnLoan(spouse, активная.loanId) // совладелец тоже может принять возврат
    expect((await activeLoansFor([bookId])).size).toBe(0)

    const history = await listLoans(owner, 'history')
    expect(history.map((l) => l.borrowerName)).toContain('Маша')

    await lendBook(owner, bookId, { borrowerName: 'Дима' })
    const again = await activeLoansFor([bookId])
    expect(again.get(bookId)?.borrowerName).toBe('Дима')
    const [current] = await listLoans(owner, 'active')
    if (!current) throw new Error('нет активной выдачи')
    await returnLoan(owner, current.loanId)
  })

  test('просрочка вычисляется', async () => {
    await lendBook(owner, bookId, {
      borrowerName: 'Копуша',
      dueAt: new Date('2020-01-01'),
    })
    const [row] = await listLoans(owner, 'active')
    expect(row?.overdue).toBe(true)
    if (row) await returnLoan(owner, row.loanId)
  })
})

describe('владение', () => {
  test('подарена → уходит с полки, ищется фильтром, возвращается', async () => {
    await giftBook(owner, bookId, 'Мама')

    const overview = await getLibraryOverview(owner, libraryId)
    const shelfRow = overview.shelves.find((s) => s.id === shelfId)
    expect(shelfRow?.bookCount).toBe(0)

    const gifted = await listBooks(owner, { status: 'gifted' })
    expect(gifted.rows.map((r) => r.id)).toContain(bookId)

    await restoreToLibrary(owner, bookId)
    const back = await getLibraryOverview(owner, libraryId)
    expect(back.shelves.find((s) => s.id === shelfId)?.bookCount).toBe(1)
  })

  test('потеряна и нашлась', async () => {
    await markLost(spouse, bookId)
    expect((await listBooks(owner, { status: 'lost' })).rows).toHaveLength(1)
    await restoreToLibrary(owner, bookId)
  })
})

describe('личный слой', () => {
  test('у каждого участника свои оценка/рецензия/заметки; чужие заметки скрыты', async () => {
    await upsertPersonal(owner, bookId, {
      readingStatus: 'read',
      readAt: new Date('2024-03-01'),
      rating: 5,
      review: 'Отлично!',
      notes: 'секрет владельца',
    })
    await upsertPersonal(spouse, bookId, {
      readingStatus: 'reading',
      rating: 4,
    })

    const forOwner = await listBookPersonal(owner, bookId)
    expect(forOwner).toHaveLength(2)
    expect(forOwner[0]?.isMe).toBe(true) // свой слой первым
    expect(forOwner[0]?.rating).toBe(5)
    expect(forOwner[0]?.notes).toBe('секрет владельца')
    const spouseRow = forOwner.find((p) => !p.isMe)
    expect(spouseRow?.rating).toBe(4)
    expect(spouseRow?.notes).toBeNull() // чужие заметки не видны

    const forSpouse = await listBookPersonal(spouse, bookId)
    expect(forSpouse[0]?.isMe).toBe(true)
    expect(forSpouse[0]?.rating).toBe(4)
  })

  test('оценка вне 1–5 отклоняется', () => {
    expect(upsertPersonal(owner, bookId, { rating: 6 })).rejects.toThrow(
      AppError,
    )
  })

  test('частичное обновление не затирает остальное', async () => {
    await upsertPersonal(owner, bookId, { rating: 3 })
    const [mine] = await listBookPersonal(owner, bookId)
    expect(mine?.rating).toBe(3)
    expect(mine?.review).toBe('Отлично!') // рецензия не тронута
    expect(mine?.readingStatus).toBe('read')
  })
})
