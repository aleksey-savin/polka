import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, test } from 'bun:test'

import type { MetadataDraft } from './metadata/types'
import type { SourceAdapter, SourceKey } from './find/types'

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
  applyProposal,
  applyRecognition,
  backfillAiQueue,
  cleanFoundTitle,
  cleanPublisher,
  dismissRecognition,
  nextVariant,
  proposeForBook,
  approveToReference,
  listAiReview,
  parseGuess,
  recognizeBook,
  rejectRecognition,
  revertRecognition,
  looksTransliterated,
  cleanAnnotation,
} = await import('./aiRecognize')
const { isbnOrigin } = await import('./isbnPrefix')
const { ADAPTERS: REAL_ADAPTERS } = await import('./find/adapters')

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

/**
 * Подставные источники (M32).
 *
 * Сеть живёт в адаптерах, поэтому тесты подставляют их целиком, а не пишут
 * находку в кэш руками: так проверяется настоящая цепочка, включая отказы.
 */
const stub = (
  key: SourceKey,
  drafts: Array<MetadataDraft> = [],
  paid = false,
): SourceAdapter => ({
  key,
  paid,
  timeoutMs: 500,
  probe: async () =>
    drafts.map((draft, index) => ({
      key,
      variantKey: drafts.length > 1 ? `${key}#${index + 1}` : key,
      draft,
      proof:
        key === 'web' || key === 'neuro'
          ? { url: 'https://www.labirint.ru/books/1/', title: 'labirint.ru' }
          : null,
      refBookId: null,
      workId: null,
      covers: [],
      weak: false,
    })),
})

/** Что «нашёл» Яндекс Поиск в этом тесте: ставится перед вызовом разбора. */
let webDrafts: Array<MetadataDraft> = []

/**
 * Подменяем только сетевые ступени. Эталон — своя база, он должен работать
 * по-настоящему: половина тестов как раз про то, что находка приходит оттуда.
 */
const ADAPTERS = (): Partial<Record<SourceKey, SourceAdapter>> => ({
  reference: REAL_ADAPTERS.reference,
  fantlab: stub('fantlab'),
  google: stub('google'),
  openlibrary: stub('openlibrary'),
  web: stub('web', webDrafts, true),
  neuro: stub('neuro', [], true),
})

/** Веб-находка: цепочка дойдёт до Яндекс Поиска и получит её. */
function webFound(fields: {
  title: string
  authors?: string
  publisher?: string | null
  year?: number | null
}) {
  webDrafts = [
    {
      title: fields.title,
      authors: fields.authors ?? 'Автор',
      publisher: fields.publisher ?? undefined,
      year: fields.year ?? undefined,
    },
  ]
}

