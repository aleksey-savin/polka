import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-moder-'))

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { userAccount } = await import('@/db/schema/moderation')
const { share } = await import('@/db/schema/circulation')
const { eq } = await import('drizzle-orm')
const { createLibrary } = await import('./libraries')
const { createShelf } = await import('./shelves')
const { createBook } = await import('./books')
const { createShare } = await import('./shares')
const {
  accountOf,
  enqueue,
  ensureFirstAdmin,
  listLog,
  listQueue,
  queueCounts,
  listUsers,
  report,
  resolve,
  setBlocked,
  setPublishBan,
  setRole,
} = await import('./moderation')

async function makeUser(id: string, name: string, createdAt: Date) {
  await db.insert(user).values({
    id,
    name,
    email: `${id}@test.local`,
    emailVerified: false,
    createdAt,
    updatedAt: createdAt,
  })
}

// порядок регистрации важен: админом становится первый
await makeUser('u-first', 'Алексей', new Date('2026-01-01'))
await makeUser('u-second', 'Оля', new Date('2026-02-01'))
await makeUser('u-third', 'Пётр', new Date('2026-03-01'))

describe('роли', () => {
  test('первый зарегистрированный становится админом', async () => {
    // прогон общий на все файлы: чужой админ из соседнего теста заставил бы
    // ensureFirstAdmin промолчать, и проверка стала бы зависеть от порядка
    await db.delete(userAccount)
    await ensureFirstAdmin()
    expect((await accountOf('u-first')).role).toBe('admin')
    expect((await accountOf('u-second')).role).toBe('user')

    // повторный прогон ничего не переназначает
    await setRole('u-first', 'u-second', 'admin')
    await ensureFirstAdmin()
    expect((await accountOf('u-second')).role).toBe('admin')
  })

  test('обычный пользователь не лезет в очередь', async () => {
    expect(listQueue('u-third', 'pending')).rejects.toThrow(
      'Нужны права модератора',
    )
    expect(listUsers('u-third')).rejects.toThrow('Нужны права админа')
  })

  test('админ не может разжаловать сам себя', async () => {
    expect(setRole('u-first', 'u-first', 'user')).rejects.toThrow(
      'Нельзя снять админку с самого себя',
    )
  })
})

describe('очередь и санкции', () => {
  test('жалоба поднимает объект и снятие гасит ссылку', async () => {
    const library = await createLibrary('u-third', { name: 'Дом' })
    const shelf = await createShelf('u-third', {
      libraryId: library.id,
      name: 'Полка',
    })
    await createBook('u-third', {
      title: 'Книга',
      libraryId: library.id,
      shelfId: shelf.id,
    })
    // публикация не ждёт модерации — ссылка работает сразу
    const { token } = await createShare('u-third', {
      scope: 'shelf',
      shelfId: shelf.id,
    })
    const [row] = await db
      .select({ id: share.id })
      .from(share)
      .where(eq(share.token, token))
    const shareId = row!.id

    const pending = await listQueue('u-first', 'pending')
    expect(pending.rows.map((i) => i.targetId)).toContain(shareId)

    await report('share', shareId, 'Реклама и спам', 'ссылка на казино', null)
    const reported = await listQueue('u-first', 'reported')
    const item = reported.rows.find((i) => i.targetId === shareId)
    expect(item?.reportCount).toBe(1)
    expect(item?.reports[0]?.reason).toBe('Реклама и спам')

    // снятие без причины не проходит
    expect(resolve('u-first', item!.id, 'removed', '   ')).rejects.toThrow(
      'Укажите причину',
    )

    await resolve('u-first', item!.id, 'removed', 'Реклама и спам')
    const [after] = await db
      .select({ revokedAt: share.revokedAt })
      .from(share)
      .where(eq(share.id, shareId))
    expect(after?.revokedAt).not.toBeNull()
  })

  test('запрет публикации не даёт создать ссылку', async () => {
    const library = await createLibrary('u-third', { name: 'Дача' })
    await setPublishBan('u-first', 'u-third', true, 'повторная реклама')

    expect(
      createShare('u-third', { scope: 'library', libraryId: library.id }),
    ).rejects.toThrow('Публикация запрещена: повторная реклама')

    await setPublishBan('u-first', 'u-third', false, null)
    const { token } = await createShare('u-third', {
      scope: 'library',
      libraryId: library.id,
    })
    expect(token).toBeTruthy()
  })

  test('блокировка видна в аккаунте и не применима к себе', async () => {
    await setBlocked('u-first', 'u-third', true, 'нарушения')
    const account = await accountOf('u-third')
    expect(account).toMatchObject({ blocked: true, blockedReason: 'нарушения' })

    expect(setBlocked('u-first', 'u-first', true, 'ой')).rejects.toThrow(
      'Нельзя заблокировать самого себя',
    )
    await setBlocked('u-first', 'u-third', false, null)
  })

  test('разобранное не возвращается в очередь само, но возвращается по жалобе', async () => {
    await enqueue('ref_work', 'work-1', 'u-third')
    const item = (await listQueue('u-first', 'pending')).rows.find(
      (i) => i.targetId === 'work-1',
    )
    expect(item).toBeDefined()

    await resolve('u-first', item!.id, 'ok', null)
    // повторная постановка в очередь решение не отменяет
    await enqueue('ref_work', 'work-1', 'u-third')
    const stillResolved = await listQueue('u-first', 'resolved')
    expect(stillResolved.rows.some((i) => i.id === item!.id)).toBe(true)

    // а вот жалоба возвращает объект модератору
    await report('ref_work', 'work-1', 'Порнография', null, null)
    const reported = await listQueue('u-first', 'reported')
    expect(reported.rows.some((i) => i.id === item!.id)).toBe(true)
  })
})

describe('пагинация очереди', () => {
  test('страницы не пересекаются, счётчики считаются отдельно', async () => {
    // 25 записей — больше страницы (20)
    for (let i = 0; i < 25; i++) {
      await enqueue('ref_work', `page-work-${i}`, 'u-third')
    }
    const first = await listQueue('u-first', 'pending')
    expect(first.rows.length).toBe(20)
    expect(first.cursor).not.toBeNull()

    const second = await listQueue('u-first', 'pending', first.cursor)
    expect(second.rows.length).toBeGreaterThan(0)
    // одна и та же запись не приходит дважды
    const ids = new Set([
      ...first.rows.map((r) => r.id),
      ...second.rows.map((r) => r.id),
    ])
    expect(ids.size).toBe(first.rows.length + second.rows.length)

    const counts = await queueCounts('u-first')
    expect(counts.pending).toBeGreaterThanOrEqual(25)
    // счётчик не равен размеру страницы — именно этого раньше не хватало
    expect(counts.pending).toBeGreaterThan(first.rows.length)
  })

  test('журнал тоже страницами', async () => {
    const page = await listLog('u-first')
    expect(Array.isArray(page.rows)).toBe(true)
    expect(page.rows.length).toBeLessThanOrEqual(20)
  })
})
