# Эталон дополняется, книги подтягиваются — план реализации (M34)

> **Для исполнителя-агента:** ОБЯЗАТЕЛЬНЫЙ СУБ-НАВЫК — `superpowers:subagent-driven-development` (рекомендуется) либо `superpowers:executing-plans`. Задачи выполняются по одной, шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** довести до конца путь «сохранил неполное → модератор дополнил → у всех владельцев этой книги появилась кнопка обновиться».

**Архитектура:** у записи эталона появляется контрольная сумма значимых полей, у книги — отметка, какая версия эталона в неё применена. Расхождение сумм и есть «эталон дополнен»: одно сравнение вместо разбора десятка полей. Черновик модерации расширяется до полного издания, а обновление карточки идёт целиком, через уже существующего писателя `applyDraftToBook`, со снимком «до» для отката.

**Тех.стек:** TypeScript 6 strict, Bun 1.3, Drizzle ORM 0.45.2 (только core-запросы), zod 4, Winston 3, `bun test`.

**Макет:** `docs/design/reference-sync.html` — согласован 19 августа 2026.

## Глобальные ограничения

Действуют во всех задачах.

- **Язык:** комментарии, сообщения об ошибках, тексты журнала и интерфейса — по-русски.
- **Слои:** логика в `src/services/`, серверные функции в `src/server/` тонкие (auth + валидация + вызов сервиса).
- **Команды:** перед `bun` в окружении `BUN_INSTALL="$PWD/.bun"`, `BUN_TMPDIR="$PWD/.bun/tmp"`, `$BUN_INSTALL/bin` в `PATH`. Проверки через `&&`, никогда через пайп.
- **Миграции** читать глазами перед коммитом (подводный камень №2 в `architecture.md`).
- **Тесты не ходят в сеть.** Глобальные настройки в тестах не менять: `bun test` держит `@/db` одним на процесс, файлы делят базу.
- **Личный слой неприкосновенен.** Оценка, рецензия, заметки, полка, списки, статус чтения не меняются никогда — обновляются только данные издания.
- **Ничего молча.** Карточка владельца меняется только по его кнопке; у изменения есть откат.
- **Коммит после каждой задачи**, сообщение по-русски в стиле репозитория («M34: …»).

---

## Карта файлов

| Файл                                         | Ответственность                                    |
| -------------------------------------------- | -------------------------------------------------- |
| `src/services/reference/checksum.ts` (новый) | расчёт контрольной суммы записи эталона            |
| `src/services/reference/sync.ts` (новый)     | что можно обновить, обновление, сводка             |
| `src/services/reference.ts`                  | пересчёт суммы при записи, связывание книг по ISBN |
| `src/services/moderation.ts`                 | полный черновик издания, публикация всех полей     |
| `src/services/aiRecognize.ts`                | дозаполнение тоже встаёт в очередь                 |
| `src/services/reading.ts`                    | сводка «можно дополнить» в хабе                    |
| `src/db/schema/catalog.ts`                   | `ref_book.checksum`, `book.ref_checksum`           |
| `src/server/reference.ts`                    | серверные функции сравнения и обновления           |
| `src/routes/_app/books.$bookId.tsx`          | плашка и шторка обновления                         |
| `src/routes/_app/reading.tsx`                | секция «Можно дополнить»                           |
| `src/routes/_app/service_.queue.tsx`         | поля полного черновика в форме модератора          |

---

## Задача 1: Контрольная сумма записи эталона

**Файлы:**

- Создать: `src/services/reference/checksum.ts`
- Создать: `src/services/reference/checksum.test.ts`
- Изменить: `src/db/schema/catalog.ts` (колонка `checksum` у `refBook`)
- Создать: миграция через `bun run db:generate`

**Интерфейсы:**

- Отдаёт наружу: `refChecksum(row): string`, `SYNCED_FIELDS`.

- [ ] **Шаг 1: Добавить колонку**

В `src/db/schema/catalog.ts` в таблицу `refBook` после `coverUrl`:

```ts
    /**
     * Контрольная сумма значимых полей (M34). Меняется при любой правке
     * записи модератором — по ней книги понимают, что эталон дополнили.
     */
    checksum: text('checksum'),
```

- [ ] **Шаг 2: Сгенерировать и прочитать миграцию**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run db:generate`

Ожидается `ALTER TABLE ref_book ADD checksum text;`. Пересоздания таблицы быть не должно — прочитать файл глазами.

- [ ] **Шаг 3: Написать падающий тест**

Создать `src/services/reference/checksum.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { refChecksum } from './checksum'

const base = {
  title: 'Дети-билингвы',
  authors: 'Абделила-Боэр Барбара',
  publisher: 'Дискурс',
  year: 2020,
  pages: 256,
  language: 'ru',
  seriesName: 'Наше будущее',
  annotation: 'О детях в двуязычной среде.',
  coverUrl: 'https://example.org/cover.jpg',
}

