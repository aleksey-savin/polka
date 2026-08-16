import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-lists-'))

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { refBook, refBookWork } = await import('@/db/schema/catalog')
const { normalizeForSearch } = await import('./search')
const { createLibrary } = await import('./libraries')
const { createShelf } = await import('./shelves')
const { createBook } = await import('./books')
const { ensureRefWork } = await import('./reference')
const {
  addToList,
  backfillWishlists,
  createList,
  defaultWishlistId,
  getList,
  listMyLists,
  listsForOne,
  listsForTarget,
  removeFromList,
} = await import('./lists')
const { authorBibliography, getWorkView } = await import('./reference')
const { createListShare, getListShareView, holdGift, listGiftHolds, releaseGift } =
  await import('./listShares')

const ALEX = 'u-lists-alex'
const OLYA = 'u-lists-olya'

async function makeUser(id: string, name: string) {
  await db.insert(user).values({
    id,
    name,
    email: `${id}@test.local`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

await makeUser(ALEX, 'Алексей')
await makeUser(OLYA, 'Оля')

const library = await createLibrary(ALEX, { name: 'Дом' })
const shelf = await createShelf(ALEX, {
  libraryId: library.id,
  name: 'Азия',
})

describe('вишлисты и подборки', () => {
  test('подборка держит и мои книги, и книги из эталона', async () => {
    const { id: listId } = await createList(ALEX, {
      kind: 'collection',
      title: 'Китайская классика',
      description: 'С чего начать',
    })
    const mine = await createBook(ALEX, {
      title: 'Записки о Кошачьем городе',
      authors: 'Лао Шэ',
      libraryId: library.id,
      shelfId: shelf.id,
    })
    const workId = await ensureRefWork('fantlab', 'w-1', 'Троецарствие', 1400)

    await addToList(ALEX, listId, { bookId: mine.id })
    await addToList(ALEX, listId, { refWorkId: workId }, 'Фундамент')

    const view = await getList(ALEX, listId)
    expect(view.items).toHaveLength(2)
    // новое сверху
    expect(view.items[0]!.title).toBe('Троецарствие')
    expect(view.items[0]!.note).toBe('Фундамент')
    expect(view.items[0]!.myBookId).toBeNull()
    expect(view.items[1]).toMatchObject({
      title: 'Записки о Кошачьем городе',
      myBookId: mine.id,
      place: 'Азия',
    })

    // повторное добавление не плодит дублей
    await addToList(ALEX, listId, { bookId: mine.id })
    expect((await getList(ALEX, listId)).items).toHaveLength(2)

    const picks = await listsForTarget(ALEX, { bookId: mine.id })
    expect(picks.find((p) => p.id === listId)).toMatchObject({
      contains: true,
      itemCount: 2,
    })

    await removeFromList(ALEX, listId, { bookId: mine.id })
    expect((await getList(ALEX, listId)).items).toHaveLength(1)
  })

  test('чужой список не открывается', async () => {
    const { id } = await createList(ALEX, { kind: 'wishlist', title: 'Личное' })
    expect(getList(OLYA, id)).rejects.toThrow('Список чужой')
  })

  test('бронь подарка: гостям видно, владельцу — нет', async () => {
    const { id: listId } = await createList(ALEX, {
      kind: 'wishlist',
      title: 'На день рождения',
    })
    const workId = await ensureRefWork('fantlab', 'w-2', 'Королевство', 2020)
    await addToList(ALEX, listId, { refWorkId: workId })
    const { token } = await createListShare(ALEX, listId)

    const guest = await getListShareView(token, 'key-olya')
    const itemId = guest.items[0]!.id
    expect(guest.gifts).toBe(true)
    expect(guest.items[0]).toMatchObject({ held: false, heldByMe: false })

    await holdGift(token, itemId, 'Оля', 'key-olya')

    const asOlya = await getListShareView(token, 'key-olya')
    expect(asOlya.items[0]).toMatchObject({ held: true, heldByMe: true })
    // другой гость видит занятость, но не имя
    const asOther = await getListShareView(token, 'key-petya')
    expect(asOther.items[0]).toMatchObject({ held: true, heldByMe: false })
    expect(JSON.stringify(asOther)).not.toContain('Оля')

    // владелец в своём списке броней не видит
    const owner = await getList(ALEX, listId)
    expect(JSON.stringify(owner)).not.toContain('Оля')
    // и видит их только осознанно
    const holds = await listGiftHolds(ALEX, listId)
    expect(holds).toMatchObject([{ guestName: 'Оля', title: 'Королевство' }])

    // чужую бронь не снять, свою — можно
    await releaseGift(token, itemId, 'key-petya')
    expect((await getListShareView(token, 'key-olya')).items[0]!.held).toBe(true)
    await releaseGift(token, itemId, 'key-olya')
    expect((await getListShareView(token, 'key-olya')).items[0]!.held).toBe(false)
  })

  test('старый виш-лист переезжает в список «Хочу почитать»', async () => {
    await createBook(ALEX, {
      title: 'Сага о Форсайтах',
      authors: 'Джон Голсуорси',
      wishlist: true,
    })
    await backfillWishlists()

    const listId = await defaultWishlistId(ALEX)
    expect(listId).not.toBeNull()
    const view = await getList(ALEX, listId!)
    expect(view.items.some((i) => i.title === 'Сага о Форсайтах')).toBe(true)

    // повторный прогон не дублирует
    const before = view.items.length
    await backfillWishlists()
    expect((await getList(ALEX, listId!)).items).toHaveLength(before)

    const lists = await listMyLists(ALEX)
    expect(lists.filter((l) => l.kind === 'wishlist').length).toBeGreaterThan(0)
  })
})

describe('сквозная индикация', () => {
  test('кейс «Пентаграммы»: элемент-книга виден со страницы произведения', async () => {
    // произведение + издание, покрывающее его
    const workId = await ensureRefWork('fantlab', 'w-p1', 'Пентаграмма', 2003)
    const [edition] = await db
      .insert(refBook)
      .values({
        source: 'fantlab',
        sourceRef: 'ed-p1',
        isbn13: '9785389999991',
        title: 'Пентаграмма',
        titleNorm: normalizeForSearch('Пентаграмма'),
        authors: 'Ю Несбё',
        year: 2017,
      })
      .returning({ id: refBook.id })
    await db
      .insert(refBookWork)
      .values({ refBookId: edition!.id, workId })

    // мигрированный «Хочу»: книга каталога со ссылкой на произведение
    const migrated = await createBook(ALEX, {
      title: 'Пентаграмма',
      authors: 'Ю Несбё',
      wishlist: true,
      refWorkId: workId,
    })
    const { id: listId } = await createList(ALEX, {
      kind: 'wishlist',
      title: 'Сквозной вишлист',
    })
    await addToList(ALEX, listId, { bookId: migrated.id })

    // страница произведения видит членство книги
    expect(await listsForOne(ALEX, { refWorkId: workId })).toMatchObject([
      { id: listId },
    ])
    // страница издания — тоже (через произведение)
    expect(await listsForOne(ALEX, { refBookId: edition!.id })).toMatchObject([
      { id: listId },
    ])

    // шторка: галочка с формой и без конфликта у той же книги
    const picks = await listsForTarget(ALEX, { refWorkId: workId })
    const pick = picks.find((x) => x.id === listId)
    expect(pick).toMatchObject({ contains: true, conflict: null })
    expect(pick?.match?.form).toBe('book')
  })

  test('конфликты форм: издание поверх произведения и наоборот', async () => {
    const workId = await ensureRefWork('fantlab', 'w-c1', 'Нетопырь', 1997)
    const [edition] = await db
      .insert(refBook)
      .values({
        source: 'fantlab',
        sourceRef: 'ed-c1',
        isbn13: '9785389999992',
        title: 'Нетопырь',
        titleNorm: normalizeForSearch('Нетопырь'),
        authors: 'Ю Несбё',
        year: 2017,
      })
      .returning({ id: refBook.id })
    await db.insert(refBookWork).values({ refBookId: edition!.id, workId })

    // в списке лежит произведение → цель-издание получает конфликт «заменить»
    const { id: withWork } = await createList(ALEX, {
      kind: 'wishlist',
      title: 'С произведением',
    })
    await addToList(ALEX, withWork, { refWorkId: workId })
    const pickEdition = (
      await listsForTarget(ALEX, { refBookId: edition!.id })
    ).find((x) => x.id === withWork)
    expect(pickEdition).toMatchObject({
      contains: true,
      conflict: 'work-behind',
    })
    expect(pickEdition?.match?.formLabel).toBe('как произведение')

    // в списке лежит издание → цель-произведение получает «можно не добавлять»
    const { id: withEdition } = await createList(ALEX, {
      kind: 'collection',
      title: 'С изданием',
    })
    await addToList(ALEX, withEdition, { refBookId: edition!.id })
    const pickWork = (await listsForTarget(ALEX, { refWorkId: workId })).find(
      (x) => x.id === withEdition,
    )
    expect(pickWork).toMatchObject({
      contains: true,
      conflict: 'edition-behind',
    })
    expect(pickWork?.match?.formLabel).toBe('издание 2017 года')
    expect(pickWork?.match?.refBookId).toBe(edition!.id)

    // точная форма на месте → конфликта нет, тап убирает её
    const samePick = (
      await listsForTarget(ALEX, { refWorkId: workId })
    ).find((x) => x.id === withWork)
    expect(samePick).toMatchObject({ contains: true, conflict: null })
    expect(samePick?.match?.form).toBe('work')

    // формы в самом списке
    const view = await getList(ALEX, withEdition)
    expect(view.items[0]!.form).toBe('edition')
  })
})

describe('индикация списков', () => {
  test('членство видно и по книге, и по произведению', async () => {
    const { id: listId } = await createList(ALEX, {
      kind: 'wishlist',
      title: 'Исторические романы',
    })
    const workId = await ensureRefWork('fantlab', 'w-9', 'Вечер и утро', 2020)
    await addToList(ALEX, listId, { refWorkId: workId })

    const badges = await listsForOne(ALEX, { refWorkId: workId })
    expect(badges).toMatchObject([
      { id: listId, kind: 'wishlist', title: 'Исторические романы' },
    ])
    // чужие списки в индикацию не попадают
    expect(await listsForOne(OLYA, { refWorkId: workId })).toEqual([])

    const view = await getWorkView(ALEX, workId)
    expect(view.lists).toHaveLength(1)

    const biblio = await authorBibliography(ALEX, await ensureAuthorId())
    expect(biblio.find((r) => r.id === workId)?.listed).toBe(true)
  })
})

async function ensureAuthorId() {
  const { ensureAuthor } = await import('./authors')
  const { linkWorkAuthor } = await import('./reference')
  const authorId = await ensureAuthor('Кен Фоллетт')
  const workId = await ensureRefWork('fantlab', 'w-9', 'Вечер и утро', 2020)
  await linkWorkAuthor(workId, authorId)
  return authorId
}
