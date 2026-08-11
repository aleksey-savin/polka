import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-test-'))

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { signupInvite } = await import('@/db/schema/circulation')
const { createLibrary } = await import('./libraries')
const { createShelf } = await import('./shelves')
const { createBook } = await import('./books')
const { lendBook, listLoans, returnLoan } = await import('./loans')
const { createShare, getShareView, listMyShares, revokeShare } =
  await import('./shares')
const {
  approveRequest,
  createBorrowRequest,
  declineRequest,
  listPendingRequests,
} = await import('./requests')
const { listSavedShares, saveShare, searchFriendsBooks } =
  await import('./savedShares')
const {
  consumeSignupInvite,
  createSignupInvite,
  hasAnyUser,
  isSignupInviteValid,
} = await import('./signupInvites')
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

const owner = await makeUser('s-owner', 'Хозяин')
const friend = await makeUser('s-friend', 'Друг')

const { id: libraryId } = await createLibrary(owner, { name: 'Дом' })
const { id: shelfId } = await createShelf(owner, { libraryId, name: 'Полка' })
const { id: bookId } = await createBook(owner, {
  title: 'Открытая книга',
  authors: 'Автор Публичный',
  year: 2001,
  libraryId,
  shelfId,
})
const { token } = await createShare(owner, { scope: 'library', libraryId })

describe('витрина', () => {
  test('публичный allowlist: книги видны, приватного нет', async () => {
    const view = await getShareView(token)
    expect(view.title).toBe('Дом')
    expect(view.ownerNames).toBe('Хозяин')
    expect(view.bookCount).toBe(1)
    const book = view.sections[0]?.books[0]
    expect(book?.title).toBe('Открытая книга')
    expect(book?.onLoan).toBe(false)
    // в сериализации нет ничего лишнего
    const json = JSON.stringify(view)
    expect(json).not.toContain('notes')
    expect(json).not.toContain('borrowerName')
    expect(json).not.toContain('coverPath')
  })

  test('на руках — только флаг занятости, без имени', async () => {
    await lendBook(owner, bookId, { borrowerName: 'Секретный Друг' })
    const view = await getShareView(token)
    expect(view.sections[0]?.books[0]?.onLoan).toBe(true)
    expect(JSON.stringify(view)).not.toContain('Секретный')
    const [active] = await listLoans(owner, 'active')
    if (active) await returnLoan(owner, active.loanId)
  })
})

describe('заявки', () => {
  test('гость подаёт заявку → владелец одобряет → выдача с именем гостя', async () => {
    await createBorrowRequest({
      token,
      bookId,
      guestName: 'Маша-гость',
      note: 'заберу в четверг',
      ip: '1.1.1.1',
    })
    const pending = await listPendingRequests(owner)
    expect(pending).toHaveLength(1)
    expect(pending[0]?.guestName).toBe('Маша-гость')

    await approveRequest(owner, pending[0]?.id ?? '')
    const [loan] = await listLoans(owner, 'active')
    expect(loan?.borrowerName).toBe('Маша-гость')
    expect(await listPendingRequests(owner)).toHaveLength(0)
    if (loan) await returnLoan(owner, loan.loanId)
  })

  test('повторная заявка того же гостя на ту же книгу отклоняется', async () => {
    await createBorrowRequest({
      token,
      bookId,
      guestName: 'Дима',
      ip: '1.1.1.2',
    })
    expect(
      createBorrowRequest({ token, bookId, guestName: 'Дима', ip: '1.1.1.2' }),
    ).rejects.toThrow('уже ждёт')
    const [pending] = await listPendingRequests(owner)
    if (pending) await declineRequest(owner, pending.id)
  })

  test('rate-limit: 11-я заявка с одного ip блокируется', async () => {
    for (let i = 0; i < 8; i++) {
      // 2 заявки выше уже потратили лимит этого ip? нет — ip другой
      await createBorrowRequest({
        token,
        bookId,
        guestName: `Гость-${i}`,
        ip: '9.9.9.9',
      })
    }
    const pending = await listPendingRequests(owner)
    for (const p of pending) await declineRequest(owner, p.id)
    await createBorrowRequest({
      token,
      bookId,
      guestName: 'Гость-8',
      ip: '9.9.9.9',
    })
    await createBorrowRequest({
      token,
      bookId,
      guestName: 'Гость-9',
      ip: '9.9.9.9',
    })
    expect(
      createBorrowRequest({
        token,
        bookId,
        guestName: 'Гость-10',
        ip: '9.9.9.9',
      }),
    ).rejects.toThrow('Слишком много')
  })
})

describe('полки друзей', () => {
  test('свою библиотеку сохранить нельзя, чужую — можно; поиск работает', async () => {
    expect(saveShare(owner, token)).rejects.toThrow('ваша библиотека')

    await saveShare(friend, token)
    await saveShare(friend, token) // идемпотентно
    const saved = await listSavedShares(friend)
    expect(saved).toHaveLength(1)
    expect(saved[0]?.ownerNames).toBe('Хозяин')

    const found = await searchFriendsBooks(friend, 'открытая')
    expect(found.rows).toHaveLength(1)
    expect(found.rows[0]?.ownerNames).toBe('Хозяин')

    const nothing = await searchFriendsBooks(friend, 'пелевин')
    expect(nothing.rows).toHaveLength(0)
  })

  test('отзыв ссылки: витрина 404, из «Друзей» пропадает', async () => {
    const [mine] = await listMyShares(owner)
    if (!mine) throw new Error('нет ссылки')
    await revokeShare(owner, mine.id)
    expect(getShareView(token)).rejects.toThrow(AppError)
    expect(await listSavedShares(friend)).toHaveLength(0)
  })
})

describe('приглашения в Полку (регистрация)', () => {
  test('система не пуста; токен валиден один раз', async () => {
    expect(await hasAnyUser()).toBe(true)
    const { token: invite } = await createSignupInvite(owner)
    expect(await isSignupInviteValid(invite)).toBe(true)
    await consumeSignupInvite(invite, friend)
    expect(await isSignupInviteValid(invite)).toBe(false)
  })

  test('просроченный токен невалиден', async () => {
    await db.insert(signupInvite).values({
      token: 'expired-token',
      createdBy: owner,
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(await isSignupInviteValid('expired-token')).toBe(false)
  })
})