describe('контрольная сумма эталона', () => {
  test('одинаковые данные — одинаковая сумма', () => {
    expect(refChecksum(base)).toBe(refChecksum({ ...base }))
  })

  test('правка любого значимого поля меняет сумму', () => {
    for (const field of [
      'title',
      'authors',
      'publisher',
      'annotation',
      'seriesName',
    ] as const) {
      const changed = { ...base, [field]: `${String(base[field])} (ред.)` }
      expect(refChecksum(changed)).not.toBe(refChecksum(base))
    }
    expect(refChecksum({ ...base, year: 2021 })).not.toBe(refChecksum(base))
    expect(refChecksum({ ...base, pages: 300 })).not.toBe(refChecksum(base))
  })

  test('пустое и отсутствующее — одно и то же', () => {
    expect(refChecksum({ ...base, annotation: null })).toBe(
      refChecksum({ ...base, annotation: '' }),
    )
  })

  test('лишние пробелы не считаются правкой', () => {
    expect(refChecksum({ ...base, title: '  Дети-билингвы  ' })).toBe(
      refChecksum(base),
    )
  })

  test('сумма короткая и стабильная между запусками', () => {
    const sum = refChecksum(base)
    expect(sum).toHaveLength(16)
    expect(sum).toMatch(/^[0-9a-f]{16}$/)
  })
})
```

- [ ] **Шаг 4: Убедиться, что тест падает**

Выполнить: `bun test src/services/reference/checksum.test.ts`

Ожидается: FAIL — `Cannot find module './checksum'`.

- [ ] **Шаг 5: Написать расчёт**

Создать `src/services/reference/checksum.ts`:

```ts
import { createHash } from 'node:crypto'

/**
 * Контрольная сумма записи эталона (M34).
 *
 * У книги хранится сумма той версии эталона, которую в неё применили.
 * Разошлись — значит запись дополнили, и владельцу есть что подтянуть.
 * Это одно сравнение вместо разбора десятка полей на каждой карточке.
 */

/** Поля издания, которые едут из эталона в карточку. */
export const SYNCED_FIELDS = [
  'title',
  'authors',
  'publisher',
  'year',
  'pages',
  'language',
  'seriesName',
  'annotation',
  'coverUrl',
] as const

export type SyncedField = (typeof SYNCED_FIELDS)[number]

export type RefLike = Partial<
  Record<SyncedField, string | number | null | undefined>
>

/** Пустое, отсутствующее и «одни пробелы» — для суммы одно и то же. */
const norm = (value: string | number | null | undefined): string =>
  value === null || value === undefined
    ? ''
    : String(value).replace(/\s+/g, ' ').trim()

export function refChecksum(row: RefLike): string {
  const payload = SYNCED_FIELDS.map((f) => `${f}=${norm(row[f])}`).join('�')
  // sha1 достаточно: это не защита от подделки, а признак «данные изменились»
  return createHash('sha1').update(payload).digest('hex').slice(0, 16)
}
```

- [ ] **Шаг 6: Проверить**

Выполнить: `bun run typecheck && bun test src/services/reference/checksum.test.ts`

Ожидается: PASS, 5 тестов.

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/reference/ src/db/schema/catalog.ts drizzle/
git commit -m "M34: контрольная сумма записи эталона"
```

---

## Задача 2: Ссылка на эталон и отметка версии у книги

Сегодня `book.ref_book_id` проставляется, только если запись эталона уже была. Книга, сохранённая до модерации, остаётся без связи — и обновление до неё не дойдёт никогда.

**Файлы:**

- Изменить: `src/db/schema/catalog.ts` (колонка `refChecksum` у `book`)
- Создать: миграция
- Изменить: `src/services/reference.ts` (пересчёт суммы, связывание по ISBN)
- Создать: `src/services/reference/link.test.ts`

**Интерфейсы:**

- Потребляет: `refChecksum` из `./reference/checksum`.
- Отдаёт наружу: `linkBooksToReference(refBookId, isbn13)` → `Promise<number>` (сколько книг связали).

- [ ] **Шаг 1: Добавить колонку книге**

В `src/db/schema/catalog.ts` в таблицу `book` рядом с `refBookId`:

```ts
    /**
     * Версия эталона, применённая в эту карточку (M34). Отличается от
     * `ref_book.checksum` — значит запись дополнили и есть что подтянуть.
     */
    refChecksum: text('ref_checksum'),
    /**
     * Владелец сказал «больше не напоминать»: плашка и сводка эту книгу не
     * показывают. Обновиться он по-прежнему может сам — «Заменить данные».
     */
    refSyncMuted: integer('ref_sync_muted', { mode: 'boolean' })
      .notNull()
      .default(false),
```

- [ ] **Шаг 2: Сгенерировать и прочитать миграцию**

Выполнить: `bun run db:generate`. Ожидается два `ALTER TABLE book ADD …` — `ref_checksum` и `ref_sync_muted`. Пересоздания таблицы быть не должно.

- [ ] **Шаг 3: Написать падающий тест**