async function unrecognizedBook(isbn13: string) {
  // находку прошлого теста не наследуем: у каждого своя
  webDrafts = []
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
    const result = await recognizeBook(ME, id, { adapters: ADAPTERS() })
    expect(result.verdict).toBe('unknown')
    expect(result.confirmed).toBeNull()
    await expect(applyRecognition(ME, id)).rejects.toThrow(/вручную/i)
  })

  test('неподтверждённое применяется с пометкой и откатывается', async () => {
    const id = await unrecognizedBook('9785171111113')
    webFound({
      title: 'Небывалая книга',
      authors: 'Иван Иванов',
      year: 2020,
    })
    const result = await recognizeBook(ME, id, { adapters: ADAPTERS() })
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
    const result = await recognizeBook(ME, id, { adapters: ADAPTERS() })
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

    const result = await recognizeBook(ME, id, { adapters: ADAPTERS() })
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

    const result = await recognizeBook(ME, id, { adapters: ADAPTERS() })
    // прошлогодний отказ не отдали из кэша, а прошли цепочку заново
    expect(result.cached).toBe(false)

    await db.delete(sourceSetting)
  })

  test('повторный разбор того же номера модель не тревожит', async () => {
    const before = calls
    const id = await unrecognizedBook('9785171111113')
    const result = await recognizeBook(ME, id, { adapters: ADAPTERS() })
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

  test('«заменить» правит и название, «заполнить» — только пустое', async () => {
    const created = await createBook(ME, {
      title: 'Iskusstvo voyny',
      authors: 'Сунь-цзы',
      isbn13: '9785171636951', // это издание лежит в эталоне
      libraryId: library.id,
      shelfId: shelf.id,
    })

    // ветка «заполнить» название не трогает
    const fill = await proposeForBook(
      ME,
      created.id,
      'fill',
      undefined,
      false,
      {
        adapters: ADAPTERS(),
      },
    )
    expect(fill?.fills.some((f) => f.field === 'title')).toBe(false)

    // ветка «заменить» предлагает заменить название целиком
    const replace = await proposeForBook(
      ME,
      created.id,
      'replace',
      undefined,
      false,
      {
        adapters: ADAPTERS(),
      },
    )
    expect(replace?.mode).toBe('replace')
    expect(replace?.fills.some((f) => f.field === 'title')).toBe(true)
    expect(replace?.current.title).toBe('Iskusstvo voyny')

    await applyProposal(ME, replace!.suggestionId!)
    const [after] = await db.select().from(book).where(eq(book.id, created.id))
    expect(after?.title).toBe('Правда о деле Гарри Квеберта')
    // поиск ищет по нормализованным полям — они тоже обновились
    expect(after?.titleNorm).toContain('правда')
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
    expect(
      await proposeForBook(ME, created.id, 'fill', undefined, false, {
        adapters: ADAPTERS(),
      }),
    ).toBeNull()

    const [row] = await db.select().from(book).where(eq(book.id, created.id))
    // и ничего не затёрлось
    expect(row?.publisher).toBe('Своё издательство')
  })
})

describe('искать дальше', () => {
  test('отвергнутый источник не возвращается, цепочка идёт дальше', async () => {
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

    const first = await recognizeBook(ME, id, { adapters: ADAPTERS() })
    expect(first.via).toBe('reference')
    expect(first.guess.title).toBe('Vzglyad nazad')

    // латиница не устроила — идём дальше; других путей в тестах нет
    const second = await nextVariant(ME, id, { adapters: ADAPTERS() })
    expect(second.guess.title).toBeNull()
    expect(second.exhausted).toBe(true)
    // найденное раньше не потеряно: оно осталось в истории вариантов
    expect(second.variants.map((v) => v.title)).toContain('Vzglyad nazad')
  })
})

describe('история вариантов', () => {
  test('варианты копятся, листаются и сохраняется выбранный', async () => {
    const isbn = '9785496012706'
    await db.insert(refBook).values({
      source: 'fantlab',
      sourceRef: 'edition-var',
      isbn13: isbn,
      title: 'Vzglyad nazad',
      titleNorm: 'vzglyad nazad',
      authors: 'Radke',
      publisher: 'Piter',
    })
    const id = await unrecognizedBook(isbn)

    const first = await recognizeBook(ME, id, { adapters: ADAPTERS() })
    expect(first.variants.length).toBe(1)
    expect(first.variants[0]?.via).toBe('reference')

    // «промазал»: отверг хороший вариант — история его сохранила
    const second = await nextVariant(ME, id, { adapters: ADAPTERS() })
    expect(second.variants.map((v) => v.via)).toContain('reference')

    // тупика нет: сохранить можно и отвергнутый первый вариант
    await applyRecognition(ME, id, undefined, 'reference')
    const [saved] = await db.select().from(book).where(eq(book.id, id))
    expect(saved?.title).toBe('Vzglyad nazad')
    expect(saved?.publisher).toBe('Piter')
  })

  test('«начать заново» стирает историю', async () => {
    const isbn = '9785496012706'
    const id = (
      await db.select({ id: book.id }).from(book).where(eq(book.isbn13, isbn))
    )[0]!.id
    answer = '{"known":false}'
    const fresh = await recognizeBook(ME, id, {
      force: true,
      adapters: ADAPTERS(),
    })
    // эталонная запись снова находится первой ступенью, история новая
    expect(fresh.variants.length).toBe(1)
    expect(fresh.via).toBe('reference')
  })
})

