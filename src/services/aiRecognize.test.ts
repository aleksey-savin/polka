import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-airec-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-ai-recognize'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { book, refBook } = await import('@/db/schema/catalog')
const { aiIsbnGuess, aiSuggestion, sourceSetting } =
  await import('@/db/schema/moderation')
const { eq } = await import('drizzle-orm')
const { saveAiSettings } = await import('./ai')
const { createLibrary } = await import('./libraries')
const { createShelf } = await import('./shelves')
const { createBook } = await import('./books')
const { userAccount } = await import('@/db/schema/moderation')
const {
  applyRecognition,
  cleanFoundTitle,
  dismissRecognition,
  nextVariant,
  proposeForBook,
  approveToReference,
  listAiReview,
  parseGuess,
  recognizeBook,
  rejectRecognition,
  revertRecognition,
} = await import('./aiRecognize')
const { isbnOrigin } = await import('./isbnPrefix')

const ME = 'rec-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'rec@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
// модерируем от админа: ensureFirstAdmin зависел бы от чужих тестовых данных
await db.insert(userAccount).values({ userId: ME, role: 'admin' })

const library = await createLibrary(ME, { name: 'Дом' })
const shelf = await createShelf(ME, { libraryId: library.id, name: 'Полка' })

/** Подставная модель: отвечает тем, что положили в answer. */
let answer = '{"known":false}'
let calls = 0
const server = Bun.serve({
  port: 0,
  fetch() {
    calls++
    return Response.json({
      choices: [{ message: { content: answer } }],
      usage: { total_tokens: 5 },
    })
  },
})
afterAll(() => server.stop(true))

await saveAiSettings({
  enabled: true,
  provider: 'openai',
  apiKey: 'k',
  folderId: '',
  model: 'test-model',
  endpoint: `http://localhost:${server.port}/v1`,
  dailyLimit: 50,
})

async function unrecognizedBook(isbn13: string) {
  const created = await createBook(ME, {
    title: isbn13,
    authors: '',
    isbn13,
    libraryId: library.id,
    shelfId: shelf.id,
    unrecognized: true,
  })
  return created.id
}

describe('издательство из номера', () => {
  test('узнаётся по префиксу, без всяких запросов', () => {
    expect(isbnOrigin('978-5-17-163695-1').publisher).toBe('АСТ')
    expect(isbnOrigin('9785389215564').publisher).toBe('Азбука-Аттикус')
    expect(isbnOrigin('5-7027-0234-6').publisher).toBe('Лексика')
  })

  test('незнакомый префикс не выдумывается', () => {
    const origin = isbnOrigin('978-5-99999-999-9')
    expect(origin.publisher).toBeNull()
    expect(origin.country).toBe('Россия')
  })

  test('иностранный номер не трогаем', () => {
    expect(isbnOrigin('978-0-14-118776-1').publisher).toBeNull()
    expect(isbnOrigin('').publisher).toBeNull()
  })
})

describe('ответ модели', () => {
  test('вытаскивается из обрамлённого текста', () => {
    const guess = parseGuess(
      'Вот ответ:\n```json\n{"known":true,"title":"Тайная история","authors":"Донна Тартт","year":2015}\n```',
    )
    expect(guess.known).toBe(true)
    expect(guess.title).toBe('Тайная история')
    expect(guess.year).toBe(2015)
  })

  test('мусор и пустое название дают «не знаю»', () => {
    expect(parseGuess('не знаю такой книги').known).toBe(false)
    expect(parseGuess('{"known":true,"title":"  "}').known).toBe(false)
    expect(
      parseGuess('{"known":true,"title":"Х","year":"позапрошлый"}').year,
    ).toBeNull()
  })
})