Создать `src/services/reference/link.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-reflink-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-reference-link'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { book, refBook } = await import('@/db/schema/catalog')
const { eq } = await import('drizzle-orm')
const { createLibrary } = await import('@/services/libraries')
const { createShelf } = await import('@/services/shelves')
const { createBook } = await import('@/services/books')
const { linkBooksToReference } = await import('@/services/reference')

const ME = 'link-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'link@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const lib = await createLibrary(ME, { name: 'Дом' })
const shelfRow = await createShelf(ME, { libraryId: lib.id, name: 'Полка' })

describe('связывание книг с эталоном', () => {
  test('книга, сохранённая до модерации, получает ссылку', async () => {
    const isbn = '9785171636951'
    // человек сохранил неполную карточку — эталона тогда ещё не было
    const created = await createBook(ME, {
      title: 'Зона',
      authors: '',
      isbn13: isbn,
      libraryId: lib.id,
      shelfId: shelfRow.id,
    })
    const [before] = await db.select().from(book).where(eq(book.id, created.id))
    expect(before?.refBookId).toBeNull()

    // модератор завёл запись
    const [ref] = await db
      .insert(refBook)
      .values({
        source: 'manual',
        sourceRef: 'moderated:1',
        isbn13: isbn,
        title: 'Зона: записки надзирателя',
        titleNorm: 'зона записки надзирателя',
        authors: 'Довлатов',
      })
      .returning({ id: refBook.id })

    const linked = await linkBooksToReference(ref!.id, isbn)
    expect(linked).toBe(1)
    const [after] = await db.select().from(book).where(eq(book.id, created.id))
    expect(after?.refBookId).toBe(ref!.id)
  })

  test('чужой номер не связывается', async () => {
    const [ref] = await db
      .insert(refBook)
      .values({
        source: 'manual',
        sourceRef: 'moderated:2',
        isbn13: '9785000000001',
        title: 'Другая',
        titleNorm: 'другая',
        authors: '',
      })
      .returning({ id: refBook.id })
    expect(await linkBooksToReference(ref!.id, '9785000000001')).toBe(0)
  })

  test('без номера связывать нечего', async () => {
    expect(await linkBooksToReference('whatever', null)).toBe(0)
  })
})
```

- [ ] **Шаг 4: Убедиться, что тест падает**

Выполнить: `bun test src/services/reference/link.test.ts`

Ожидается: FAIL — `linkBooksToReference is not a function`.

- [ ] **Шаг 5: Написать связывание и пересчёт суммы**

В `src/services/reference.ts` добавить:

```ts
/**
 * Связать книги с записью эталона по номеру (M34).
 *
 * Ссылка на эталон обязательна, иначе сценарий «модератор дополнил — у всех
 * появилась кнопка обновиться» не работает: книга, сохранённая до модерации,
 * осталась бы без связи навсегда.
 */
export async function linkBooksToReference(
  refBookId: string,
  isbn13: string | null,
): Promise<number> {
  if (!isbn13) return 0
  const rows = await db
    .select({ id: book.id })
    .from(book)
    .where(and(eq(book.isbn13, isbn13), isNull(book.refBookId)))
  for (const row of rows) {
    await db.update(book).set({ refBookId }).where(eq(book.id, row.id))
  }
  if (rows.length > 0) {
    log.info('reference', 'книги связаны с эталоном', {
      refBookId,
      isbn: isbn13,
      books: rows.length,
    })
  }
  return rows.length
}
```

Импорты `isNull` из `drizzle-orm`, `book` из схемы и `log` — добавить, если их нет.

Там же — пересчёт суммы при создании записи в `persistLookup`: в объект `.values({...})` добавить

```ts
          checksum: refChecksum(r.draft),
```

и импорт `import { refChecksum } from './reference/checksum'`.

- [ ] **Шаг 6: Проверить**

Выполнить: `bun run typecheck && bun test`

Ожидается: PASS, 3 новых теста.

- [ ] **Шаг 7: Коммит**

```bash
git add src/ drizzle/
git commit -m "M34: ссылка книги на эталон и отметка применённой версии"
```

---

## Задача 3: Полный черновик издания у модератора

Сейчас `Draft` — четыре поля, и «занести всё хорошо и красиво» физически нечем.

**Файлы:**

- Изменить: `src/services/moderation.ts` (`Draft`, `getDraft`, `saveDraft`, публикация)
- Изменить: `src/server/moderation.ts` (валидатор)
- Изменить: `src/routes/_app/service_.queue.tsx` (форма)
- Изменить: `src/services/moderation.test.ts` (тест на полный набор)

**Интерфейсы:**

- Отдаёт наружу: расширенный `Draft` с полями `pages`, `language`, `seriesName`, `annotation`, `coverUrl`.

- [ ] **Шаг 1: Расширить черновик**

В `src/services/moderation.ts` заменить:

```ts
export interface Draft {
  title: string
  authors: string
  publisher: string | null
  year: number | null
  /** Полные данные издания (M34): без них эталон остаётся куцым. */
  pages: number | null
  language: string
  seriesName: string | null
  annotation: string | null
  coverUrl: string | null
}
```

- [ ] **Шаг 2: Наполнить черновик из объекта**

В `getDraft` там, где собирается копия из книги (`item.kind === 'ai_book'`), добавить новые поля:

```ts
return {
  title: row.title,
  authors: row.authors,
  publisher: row.publisher,
  year: row.year,
  pages: row.pages,
  language: row.language,
  seriesName: null,
  annotation: row.annotation,
  coverUrl: null,
}
```

Для прочих видов (`ref_book`, `ref_work`) заполнить теми же полями из соответствующей записи; отсутствующие — `null`, язык по умолчанию `'ru'`.

- [ ] **Шаг 3: Публиковать все поля**

В месте создания записи (`insert(refBook).values({...})`, около строки 882) дописать поля и сумму:

```ts
          pages: draft.pages,
          language: draft.language,
          seriesName: draft.seriesName,
          annotation: draft.annotation,
          coverUrl: draft.coverUrl,
          checksum: refChecksum(draft),
```

Сразу после создания — связать книги и обновить сумму существующей записи:

```ts
if (created?.id) {
  const { linkBooksToReference } = await import('./reference')
  await linkBooksToReference(created.id, isbn13)
}
```

- [ ] **Шаг 4: Расширить валидатор серверной функции**

В `src/server/moderation.ts` в валидаторе `saveDraftFn` добавить:

```ts
      pages: z.number().int().min(1).max(20000).nullable().optional(),
      language: z.string().optional(),
      seriesName: z.string().nullable().optional(),
      annotation: z.string().nullable().optional(),
      coverUrl: z.string().nullable().optional(),
```

- [ ] **Шаг 5: Добавить поля в форму модератора**

В `src/routes/_app/service_.queue.tsx` в форму черновика добавить поля по макету `docs/design/reference-sync.html`, раздел «3 · Модератор заносит полные данные»: «Страниц» и «Язык» в строку, «Серия», «Аннотация» (textarea), «Обложка» (URL). Высота полей 48px, размер шрифта ≥16px — иначе iOS зумит страницу.

- [ ] **Шаг 6: Тест на полный набор**

В `src/services/moderation.test.ts` добавить:

```ts
test('в эталон уходят все поля издания, а не четыре', async () => {
  const item = await enqueueAndGet('ai_book')
  await saveDraft(ADMIN, item.id, {
    title: 'Дети-билингвы',
    authors: 'Абделила-Боэр Барбара',
    publisher: 'Дискурс',
    year: 2020,
    pages: 256,
    language: 'ru',
    seriesName: 'Наше будущее',
    annotation: 'О детях, растущих в двуязычной среде.',
    coverUrl: null,
  })
  await decide(ADMIN, item.id, 'ok', 'проверено')
  const [ref] = await db
    .select()
    .from(refBook)
    .where(eq(refBook.sourceRef, `moderated:${item.id}`))
  expect(ref?.annotation).toContain('двуязычной')
  expect(ref?.seriesName).toBe('Наше будущее')
  expect(ref?.pages).toBe(256)
  // сумма посчитана: по ней книги поймут, что эталон дополнен
  expect(ref?.checksum).toHaveLength(16)
})
```

`enqueueAndGet` — вспомогательная функция файла; если её нет, поставить объект в очередь через `enqueue` и получить `id` из `listQueue`.

- [ ] **Шаг 7: Проверить и закоммитить**

Выполнить: `bun run typecheck && bun run lint && bun test`

```bash
git add src/
git commit -m "M34: модератор заносит полное издание, а не четыре поля"
```

---

## Задача 4: Дозаполнение тоже встаёт в очередь

Сегодня в модерацию уходит только находка веб-поиска с «Не распознано». «Найти недостающее» и «Заменить данные» не ставят ничего — книга с неполными данными до модератора не доезжает.

**Файлы:**

- Изменить: `src/services/aiRecognize.ts` (`applyProposal`)
- Изменить: `src/services/aiRecognize.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

В `src/services/aiRecognize.test.ts` добавить:

```ts
test('применённое дозаполнение уходит модератору', async () => {
  const { moderationItem } = await import('@/db/schema/moderation')
  const isbn = '9785042888887'
  const created = await createBook(ME, {
    title: 'Неполная книга',
    authors: '',
    isbn13: isbn,
    libraryId: library.id,
    shelfId: shelf.id,
  })
  webFound({ title: 'Полная книга', authors: 'Автор', year: 2020 })

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
  await applyProposal(ME, proposal!.suggestionId!)

  const queued = await db
    .select()
    .from(moderationItem)
    .where(eq(moderationItem.targetId, created.id))
  expect(queued).toHaveLength(1)
})
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `bun test src/services/aiRecognize.test.ts`

Ожидается: FAIL — очередь пуста.

- [ ] **Шаг 3: Ставить в очередь**

В `applyProposal` после обновления карточки добавить:

```ts
// Данные пришли из поиска, а не от человека: их стоит проверить, и тогда
// проверенная версия достанется всем, кто держит эту книгу (M34).
if (FROM_AI(row.via)) {
  const { enqueue } = await import('./moderation')
  await enqueue('ai_book', row.bookId, userId, true)
}
```

- [ ] **Шаг 4: Проверить и закоммитить**

Выполнить: `bun run typecheck && bun test`

