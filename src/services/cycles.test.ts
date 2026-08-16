import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-cycles-'))

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { refBook, refBookWork } = await import('@/db/schema/catalog')
const { createLibrary } = await import('./libraries')
const { createShelf } = await import('./shelves')
const { createBook, giftBook } = await import('./books')
const { upsertPersonal } = await import('./personal')
const { ensureRefWork } = await import('./reference')
const { bookCycle, getCycleView, linkCycleChild } = await import('./cycles')
const { flattenCycle } = await import('./crawl')
const { normalizeForSearch } = await import('./search')

const USER = 'u-cycles'

await db.insert(user).values({
  id: USER,
  name: 'Алексей',
  email: 'cycles@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})

let libraryCount = 0

async function setup() {
  const library = await createLibrary(USER, { name: `Дом ${++libraryCount}` })
  const shelf = await createShelf(USER, {
    libraryId: library.id,
    name: 'Детективы',
  })
  const cycleId = await ensureRefWork(
    'fantlab',
    '543715',
    'Харри Холе',
    null,
    'cycle',
  )
  const works: Array<{ id: string; title: string; year: number }> = []
  for (const [i, [sourceId, title, year]] of (
    [
      ['543716', 'Нетопырь', 1997],
      ['543717', 'Тараканы', 1998],
      ['543718', 'Красношейка', 2000],
      ['543719', 'Не было печали', 2002],
    ] as Array<[string, string, number]>
  ).entries()) {
    const id = await ensureRefWork('fantlab', sourceId, title, year, 'novel')
    await linkCycleChild(cycleId, id, i + 1)
    works.push({ id, title, year })
  }
  return { library, shelf, cycleId, works }
}

describe('циклы', () => {
  test('flattenCycle разворачивает подциклы и выбрасывает безымянные', () => {
    const flat = flattenCycle([
      { work_id: 1, work_name: 'Нетопырь', work_type_name: 'novel' },
      { work_id: 2, work_name: '  ', work_type_name: 'novel' },
      {
        work_id: 3,
        work_name: 'Подцикл',
        work_type_name: 'cycle',
        children: [
          { work_id: 4, work_name: 'Часть первая', work_type_name: 'story' },
          { work_id: 5, work_name: '', work_type_name: 'story' },
        ],
      },
      { work_name: 'Без id', work_type_name: 'novel' },
    ])
    expect(flat.map((n) => n.work_id)).toEqual([1, 4])
  })

  test('оси чтения и наличия независимы', async () => {
    const { library, shelf, cycleId, works } = await setup()

    // #1 — стоит на полке и прочитана
    const onShelf = await createBook(USER, {
      title: works[0]!.title,
      authors: 'Ю Несбё',
      libraryId: library.id,
      shelfId: shelf.id,
      refWorkId: works[0]!.id,
    })
    await upsertPersonal(USER, onShelf.id, { readingStatus: 'read' })

    // #2 — прочитана, но книги нет: осталась только запись в «Хочу»
    const wished = await createBook(USER, {
      title: works[1]!.title,
      authors: 'Ю Несбё',
      wishlist: true,
      refWorkId: works[1]!.id,
    })
    await upsertPersonal(USER, wished.id, { readingStatus: 'read' })

    // #3 — прочитана и подарена: книги нет, «Хочу» тоже нет
    const gifted = await createBook(USER, {
      title: works[2]!.title,
      authors: 'Ю Несбё',
      libraryId: library.id,
      shelfId: shelf.id,
      refWorkId: works[2]!.id,
    })
    await upsertPersonal(USER, gifted.id, { readingStatus: 'read' })
    await giftBook(USER, gifted.id, 'маме')

    const view = await getCycleView(USER, cycleId)
    expect(view).not.toBeNull()
    const members = view!.members
    expect(members.map((m) => m.position)).toEqual([1, 2, 3, 4])

    expect(members[0]).toMatchObject({
      owned: true,
      listed: false,
      reading: 'read',
      place: 'Детективы',
    })
    // прочитана, книги нет, но она уже в «Хочу» — кнопку не показываем
    expect(members[1]).toMatchObject({
      owned: false,
      listed: true,
      reading: 'read',
      place: 'в «Хочу»',
    })
    // прочитана и подарена — наличия нет, значит «В Хочу» доступно
    expect(members[2]).toMatchObject({
      owned: false,
      listed: false,
      reading: 'read',
      place: 'подарена',
    })
    expect(members[3]).toMatchObject({
      owned: false,
      listed: false,
      reading: null,
      bookId: null,
    })

    expect(view!.readCount).toBe(3)
    expect(view!.ownedCount).toBe(1)
    expect(view!.listedCount).toBe(1)
  })

  test('книга находит цикл через издание сборника', async () => {
    const { library, shelf, cycleId, works } = await setup()
    const [edition] = await db
      .insert(refBook)
      .values({
        source: 'fantlab',
        sourceRef: 'ed-1',
        isbn13: '9785389163464',
        title: 'Полицейский трилогия',
        titleNorm: normalizeForSearch('Полицейский трилогия'),
        authors: 'Ю Несбё',
      })
      .returning({ id: refBook.id })
    await db
      .insert(refBookWork)
      .values({ refBookId: edition!.id, workId: works[3]!.id })

    const mine = await createBook(USER, {
      title: 'Сборник без совпадения названий',
      authors: 'Ю Несбё',
      isbn13: '9785389163464',
      libraryId: library.id,
      shelfId: shelf.id,
    })

    const view = await bookCycle(USER, mine.id)
    expect(view?.cycleId).toBe(cycleId)
    expect(view?.currentPosition).toBe(4)
    expect(view?.total).toBe(4)
    expect(view?.members[3]).toMatchObject({ owned: true, current: true })
  })
})