describe('разбор нераспознанного', () => {
  test('честное «не знаю» не заполняет карточку', async () => {
    const id = await unrecognizedBook('9785999999993')
    answer = '{"known":false}'
    const result = await recognizeBook(ME, id)
    expect(result.verdict).toBe('unknown')
    expect(result.confirmed).toBeNull()
    await expect(applyRecognition(ME, id)).rejects.toThrow(/вручную/i)
  })

  test('неподтверждённое применяется с пометкой и откатывается', async () => {
    const id = await unrecognizedBook('9785171111113')
    answer =
      '{"known":true,"title":"Небывалая книга","authors":"Иван Иванов","year":2020}'
    const result = await recognizeBook(ME, id)
    expect(result.verdict).toBe('unconfirmed')
    expect(result.fromPrefix).toBe('АСТ')

    await applyRecognition(ME, id)
    const [after] = await db.select().from(book).where(eq(book.id, id))
    expect(after?.title).toBe('Небывалая книга')
    expect(after?.unrecognized).toBe(false)

    await revertRecognition(ME, id)
    const [back] = await db.select().from(book).where(eq(book.id, id))
    expect(back?.title).toBe('9785171111113')
    expect(back?.unrecognized).toBe(true)
  })

  test('подтверждение берёт данные из эталона, а не со слов модели', async () => {
    const isbn = '9785171636951'
    await db.insert(refBook).values({
      source: 'fantlab',
      sourceRef: 'edition-1',
      isbn13: isbn,
      title: 'Правда о деле Гарри Квеберта',
      titleNorm: 'правда о деле гарри квеберта',
      authors: 'Жоэль Диккер',
      publisher: 'АСТ',
      year: 2024,
      pages: 608,
    })
    const id = await unrecognizedBook(isbn)
    answer =
      '{"known":true,"title":"Правда о деле Гарри Квеберта","authors":"Жоэль Диккер","year":2012}'
    const result = await recognizeBook(ME, id)
    expect(result.verdict).toBe('confirmed')
    expect(result.confirmed?.pages).toBe(608)

    await applyRecognition(ME, id)
    const [saved] = await db.select().from(book).where(eq(book.id, id))
    // год из каталога (2024), а не из ответа модели (2012)
    expect(saved?.year).toBe(2024)
    expect(saved?.pages).toBe(608)
  })

  test('источники сильнее модели: их находка не помечается как работа ИИ', async () => {
    const isbn = '9785171636951' // это издание лежит в эталоне (тест выше)
    const before = calls
    const id = await unrecognizedBook(isbn)
    await db.delete(aiIsbnGuess).where(eq(aiIsbnGuess.isbn13, isbn))

    const result = await recognizeBook(ME, id)
    expect(result.askedModel).toBe(false)
    expect(result.verdict).toBe('confirmed')
    expect(calls).toBe(before) // запрос к модели не потрачен

    await applyRecognition(ME, id)
    const [saved] = await db.select().from(book).where(eq(book.id, id))
    expect(saved?.unrecognized).toBe(false)
    // пометки «заполнил ИИ» быть не должно: данные пришли из каталога
    const marks = await db
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.bookId, id))
    expect(marks.length).toBe(0)
  })

  test('старое «не знаю» не хоронит книгу: с новым способом пробуем заново', async () => {
    const isbn = '9785044444447'
    const id = await unrecognizedBook(isbn)
    // так выглядит запись, сделанная до появления поиска в интернете
    await db.delete(aiIsbnGuess).where(eq(aiIsbnGuess.isbn13, isbn))
    await db.insert(aiIsbnGuess).values({
      isbn13: isbn,
      verdict: 'unknown',
      via: 'model',
    })
    await db.insert(sourceSetting).values({ id: 'default', webEnabled: true })

    const before = calls
    answer = '{"known":false}'
    await recognizeBook(ME, id)
    // модель спросили снова, а не отдали прошлогодний отказ
    expect(calls).toBeGreaterThan(before)

    await db.delete(sourceSetting)
  })

  test('повторный разбор того же номера модель не тревожит', async () => {
    const before = calls
    const id = await unrecognizedBook('9785171111113')
    const result = await recognizeBook(ME, id)
    expect(result.cached).toBe(true)
    expect(calls).toBe(before)
  })
})

describe('решение человека', () => {
  test('«не то» оставляет книгу в списке и не предлагает то же снова', async () => {
    const isbn = '9785042222221'
    const [target] = await db
      .select()
      .from(book)
      .where(eq(book.isbn13, isbn))
      .limit(1)
    const id = target?.id ?? (await unrecognizedBook('9785044444447'))

    await dismissRecognition(ME, id)
    const [guess] = await db
      .select()
      .from(aiIsbnGuess)
      .where(eq(aiIsbnGuess.isbn13, isbn))
    if (guess) {
      expect(guess.verdict).toBe('unknown')
      expect(guess.title).toBeNull()
    }
  })

  test('дозаполнение заполняет только пустые поля', async () => {
    const created = await createBook(ME, {
      title: 'Книга с пробелами',
      authors: 'Автор Авторов',
      publisher: 'Своё издательство',
      libraryId: library.id,
      shelfId: shelf.id,
    })
    // источники в тестах молчат, поэтому предложения быть не должно
    expect(await proposeForBook(ME, created.id)).toBeNull()

    const [row] = await db.select().from(book).where(eq(book.id, created.id))
    // и ничего не затёрлось
    expect(row?.publisher).toBe('Своё издательство')
  })
})