describe('старый кэш без via', () => {
  test('«Искать дальше» не зацикливается на записи до колонки via', async () => {
    const isbn = '9785970439517'
    const id = await unrecognizedBook(isbn)
    await db.delete(aiIsbnGuess).where(eq(aiIsbnGuess.isbn13, isbn))
    // так выглядит запись, сделанная до веб-поиска: via отсутствует
    await db.insert(aiIsbnGuess).values({
      isbn13: isbn,
      verdict: 'unconfirmed',
      title: 'Психиатрия',
      authors: 'Бухановский',
      via: null,
    })

    answer = '{"known":false}'
    const next = await nextVariant(ME, id, { adapters: ADAPTERS() })
    // старый вариант не вернулся: путь «model» отвергнут, дальше пусто
    expect(next.guess.title).not.toBe('Психиатрия')
    expect(next.guess.title).toBeNull()
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

describe('транслит в эталоне не перебивает находку поиска', () => {
  test('показывается русское название, а не латиница из каталога', async () => {
    // ровно случай «Deti-bilingvy»: в эталоне лежит латинская запись,
    // попавшая туда из Google, а Яндекс находит нормальное издание
    const isbn = '9789859051593'
    await db.insert(refBook).values({
      source: 'google',
      sourceRef: 'g-deti',
      isbn13: isbn,
      title: 'Deti-bilingvy',
      titleNorm: 'deti-bilingvy',
      authors: 'Barbara Abdelilah-Bauer',
    })
    const id = await unrecognizedBook(isbn)
    webFound({
      title: 'Дети-билингвы: практический путеводитель для родителей',
      authors: 'Барбара Абделила-Боэр',
      year: 2020,
    })

    const found = await recognizeBook(ME, id, { adapters: ADAPTERS() })
    const shown = found.variants[found.variantIndex]
    expect(shown?.title).toBe(
      'Дети-билингвы: практический путеводитель для родителей',
    )
    // латиница не потеряна — её можно долистать стрелками
    expect(found.variants.map((v) => v.title)).toContain('Deti-bilingvy')
  })

  test('добор цепочки попадает в показываемый вариант', async () => {
    const isbn = '9785042777776'
    const id = await unrecognizedBook(isbn)
    webFound({ title: 'Книга с описанием', authors: 'Автор' })

    const found = await recognizeBook(ME, id, { adapters: ADAPTERS() })
    const shown = found.variants[found.variantIndex]
    // черновик цепочки и показанный вариант не должны расходиться
    expect(shown?.title).toBe(found.confirmed?.title)
  })
})

describe('модерация и эталон', () => {
  test('утверждение заводит запись эталона, отклонение — откатывает', async () => {
    const isbn = '9785042222221'
    const id = await unrecognizedBook(isbn)
    webFound({
      title: 'Проверяемая книга',
      authors: 'Пётр Петров',
      year: 2019,
    })
    await recognizeBook(ME, id, { adapters: ADAPTERS() })
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
    webFound({ title: 'Выдумка', authors: 'Никто', year: 2021 })
    await recognizeBook(ME, id, { adapters: ADAPTERS() })
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

describe('чистка издательства', () => {
  test('кавычки и форма собственности снимаются', () => {
    expect(cleanPublisher('"Манн, Иванов и Фербер"')).toBe(
      'Манн, Иванов и Фербер',
    )
    expect(cleanPublisher('«Азбука»')).toBe('Азбука')
    expect(cleanPublisher('ООО Эксмо')).toBe('Эксмо')
  })

  test('нормальное название не портится', () => {
    expect(cleanPublisher('Альпина нон-фикшн')).toBe('Альпина нон-фикшн')
    expect(cleanPublisher(null)).toBeNull()
    expect(cleanPublisher('  ')).toBeNull()
  })
})

describe('находки ИИ в очереди модерации', () => {
  test('применённая находка попадает в общую очередь с меткой', async () => {
    const isbn = '9785171111113'
    const [target] = await db
      .select({ id: book.id })
      .from(book)
      .where(eq(book.isbn13, isbn))
    const { moderationItem } = await import('@/db/schema/moderation')
    const [item] = await db
      .select()
      .from(moderationItem)
      .where(eq(moderationItem.targetId, target!.id))
    expect(item?.kind).toBe('ai_book')
    expect(item?.fromAi).toBe(true)
  })

  test('перенос старых находок не плодит дубли', async () => {
    const { moderationItem } = await import('@/db/schema/moderation')
    const before = (await db.select().from(moderationItem)).length
    await backfillAiQueue()
    await backfillAiQueue()
    const after = (await db.select().from(moderationItem)).length
    expect(after).toBe(before)
  })
})

describe('транслит из каталога', () => {
  test('латиница у постсоветского номера — транслит, у зарубежного — нет', () => {
    // как Google Books записывает русские издания
    expect(
      looksTransliterated('9789859051586', 'Deti-bilingvy', 'Barbara'),
    ).toBe(true)
    expect(looksTransliterated('9785171636951', 'Iskusstvo voyny', null)).toBe(
      true,
    )
    // кириллица в любом поле — уже не транслит
    expect(looksTransliterated('9785171636951', 'Дети-билингвы', null)).toBe(
      false,
    )
    // настоящее английское издание не трогаем
    expect(looksTransliterated('9780262033848', 'Introduction', 'Cormen')).toBe(
      false,
    )
  })

  test('на транслите цепочка не останавливается, но находку не теряет', async () => {
    const isbn = '9789859051586'
    await db.insert(refBook).values({
      source: 'google',
      sourceRef: 'g-translit',
      isbn13: isbn,
      title: 'Deti-bilingvy',
      titleNorm: 'deti-bilingvy',
      authors: 'Barbara Abdelilah-Bauer',
    })
    const id = await unrecognizedBook(isbn)

    const found = await recognizeBook(ME, id, { adapters: ADAPTERS() })
    // ответ есть, но подтверждённым его не считаем: имя нечитаемое
    expect(found.verdict).toBe('unconfirmed')
    expect(found.guess.title).toBe('Deti-bilingvy')
    // веб в тестах молчит, поэтому дальше идти некуда
    expect(found.exhausted).toBe(true)
  })

  test('проверенный модератором эталон транслитом не считается', async () => {
    const isbn = '9785904584016'
    await db.insert(refBook).values({
      source: 'manual',
      sourceRef: 'manual-latin',
      isbn13: isbn,
      title: 'Sapiens',
      titleNorm: 'sapiens',
      authors: 'Yuval Noah Harari',
    })
    const id = await unrecognizedBook(isbn)

    const found = await recognizeBook(ME, id, { adapters: ADAPTERS() })
    expect(found.verdict).toBe('confirmed')
    expect(found.exhausted).toBe(false)
  })
})

describe('обновление данных карточки', () => {
  test('когда менять нечего, предложение остаётся для «искать дальше»', async () => {
    const isbn = '9785904584023'
    await db.insert(refBook).values({
      source: 'manual',
      sourceRef: 'manual-same',
      isbn13: isbn,
      title: 'Тень горы',
      titleNorm: 'тень горы',
      authors: 'Грегори Дэвид Робертс',
    })
    const created = await createBook(ME, {
      title: 'Тень горы',
      authors: 'Грегори Дэвид Робертс',
      isbn13: isbn,
      libraryId: library.id,
      shelfId: shelf.id,
    })

    const proposal = await proposeForBook(
      ME,
      created.id,
      'replace',
      undefined,
      false,
      {
        adapters: ADAPTERS(),
      },
    )
    expect(proposal?.fills).toEqual([])
    // нечего применять — но и тупика нет: шторка покажет «искать дальше»
    expect(proposal?.suggestionId).toBeNull()
    expect(proposal?.title).toBe('Тень горы')
  })
})

describe('аннотация со страницы', () => {
  test('карточка товара за аннотацию не сходит', () => {
    expect(
      cleanAnnotation(
        'Купить книгу «Дети-билингвы» в интернет-магазине, цена 790 ₽, доставка по России за 2 дня, отзывы покупателей.',
      ),
    ).toBeNull()
    // слишком короткое — это подпись, а не описание
    expect(cleanAnnotation('Книга о детях.')).toBeNull()
    const real =
      'Барбара Абделила-Боэр рассказывает, как растить ребёнка в двух языках: ' +
      'что происходит с речью в первые годы, почему дети отказываются говорить ' +
      'на «домашнем» языке и что делать родителям.'
    expect(cleanAnnotation(real)).toBe(real)
  })
})