```bash
git add src/
git commit -m "M34: дозаполнение из поиска доезжает до модератора"
```

---

## Задача 5: Что можно обновить

**Файлы:**

- Создать: `src/services/reference/sync.ts`
- Создать: `src/services/reference/sync.test.ts`

**Интерфейсы:**

- Потребляет: `refChecksum`, `SYNCED_FIELDS` из `./checksum`; `applyDraftToBook` из `@/services/bookWriter`.
- Отдаёт наружу: `refUpdateFor(userId, bookId)` → `Promise<RefUpdate | null>`; `staleBooks(userId)` → `Promise<Array<StaleBook>>`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `src/services/reference/sync.test.ts` с проверками:

```ts
describe('что можно обновить из эталона', () => {
  test('суммы совпадают — обновлять нечего', async () => {
    const { bookId } = await bookWithReference({ synced: true })
    expect(await refUpdateFor(ME, bookId)).toBeNull()
  })

  test('эталон дополнили — видно, какие поля добавятся', async () => {
    const { bookId, refId } = await bookWithReference({ synced: true })
    await db
      .update(refBook)
      .set({
        annotation: 'Описание книги, которого раньше не было в записи.',
        checksum: 'ручная-сумма-1',
      })
      .where(eq(refBook.id, refId))
    const update = await refUpdateFor(ME, bookId)
    expect(update?.fields.map((f) => f.field)).toContain('annotation')
  })

  test('книга без ссылки на эталон обновлений не имеет', async () => {
    const bookId = await plainBook()
    expect(await refUpdateFor(ME, bookId)).toBeNull()
  })

  test('чужая книга недоступна', async () => {
    const { bookId } = await bookWithReference({ synced: false })
    await expect(refUpdateFor('stranger', bookId)).rejects.toThrow(/доступа/i)
  })

  test('сводка перечисляет только книги с расхождением', async () => {
    const list = await staleBooks(ME)
    expect(list.every((b) => b.fields.length > 0)).toBe(true)
  })

  test('«больше не напоминать» убирает книгу из напоминаний', async () => {
    const { bookId } = await bookWithReference({ synced: false })
    expect(await refUpdateFor(ME, bookId)).not.toBeNull()

    await muteRefUpdate(ME, bookId)
    expect(await refUpdateFor(ME, bookId)).toBeNull()
    expect((await staleBooks(ME)).some((b) => b.bookId === bookId)).toBe(false)
  })

  test('приглушённую книгу всё равно можно обновить руками', async () => {
    const { bookId, refId } = await bookWithReference({ synced: false })
    await muteRefUpdate(ME, bookId)
    // «Заменить данные» на карточке проходит мимо напоминаний
    await applyRefUpdate(ME, bookId, { force: true })
    const [row] = await db.select().from(book).where(eq(book.id, bookId))
    const [ref] = await db.select().from(refBook).where(eq(refBook.id, refId))
    expect(row?.refChecksum).toBe(ref?.checksum)
  })
})
```

Вспомогательные `bookWithReference` и `plainBook` создают книгу с записью эталона и без неё; `synced: true` записывает в книгу текущую сумму эталона.

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `bun test src/services/reference/sync.test.ts`

Ожидается: FAIL — `Cannot find module './sync'`.

- [ ] **Шаг 3: Написать сравнение**

Создать `src/services/reference/sync.ts`:

```ts
import { and, eq, isNotNull, ne, or, isNull } from 'drizzle-orm'

import { db } from '@/db'
import { book, refBook } from '@/db/schema/catalog'
import { AppError } from '@/services/errors'
import { memberLibraryIds } from '@/services/members'
import { SYNCED_FIELDS } from './checksum'
import type { SyncedField } from './checksum'

/**
 * Сравнение карточки с эталоном (M34).
 *
 * Признак «эталон дополнили» — расхождение контрольных сумм: у книги хранится
 * версия, которую в неё применили. Это одно сравнение вместо разбора десятка
 * полей на каждой карточке, поэтому сводка в «Чтении» считается одним
 * запросом.
 */
export interface RefField {
  field: SyncedField
  label: string
  was: string | null
  now: string
}

export interface RefUpdate {
  bookId: string
  refBookId: string
  fields: Array<RefField>
}

export interface StaleBook {
  bookId: string
  title: string
  coverPath: string | null
  /** Что добавится — короткий перечень для сводки. */
  fields: Array<string>
}

const LABEL: Record<SyncedField, string> = {
  title: 'название',
  authors: 'авторы',
  publisher: 'издательство',
  year: 'год',
  pages: 'страниц',
  language: 'язык',
  seriesName: 'серия',
  annotation: 'аннотация',
  coverUrl: 'обложка',
}

const text = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim()

/** Поля книги, соответствующие полям эталона. */
function ownValue(row: typeof book.$inferSelect, field: SyncedField): string {
  if (field === 'seriesName') return '' // серия у книги — ссылка, сверяем по эталону
  if (field === 'coverUrl') return text(row.coverPath)
  return text((row as unknown as Record<string, unknown>)[field])
}

export async function refUpdateFor(
  userId: string,
  bookId: string,
  options: { force?: boolean } = {},
): Promise<RefUpdate | null> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) throw new AppError('Книга не найдена', 'not_found')
  if (row.addedBy !== userId) {
    const libIds = await memberLibraryIds(userId)
    if (!row.libraryId || !libIds.includes(row.libraryId)) {
      throw new AppError('Нет доступа к этой книге', 'forbidden')
    }
  }
  if (!row.refBookId) return null
  // сказал «больше не напоминать» — молчим, пока сам не придёт обновляться
  if (row.refSyncMuted && !options.force) return null

  const [ref] = await db
    .select()
    .from(refBook)
    .where(eq(refBook.id, row.refBookId))
  if (!ref?.checksum || ref.checksum === row.refChecksum) return null

  const fields: Array<RefField> = []
  for (const field of SYNCED_FIELDS) {
    const now = text(ref[field])
    if (!now) continue
    const was = ownValue(row, field)
    if (was === now) continue
    fields.push({ field, label: LABEL[field], was: was || null, now })
  }
  if (fields.length === 0) return null
  return { bookId, refBookId: ref.id, fields }
}

/** Сводка для «Чтения»: книги, у которых эталон ушёл вперёд. */
export async function staleBooks(userId: string): Promise<Array<StaleBook>> {
  const libIds = await memberLibraryIds(userId)
  const rows = await db
    .select({ id: book.id })
    .from(book)
    .innerJoin(refBook, eq(refBook.id, book.refBookId))
    .where(
      and(
        or(
          libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
          eq(book.addedBy, userId),
        ),
        isNotNull(refBook.checksum),
        eq(book.refSyncMuted, false),
        or(isNull(book.refChecksum), ne(book.refChecksum, refBook.checksum)),
      ),
    )
    .limit(50)

  const out: Array<StaleBook> = []
  for (const { id } of rows) {
    const update = await refUpdateFor(userId, id)
    if (!update) continue
    const [row] = await db.select().from(book).where(eq(book.id, id))
    if (!row) continue
    out.push({
      bookId: id,
      title: row.title,
      coverPath: row.coverPath,
      fields: update.fields.map((f) => f.label),
    })
  }
  return out
}
```

Импорт `inArray` добавить из `drizzle-orm`.

- [ ] **Шаг 4: Проверить и закоммитить**

Выполнить: `bun run typecheck && bun run lint && bun test`

```bash
git add src/
git commit -m "M34: сравнение карточки с эталоном по контрольной сумме"
```

---

## Задача 6: Обновление карточки из эталона

**Файлы:**

- Изменить: `src/services/reference/sync.ts` (`applyRefUpdate`)
- Изменить: `src/services/reference/sync.test.ts`
- Изменить: `src/server/reference.ts` (серверные функции)

**Интерфейсы:**

- Потребляет: `applyDraftToBook` из `@/services/bookWriter`; `aiSuggestion` для снимка «до».
- Отдаёт наружу: `applyRefUpdate(userId, bookId)` → `Promise<{ fields: number }>`.

- [ ] **Шаг 1: Написать падающий тест**

```ts
test('обновление заменяет данные издания и запоминает версию', async () => {
  const { bookId, refId } = await bookWithReference({ synced: false })
  await applyRefUpdate(ME, bookId)
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  const [ref] = await db.select().from(refBook).where(eq(refBook.id, refId))
  expect(row?.annotation).toBe(ref?.annotation)
  // версия записана: второй раз обновлять нечего
  expect(row?.refChecksum).toBe(ref?.checksum)
  expect(await refUpdateFor(ME, bookId)).toBeNull()
})

test('личный слой не трогается', async () => {
  const { bookId } = await bookWithReference({ synced: false })
  await db.update(book).set({ shelfId: null }).where(eq(book.id, bookId))
  const before = await personalOf(bookId)
  await applyRefUpdate(ME, bookId)
  expect(await personalOf(bookId)).toEqual(before)
})

test('обновление откатывается', async () => {
  const { bookId } = await bookWithReference({ synced: false })
  const [before] = await db.select().from(book).where(eq(book.id, bookId))
  await applyRefUpdate(ME, bookId)
  await revertRecognition(ME, bookId)
  const [after] = await db.select().from(book).where(eq(book.id, bookId))
  expect(after?.title).toBe(before!.title)
})
```

- [ ] **Шаг 2: Написать обновление**

В `src/services/reference/sync.ts`:

```ts
/**
 * Обновление карточки из эталона (M34).
 *
 * Данные издания заменяются целиком — без выбора по полям: эталон проверен
 * человеком, и держать в карточке половину старого незачем. Личный слой
 * (оценка, рецензия, заметки, полка, списки) не трогается.
 *
 * Снимок «до» кладётся туда же, где его держит разбор с ИИ, поэтому работает
 * привычный «Откатить».
 */
export async function applyRefUpdate(
  userId: string,
  bookId: string,
  /** `force` — обновление руками с карточки: работает и для приглушённой книги. */
  options: { force?: boolean } = {},
): Promise<{ fields: number }> {
  const update = await refUpdateFor(userId, bookId, options)
  if (!update) return { fields: 0 }

  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  const [ref] = await db
    .select()
    .from(refBook)
    .where(eq(refBook.id, update.refBookId))
  if (!row || !ref) return { fields: 0 }

  const before = {
    title: row.title,
    authors: row.authors,
    publisher: row.publisher,
    year: row.year,
    pages: row.pages,
    annotation: row.annotation,
    seriesId: row.seriesId,
    unrecognized: row.unrecognized,
  }

  const { applyDraftToBook } = await import('@/services/bookWriter')
  await applyDraftToBook(
    bookId,
    {
      title: ref.title,
      authors: ref.authors,
      publisher: ref.publisher ?? undefined,
      year: ref.year ?? undefined,
      pages: ref.pages ?? undefined,
      language: ref.language,
      annotation: ref.annotation ?? undefined,
      seriesName: ref.seriesName ?? undefined,
    },
    { userId },
  )

  // обложку берём, только если своей нет: свою ставили руками
  if (!row.coverPath && ref.coverUrl) {
    try {
      const { saveCoverFromUrl } = await import('@/services/covers')
      const saved = await saveCoverFromUrl(bookId, ref.coverUrl)
      await db
        .update(book)
        .set({ coverPath: saved.path, coverColor: saved.color })
        .where(eq(book.id, bookId))
    } catch (error) {
      log.warn('reference', 'обложка из эталона не сохранилась', {
        bookId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  await db
    .update(book)
    .set({ refChecksum: ref.checksum })
    .where(eq(book.id, bookId))

  const { aiSuggestion } = await import('@/db/schema/moderation')
  await db.insert(aiSuggestion).values({
    bookId,
    isbn13: row.isbn13 ?? '',
    verdict: 'confirmed',
    status: 'applied',
    via: 'reference',
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(update.fields),
    appliedBy: userId,
  })
  log.info('reference', 'карточка обновлена из эталона', {
    bookId,
    fields: update.fields.map((f) => f.field).join(','),
  })
  return { fields: update.fields.length }
}
```

Импорт `log` из `@/lib/logger` добавить.

- [ ] **Шаг 3: «Больше не напоминать»**

В `src/services/reference/sync.ts`:

```ts
/**
 * «Больше не напоминать» (M34).
 *
 * Владелец решил, что его карточка его устраивает. Плашка и сводка про эту
 * книгу молчат — навсегда, а не до следующей правки эталона: напоминать об
 * одном и том же после отказа значит спорить с человеком. Обновиться он
 * по-прежнему может сам, «Заменить данные» на карточке работает как работало.
 */
export async function muteRefUpdate(
  userId: string,
  bookId: string,
): Promise<void> {
  // доступ проверяем тем же путём, что и при чтении обновления
  await refUpdateFor(userId, bookId, { force: true })
  await db.update(book).set({ refSyncMuted: true }).where(eq(book.id, bookId))
  log.info('reference', 'напоминания об эталоне отключены', { bookId })
}
```

Обновление руками снимает приглушение: человек пришёл сам, значит вопрос снова открыт. В `applyRefUpdate` в блок `.set({ refChecksum: ref.checksum })` добавить `refSyncMuted: false`.

- [ ] **Шаг 4: Серверные функции**

В `src/server/reference.ts`:

```ts
export const refUpdateForFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string(), force: z.boolean().optional() }))
  .handler(({ context, data }) =>
    refUpdateFor(context.user.id, data.bookId, { force: data.force }),
  )

export const applyRefUpdateFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string(), force: z.boolean().optional() }))
  .handler(({ context, data }) =>
    applyRefUpdate(context.user.id, data.bookId, { force: data.force }),
  )

export const muteRefUpdateFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(z.object({ bookId: z.string() }))
  .handler(({ context, data }) => muteRefUpdate(context.user.id, data.bookId))

export const staleBooksFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(({ context }) => staleBooks(context.user.id))
```

- [ ] **Шаг 5: Проверить и закоммитить**

Выполнить: `bun run typecheck && bun run lint && bun test`

```bash
git add src/
git commit -m "M34: обновление из эталона, откат и «больше не напоминать»"
```

---

## Задача 7: Плашка и шторка на карточке книги

**Файлы:**

- Изменить: `src/routes/_app/books.$bookId.tsx`

Разметку и тексты брать из макета `docs/design/reference-sync.html`, разделы «5а» и «5б».

- [ ] **Шаг 1: Загрузить состояние**

В загрузчике страницы (или отдельным запросом после монтирования) получить `refUpdateForFn({ data: { bookId } })`. Пусто — ничего не показываем.

- [ ] **Шаг 2: Плашка**

Над карточкой, стилем «штемпель» из гайдлайна (`--stamp`):

```tsx
{
  refUpdate && (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-stamp/30 bg-stamp/5 px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <b className="block text-[14.5px] font-semibold text-stamp">
          В эталоне данных больше
        </b>
        <span className="mt-0.5 block text-[13px] text-muted-foreground">
          {refUpdate.fields.map((f) => f.label).join(', ')} — проверено
          модератором
        </span>
      </div>
      <Button variant="outline" onClick={() => setRefOpen(true)}>
        Посмотреть
      </Button>
    </div>
  )
}
```