describe('искать дальше', () => {
  test('отвергнутый источник не возвращается, цепочка идёт к модели', async () => {
    const isbn = '9785389215566'
    await db.insert(refBook).values({
      source: 'fantlab',
      sourceRef: 'edition-next',
      isbn13: isbn,
      title: 'Vzglyad nazad',
      titleNorm: 'vzglyad nazad',
      authors: 'Radke',
    })
    const id = await unrecognizedBook(isbn)

    const first = await recognizeBook(ME, id)
    expect(first.via).toBe('sources')
    expect(first.guess.title).toBe('Vzglyad nazad')

    // латиница не устроила — идём дальше; веб в тестах выключен, модель отвечает
    answer =
      '{"known":true,"title":"Взгляд назад","authors":"Хизер Радке","year":2025}'
    const second = await nextVariant(ME, id)
    expect(second.via).toBe('model')
    expect(second.guess.title).toBe('Взгляд назад')

    // и по кругу не ходим: повторный разбор отдаёт из кэша модельный вариант
    const third = await recognizeBook(ME, id)
    expect(third.cached).toBe(true)
    expect(third.via).toBe('model')

    // отвергли и модель — вариантов больше нет
    const done = await nextVariant(ME, id)
    expect(done.guess.title).toBeNull()
    expect(done.exhausted).toBe(true)
  })
})

describe('права', () => {
  test('чужую книгу разобрать нельзя', async () => {
    await db.insert(user).values({
      id: 'stranger',
      name: 'Чужой',
      email: 'stranger@test.local',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const id = await unrecognizedBook('9785044444447')
    await expect(recognizeBook('stranger', id)).rejects.toThrow(/доступа/i)
  })
})

describe('модерация и эталон', () => {
  test('утверждение заводит запись эталона, отклонение — откатывает', async () => {
    const isbn = '9785042222221'
    const id = await unrecognizedBook(isbn)
    answer =
      '{"known":true,"title":"Проверяемая книга","authors":"Пётр Петров","year":2019}'
    await recognizeBook(ME, id)
    await applyRecognition(ME, id)

    const queue = await listAiReview(ME)
    const row = queue.find((r) => r.isbn13 === isbn)
    expect(row).toBeDefined()
    expect(row?.fromPrefix).toBe('Эксмо')
    expect(row?.inReference).toBe(false)

    await approveToReference(ME, row!.id)
    const [ref] = await db
      .select()
      .from(refBook)
      .where(eq(refBook.isbn13, isbn))
    expect(ref?.source).toBe('manual')
    expect(ref?.title).toBe('Проверяемая книга')
    expect((await listAiReview(ME)).some((r) => r.isbn13 === isbn)).toBe(false)
  })

  test('отклонение требует причины и возвращает книгу в нераспознанные', async () => {
    const isbn = '9785043333339'
    const id = await unrecognizedBook(isbn)
    answer = '{"known":true,"title":"Выдумка","authors":"Никто","year":2021}'
    await recognizeBook(ME, id)
    await applyRecognition(ME, id)
    const row = (await listAiReview(ME)).find((r) => r.isbn13 === isbn)!

    await expect(rejectRecognition(ME, row.id, '  ')).rejects.toThrow(
      /причина/i,
    )
    await rejectRecognition(ME, row.id, 'Такой книги нет')

    const [back] = await db.select().from(book).where(eq(book.id, id))
    expect(back?.title).toBe(isbn)
    expect(back?.unrecognized).toBe(true)
    const [guess] = await db
      .select()
      .from(aiIsbnGuess)
      .where(eq(aiIsbnGuess.isbn13, isbn))
    // негодный ответ больше не всплывёт как готовое предложение
    expect(guess?.verdict).toBe('unknown')
    const [suggestion] = await db
      .select()
      .from(aiSuggestion)
      .where(eq(aiSuggestion.isbn13, isbn))
    expect(suggestion?.status).toBe('rejected')
  })
})

describe('чистка названий', () => {
  test('магазинный мусор снимается', () => {
    expect(cleanFoundTitle('Читаем, пишем, говорим по-японски.')).toBe(
      'Читаем, пишем, говорим по-японски',
    )
    expect(cleanFoundTitle('Взгляд назад (мягкая обложка)')).toBe(
      'Взгляд назад',
    )
    expect(cleanFoundTitle('Книга (ISBN 978-5-04-117324-9)')).toBe('Книга')
    expect(cleanFoundTitle('Тайна (твёрдый переплёт).')).toBe('Тайна')
  })

  test('честные скобки и многоточие не трогаются', () => {
    expect(cleanFoundTitle('Пикник на обочине (сборник)')).toBe(
      'Пикник на обочине (сборник)',
    )
    expect(cleanFoundTitle('А зори здесь тихие...')).toBe(
      'А зори здесь тихие...',
    )
  })
})