- [ ] **Шаг 3: Шторка «Обновить из эталона»**

Список полей «было → станет» без галок. Кнопки сверху вниз: «Обновить карточку» (основная), «Больше не напоминать», «Не сейчас». Текст-сноска: «Оценка, рецензия, заметки, полка и списки не меняются. Передумали — „Откатить“ в меню книги вернёт как было.»

«Больше не напоминать» зовёт `muteRefUpdateFn` и закрывает шторку: плашка и сводка про эту книгу больше не появятся. Рядом пояснение мелким: «Обновить всё равно можно — „Заменить данные“ в меню книги».

**Обязательно:** содержимое обернуть в `<div className="min-h-0 flex-1 overflow-y-auto">` — иначе при длинной аннотации до кнопок не дотянуться.

- [ ] **Шаг 4: Проверить руками**

Выполнить: `bun run dev`, открыть книгу, у которой эталон дополнен.

- [ ] **Шаг 5: Коммит**

```bash
git add src/
git commit -m "M34: на карточке видно, что эталон дополнен"
```

---

## Задача 8: Сводка «Можно дополнить» в «Чтении»

**Файлы:**

- Изменить: `src/services/reading.ts` (`ReadingHub`, `getReadingHub`)
- Изменить: `src/routes/_app/reading.tsx`
- Изменить: `src/services/reading.test.ts` (если файл есть; иначе тест в `sync.test.ts`)

- [ ] **Шаг 1: Добавить в хаб**

В `ReadingHub`:

```ts
/** Книги, у которых эталон ушёл вперёд (M34). */
stale: Array<StaleBook>
```

В `getReadingHub` — `stale: await staleBooks(userId)`.

- [ ] **Шаг 2: Секция на экране**

По макету, раздел «5в»: заголовок секции `SectionLabel` со счётчиком, строки с мини-обложкой, названием и перечнем полей, кнопка «Посмотреть» ведёт на карточку книги. Секции нет, если список пуст.

- [ ] **Шаг 3: Тест**

```ts
test('в хабе видны книги с дополненным эталоном', async () => {
  const hub = await getReadingHub(ME)
  expect(hub.stale.some((b) => b.bookId === bookId)).toBe(true)
})
```

- [ ] **Шаг 4: Проверить и закоммитить**

```bash
git add src/
git commit -m "M34: в «Чтении» видно, какие книги можно дополнить"
```

---

## Задача 9: Документация

- [ ] **Шаг 1: Согласовать правки с владельцем**

Правки в `docs/` вносить **только после явного разрешения**. Показать список: что и зачем.

- [ ] **Шаг 2: `docs/search.md`**

Раздел «Пополнение общего эталона» дополнить: контрольная сумма, связывание книг по ISBN, обновление карточки.

- [ ] **Шаг 3: `docs/architecture.md`**

В схему `ref_book` — колонка `checksum`, в `book` — `ref_checksum`. В раздел модерации — что черновик содержит полное издание.

- [ ] **Шаг 4: `docs/roadmap.md`**

Строка этапа и проверка:

> **M34** ✔ Модератор заносит полное издание, включая аннотацию и серию. У книги, сохранённой до модерации, появляется ссылка на эталон. На карточке и в «Чтении» видно, что эталон дополнили; обновление заменяет данные издания целиком и откатывается. Личный слой не меняется.

- [ ] **Шаг 5: `docs/ux-ui-guideline.md`**

Зарегистрировать макет `reference-sync.html` и паттерн «обновление из эталона — по кнопке, целиком, с откатом».

- [ ] **Шаг 6: Коммит**

```bash
git add docs/
git commit -m "docs: эталон дополняется, книги подтягиваются (M34)"
```

---

## Самопроверка плана

| Шаг сценария владельца        | Где реализован                            |
| ----------------------------- | ----------------------------------------- |
| 1. Сохранил неполное          | работает сегодня                          |
| 2. Улетело на модерацию       | задача 4                                  |
| 3. Модератор заносит всё      | задача 3                                  |
| 4. Следующий получает красоту | работает сегодня + задача 3 (полные поля) |
| 5. Уведомление и обновление   | задачи 5–8                                |

**Согласованность имён:** `refChecksum`, `SYNCED_FIELDS`, `linkBooksToReference`, `refUpdateFor`, `staleBooks`, `applyRefUpdate` — каждое объявляется в одной задаче и используется в последующих под тем же именем.

**Чего план не делает:**

- Не шлёт уведомлений по почте и не заводит колокольчик: сводка живёт в «Чтении».
- Не обновляет карточки автоматически: кнопку нажимает владелец, ошибка модератора не должна молча переписать чужие книги.
- Не заменяет свою обложку: она ставилась руками. Берём эталонную, только если своей нет.
- Не трогает книги без ISBN: им не с чем сверяться.
- Не спорит с отказом: сказавший «больше не напоминать» больше и не слышит про эту книгу — ни на карточке, ни в сводке. Путь «Заменить данные» остаётся открытым.
