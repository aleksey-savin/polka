# Единый поиск и распознавание изданий — план реализации (M32)

> **Для исполнителя-агента:** ОБЯЗАТЕЛЬНЫЙ СУБ-НАВЫК — `superpowers:subagent-driven-development` (рекомендуется) либо `superpowers:executing-plans`. Задачи выполняются по одной, шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** свести четыре независимые ветки поиска издания в одно ядро `findEdition()`, которое подчиняется настройкам источников, не роняет приложение и подробно пишет в журнал.

**Архитектура:** новая подсистема `src/services/find/`. Сеть живёт только в адаптерах источников — ядро получает их списком и не знает, куда они ходят. Состав и порядок списка приходит из «Сервис → Источники» через `resolveChain(userId)` — единственную точку, где решается, кого спрашивать (сюда же встанет будущий пейвол Нейропоиска). Глубина поиска задаётся **одним числом — бюджетом времени**: не успели до платных ступеней, значит цепочка обрывается и доигрывается фоновым воркером. Профилей источников и веток «для сканера / для карточки» не существует.

**Стек:** TypeScript 6 strict, Bun 1.3, Drizzle ORM 0.45.2 (только core-запросы), zod 4, Winston 3, `bun test`.

## Глобальные ограничения

Действуют во всех задачах без повторения.

- **Язык кода:** комментарии, сообщения об ошибках и тексты журнала — по-русски. Идентификаторы — по-английски.
- **Слои:** вся логика в `src/services/`, серверные функции в `src/server/` остаются тонкими (auth + валидация + вызов сервиса). Логику в `createServerFn` не заворачивать.
- **Импорты:** внутри `src/services/find/` — относительные (`./types`); наружу — алиасы (`@/db`, `@/lib/logger`).
- **Запуск команд:** перед любой командой `bun` в окружении должны стоять `BUN_INSTALL="$PWD/.bun"` и `BUN_TMPDIR="$PWD/.bun/tmp"`, а `$BUN_INSTALL/bin` — в `PATH`. Полная форма: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test`.
- **Проверки только через `&&`**, никогда через пайп: `bun run typecheck && bun test`. Пайп маскирует код возврата (`architecture.md`, подводный камень №7).
- **Миграции** генерируются `bun run db:generate` и **читаются глазами** перед коммитом: drizzle-kit при пересоздании таблицы пишет в `INSERT ... SELECT` колонку, которой в старой таблице нет (подводный камень №2).
- **Тесты не ходят в сеть.** Источники подставляются через параметр `options.adapters`. Проверок `process.env.NODE_ENV === 'test'` в боевом коде быть не должно — они снимаются в задаче 8.
- **Уровни журнала:** `info` — ход дела (начали, ступень ответила, отдали результат); `warn` — ступень не справилась, но поиск продолжается; `error` — сломалось то, что ломаться не должно (упало ядро, упал воркер, не записался кэш). Scope у всей подсистемы один — `find`.
- **Коммит после каждой задачи**, сообщение по-русски в стиле репозитория («M32: …»).

---

## Карта файлов

Новое — подсистема `src/services/find/`:

| Файл          | Ответственность                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `types.ts`    | Типы подсистемы: `SourceKey`, `SourceAdapter`, `Finding`, `FindResult`, `FindOptions`, `FindContext`. Логики нет |
| `trace.ts`    | Журнал одного поиска: корреляционный id, уровни, замер времени                                                   |
| `budget.ts`   | Бюджет времени на цепочку: `deadline(ms)`                                                                        |
| `safely.ts`   | Обёртка «поймать всё и записать»: одна ступень не роняет цепочку                                                 |
| `adapters.ts` | Адаптеры над существующими клиентами — единственное место, где живёт сеть                                        |
| `chain.ts`    | `resolveChain(userId)` — состав и порядок из настроек. Точка будущего пейвола                                    |
| `merge.ts`    | Слияние находок: приоритет полей = порядок цепочки                                                               |
| `cache.ts`    | Кэш, привязанный к отпечатку настроек                                                                            |
| `enrich.ts`   | Добор обложки, аннотации и объёма — по той же цепочке                                                            |
| `core.ts`     | `findEdition()` — сборка всего перечисленного                                                                    |
| `queue.ts`    | Фоновая доигровка оборванной по бюджету цепочки                                                                  |

Правится существующее:

| Файл                                                                                           | Что меняется                                                   |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/services/bookSources.ts`                                                                  | Из `SourceKey` уходит мёртвый `'model'`                        |
| `src/services/metadata/lookup.ts`                                                              | `lookupIsbn` становится тонкой обёрткой над ядром              |
| `src/services/metadata/merge.ts`                                                               | Зашитые `BIB_ORDER` / `ANNOTATION_ORDER` удаляются             |
| `src/services/reference.ts`                                                                    | Зашитый `SOURCE_PRIORITY` заменяется порядком цепочки          |
| `src/services/aiRecognize.ts`                                                                  | `recognizeIsbn` и `proposeForBook` переезжают на ядро          |
| `src/services/unrecognized.ts`                                                                 | `retryLookup` переезжает на ядро и на общего писателя карточки |
| `src/services/bookWriter.ts` (новый)                                                           | Единственное место, которое пишет найденное в карточку         |
| `src/services/metadata/{googleBooks,fantlab,openLibrary}.ts`                                   | Снимаются `NODE_ENV === 'test'`                                |
| `src/services/titleSearch.ts`                                                                  | FantLab спрашивается только если включён                       |
| `src/services/covers.ts`                                                                       | `searchCoversForBook` идёт через цепочку                       |
| `src/db/schema/catalog.ts`                                                                     | Новая таблица `find_task`, колонка `chain` у `lookup_cache`    |
| `src/db/schema/moderation.ts`                                                                  | Колонка `chain` у `ai_isbn_guess`                              |
| `src/routes/_app/add.tsx`                                                                      | Выбор режима сканирования, отчёт по источникам                 |
| `docs/architecture.md`, `docs/roadmap.md`, `docs/ux-ui-guideline.md`, `docs/search.md` (новый) | Документация                                                   |

---

## Задача 1: Типы, журнал поиска и бюджет времени

Фундамент: три файла без внешних зависимостей, на которые опирается всё остальное.

**Файлы:**

- Создать: `src/services/find/types.ts`
- Создать: `src/services/find/trace.ts`
- Создать: `src/services/find/budget.ts`
- Создать: `src/services/find/budget.test.ts`

**Интерфейсы:**

- Отдаёт наружу: `SourceKey`, `SourceAdapter`, `Finding`, `SourceProbe`, `FindResult`, `FindOptions`, `FindContext`, `Trace`, `startTrace()`, `Deadline`, `deadline()`.
- Потребляет: `MetadataDraft` из `@/services/metadata/types`, `log` из `@/lib/logger`.

- [ ] **Шаг 1: Написать типы подсистемы**

Создать `src/services/find/types.ts`:

```ts
import type { MetadataDraft } from '@/services/metadata/types'
import type { Trace } from './trace'

/**
 * Единый поиск издания (M32).
 *
 * Одна цепочка на все входы: добавление по ISBN, «Не распознано», карточка
 * книги, фоновая доигровка. Состав и порядок ступеней приходят из настроек
 * источников — зашитого порядка в коде нет.
 */

/** Ключ ступени. Совпадает со значением `book_source.key`. */
export type SourceKey =
  'reference' | 'fantlab' | 'google' | 'openlibrary' | 'web' | 'neuro'

/** Что ответила ступень: показывается человеку и ложится в журнал. */
export interface SourceProbe {
  key: SourceKey
  outcome: 'нашёл' | 'молчит' | 'ошибка' | 'выключен' | 'не успели'
  /** Подробность для человека: адрес страницы, текст отказа сервиса. */
  detail: string | null
  ms: number
}

/** Находка одной ступени. Их листают стрелками, поэтому храним раздельно. */
export interface Finding {
  key: SourceKey
  /**
   * Ключ варианта: `fantlab` у каталогов, `web#1`…`web#3` у Яндекс Поиска —
   * одна ступень может дать несколько находок с разных страниц.
   */
  variantKey: string
  draft: MetadataDraft
  /** Страница, на которой встретился номер (веб-ступени). */
  proof: { url: string; title: string } | null
  /** Издание эталона, если ступень его подтвердила. */
  refBookId: string | null
  workId: string | null
  /** Кандидаты обложек: первым — самый надёжный. */
  covers: Array<string>
  /**
   * Ответ формально есть, но негодный — держим про запас.
   *
   * Обычный случай: Google хранит русское издание латиницей («Deti-bilingvy»),
   * без издательства и аннотации. Карточка получается нечитаемой, поэтому
   * такая находка уступает любой нормальной, но лучше пустоты.
   */
  weak: boolean
}

export interface FindResult {
  isbn13: string
  isbn10: string | null
  /** Слитый черновик: каждое поле от старшей ступени, которая его дала. */
  draft: MetadataDraft
  /** Кто ответил, в порядке цепочки. */
  found: Array<SourceKey>
  /** Отчёт по каждой ступени — иначе «не нашлось» неотличимо от поломки. */
  probes: Array<SourceProbe>
  /** Находки по отдельности. */
  findings: Array<Finding>
  proof: { url: string; title: string } | null
  refBookId: string | null
  workId: string | null
  /** Кандидаты обложек по всем ступеням, без повторов. */
  covers: Array<string>
  /** Отдано из кэша — сеть не трогали. */
  cached: boolean
  /** Бюджет кончился раньше цепочки: есть что доиграть фоном. */
  truncated: boolean
  /** Идти больше некуда: все ступени опрошены или отвергнуты. */
  exhausted: boolean
}

export interface FindOptions {
  /**
   * Бюджет на всю цепочку в миллисекундах. Ступень не начинается, если
   * времени на неё заведомо не хватит. По умолчанию — `FULL_BUDGET_MS`.
   */
  budgetMs?: number
  /** Забыть кэш и список отвергнутых путей. */
  force?: boolean
  /** Ступени, которые человек уже отверг кнопкой «Искать дальше». */
  rejected?: Array<SourceKey>
  /** Подмена источников в тестах. В бою не передаётся. */
  adapters?: Partial<Record<SourceKey, SourceAdapter>>
}

/** Быстрый режим сканирования: успевают только бесплатные каталоги. */
export const QUICK_BUDGET_MS = 5_000
/** Полный режим: цепочка целиком, включая веб-поиск и чтение страниц. */
export const FULL_BUDGET_MS = 45_000

export interface FindContext {
  userId: string
  isbn13: string
  /** Что нашли предыдущие ступени: веб-ступени этим пользуются. */
  soFar: Array<Finding>
  trace: Trace
  /** Сколько миллисекунд осталось у всей цепочки. */
  leftMs: () => number
}

/** Сколько вариантов берём с одной ступени: больше человек не пролистает. */
export const MAX_VARIANTS_PER_STEP = 3

/**
 * Источник как функция. Сеть живёт только здесь: ядро получает список
 * адаптеров и не знает, куда они ходят, — поэтому в тестах подставляются
 * поддельные, и поведение при отказе источника наконец проверяемо.
 */
export interface SourceAdapter {
  key: SourceKey
  /** Платный — считается по суточному лимиту и прячется за пейволом. */
  paid: boolean
  /** Сколько эта ступень может занять: ядро не начнёт её без запаса. */
  timeoutMs: number
  /**
   * Спросить издание по номеру. Пустой список — источник промолчал.
   *
   * Список, а не одна находка: Яндекс Поиск возвращает до десяти страниц с
   * разными изданиями, и запирать их в один вариант — терять работу, за
   * которую уже заплачено. Каталоги отдают ровно одну находку.
   */
  probe(ctx: FindContext): Promise<Array<Finding>>
  /**
   * Добор недостающего (обложка, аннотация, объём) по названию и автору.
   * Есть не у каждой ступени.
   */
  enrich?(
    ctx: FindContext,
    draft: MetadataDraft,
  ): Promise<{ draft: Partial<MetadataDraft>; covers: Array<string> }>
}
```

- [ ] **Шаг 2: Написать журнал одного поиска**

Создать `src/services/find/trace.ts`:

```ts
import { log } from '@/lib/logger'

/**
 * Журнал одного поиска.
 *
 * У всей подсистемы один scope — `find`, и общий короткий id: несколько
 * поисков идут параллельно, и без него строки в журнале не разделить.
 * Уровни: info — ход дела, warn — ступень не справилась (поиск продолжается),
 * error — сломалось то, что ломаться не должно.
 */
export interface Trace {
  id: string
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
  /** Сколько миллисекунд идёт этот поиск. */
  ms(): number
}

export function startTrace(isbn13: string, userId: string): Trace {
  const id = Math.random().toString(36).slice(2, 8)
  const started = performance.now()
  const base = { find: id, isbn: isbn13, user: userId }
  const ms = () => Math.round(performance.now() - started)
  return {
    id,
    ms,
    info: (message, fields) =>
      log.info('find', message, { ...base, ...fields }),
    warn: (message, fields) =>
      log.warn('find', message, { ...base, ...fields }),
    error: (message, fields) =>
      log.error('find', message, { ...base, ...fields }),
  }
}
```

- [ ] **Шаг 3: Написать падающий тест бюджета**

Создать `src/services/find/budget.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { deadline } from './budget'

describe('бюджет времени', () => {
  test('свежий бюджет не истёк и отдаёт остаток', () => {
    const d = deadline(1000)
    expect(d.expired()).toBe(false)
    expect(d.left()).toBeGreaterThan(900)
    expect(d.left()).toBeLessThanOrEqual(1000)
  })

  test('нулевой бюджет истёк сразу', () => {
    const d = deadline(0)
    expect(d.expired()).toBe(true)
    expect(d.left()).toBe(0)
  })

  test('хватает ли времени на ступень — с запасом на саму проверку', () => {
    const d = deadline(1000)
    expect(d.enoughFor(500)).toBe(true)
    expect(d.enoughFor(5000)).toBe(false)
  })

  test('остаток не уходит в минус', async () => {
    const d = deadline(30)
    await new Promise((r) => setTimeout(r, 60))
    expect(d.left()).toBe(0)
    expect(d.expired()).toBe(true)
  })
})
```

- [ ] **Шаг 4: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/find/budget.test.ts`

Ожидается: FAIL — `Cannot find module './budget'`.

- [ ] **Шаг 5: Написать бюджет**

Создать `src/services/find/budget.ts`:

```ts
/**
 * Бюджет времени на всю цепочку поиска.
 *
 * Глубина задаётся одним числом, а не списком разрешённых источников: при
 * маленьком бюджете цепочка сама останавливается после бесплатных каталогов,
 * и никаких «профилей» и исключений заводить не нужно. Заодно это лечит
 * разнобой таймаутов (4 / 6 / 7 / 12 / 15 / 30 с), из-за которого один поиск
 * мог тянуться дольше минуты.
 */
export interface Deadline {
  /** Осталось миллисекунд; 0 — время вышло. */
  left(): number
  expired(): boolean
  /** Хватит ли остатка на ступень, которая может занять `needMs`. */
  enoughFor(needMs: number): boolean
  /** Сколько миллисекунд уже потрачено. */
  spent(): number
}

export function deadline(budgetMs: number): Deadline {
  const started = performance.now()
  const spent = () => Math.round(performance.now() - started)
  const left = () => Math.max(0, budgetMs - spent())
  return {
    spent,
    left,
    expired: () => left() <= 0,
    // ступень с длинным таймаутом не начинаем, если она заведомо не успеет:
    // лучше честно сказать «не успели», чем оборвать её на середине
    enoughFor: (needMs) => left() >= needMs,
  }
}
```

- [ ] **Шаг 6: Убедиться, что тест проходит**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test src/services/find/budget.test.ts`

Ожидается: PASS, 4 теста.

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/find/
git commit -m "M32: каркас единого поиска — типы, журнал, бюджет времени"
```

---

## Задача 2: Устойчивость — ни одна ступень не роняет цепочку

Требование 3 целиком: любая ошибка ловится, записывается и превращается в «эта ступень промолчала».

**Файлы:**

- Создать: `src/services/find/safely.ts`
- Создать: `src/services/find/safely.test.ts`

**Интерфейсы:**

- Потребляет: `Trace` из `./trace`.
- Отдаёт наружу: `safely<T>(what, trace, run, timeoutMs?)` → `Promise<{ value: T | null; failure: string | null; ms: number }>`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `src/services/find/safely.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { safely } from './safely'
import { startTrace } from './trace'

const trace = startTrace('9785000000000', 'tester')

describe('safely', () => {
  test('удачный вызов отдаёт значение и не жалуется', async () => {
    const r = await safely('проба', trace, async () => 42)
    expect(r.value).toBe(42)
    expect(r.failure).toBeNull()
  })

  test('брошенная ошибка не выходит наружу', async () => {
    const r = await safely('проба', trace, async () => {
      throw new Error('источник лёг')
    })
    expect(r.value).toBeNull()
    expect(r.failure).toBe('источник лёг')
  })

  test('брошенная не-ошибка тоже переживается', async () => {
    const r = await safely('проба', trace, async () => {
      throw 'строка вместо ошибки'
    })
    expect(r.value).toBeNull()
    expect(r.failure).toBe('строка вместо ошибки')
  })

  test('зависший вызов обрывается по таймауту', async () => {
    const r = await safely(
      'проба',
      trace,
      () => new Promise((resolve) => setTimeout(() => resolve('поздно'), 500)),
      50,
    )
    expect(r.value).toBeNull()
    expect(r.failure).toMatch(/не уложил/i)
  })

  test('время работы измеряется', async () => {
    const r = await safely('проба', trace, async () => {
      await new Promise((res) => setTimeout(res, 30))
      return 'ok'
    })
    expect(r.ms).toBeGreaterThanOrEqual(25)
  })
})
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/find/safely.test.ts`

Ожидается: FAIL — `Cannot find module './safely'`.

- [ ] **Шаг 3: Написать обёртку**

Создать `src/services/find/safely.ts`:

```ts
import type { Trace } from './trace'

/**
 * «Поймать всё и записать».
 *
 * Правило подсистемы: ни одна ступень не имеет права уронить поиск. Раньше
 * `recognizeIsbn` падал целиком, если модель ответила 401 или каталог бросил
 * ошибку, — хотя предыдущие ступени уже что-то нашли. Здесь любой отказ
 * становится «источник промолчал», и в журнале остаётся warn с причиной.
 *
 * Глухих `catch {}` в подсистеме быть не должно: причина всегда записывается.
 */
export interface SafeResult<T> {
  value: T | null
  /** Текст отказа для отчёта человеку; null — всё прошло. */
  failure: string | null
  ms: number
}

export async function safely<T>(
  what: string,
  trace: Trace,
  run: () => Promise<T>,
  timeoutMs?: number,
): Promise<SafeResult<T>> {
  const started = performance.now()
  const ms = () => Math.round(performance.now() - started)
  try {
    const value =
      timeoutMs === undefined
        ? await run()
        : await withTimeout(run(), timeoutMs)
    return { value, failure: null, ms: ms() }
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error)
    trace.warn(`${what}: не справился`, { failure, ms: ms() })
    return { value: null, failure, ms: ms() }
  }
}

/** Свой таймаут поверх ступени: у чужих клиентов он бывает щедрее нашего. */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`не уложился в ${timeoutMs} мс`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
```

- [ ] **Шаг 4: Убедиться, что тест проходит**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test src/services/find/safely.test.ts`

Ожидается: PASS, 5 тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add src/services/find/safely.ts src/services/find/safely.test.ts
git commit -m "M32: отказ ступени не роняет поиск"
```

---

## Задача 3: Цепочка из настроек

Требование 2, первая половина: кого спрашивать и в каком порядке — решает `resolveChain(userId)`, и больше никто. Здесь же снимается мёртвый ключ `'model'` и закладывается точка пейвола.

**Файлы:**

- Создать: `src/services/find/chain.ts`
- Создать: `src/services/find/chain.test.ts`
- Изменить: `src/services/bookSources.ts:15-16` (тип `SourceKey`)

**Интерфейсы:**

- Потребляет: `sourceStates()` из `@/services/bookSources`; типы из `./types`.
- Отдаёт наружу: `resolveChain(userId, registry?)` → `Promise<ChainStep[]>`, где `ChainStep = { adapter: SourceAdapter; enabled: boolean; reason: string | null }`.

- [ ] **Шаг 1: Убрать мёртвый ключ `'model'`**

В `src/services/bookSources.ts` заменить объявление типа (строки 15–16):

```ts
export type SourceKey =
  'reference' | 'fantlab' | 'google' | 'openlibrary' | 'web' | 'neuro' | 'model'
```

на реэкспорт из подсистемы — единственное определение:

```ts
export type { SourceKey } from './find/types'
```

и добавить рядом импорт для внутреннего использования:

```ts
import type { SourceKey } from './find/types'
```

Ступени «спросить модель по памяти» нет с M30.1, а ключ в типе остался и вводил в заблуждение.

- [ ] **Шаг 2: Написать падающий тест цепочки**

Создать `src/services/find/chain.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-chain-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-chain'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { bookSource, userAccount } = await import('@/db/schema/moderation')
const { resolveChain } = await import('./chain')
const { setEnabled, moveSource } = await import('@/services/bookSources')
import type { SourceAdapter, SourceKey } from './types'

const ME = 'chain-admin'
await db.insert(user).values({
  id: ME,
  name: 'Админ',
  email: 'chain@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
await db.insert(userAccount).values({ userId: ME, role: 'admin' })

/** Пустышка: цепочку проверяем по составу и порядку, не по походам в сеть. */
const stub = (key: SourceKey, paid = false): SourceAdapter => ({
  key,
  paid,
  timeoutMs: 100,
  probe: async () => [],
})

const REGISTRY: Record<SourceKey, SourceAdapter> = {
  reference: stub('reference'),
  fantlab: stub('fantlab'),
  google: stub('google'),
  openlibrary: stub('openlibrary'),
  web: stub('web', true),
  neuro: stub('neuro', true),
}

const keysOf = async () =>
  (await resolveChain(ME, REGISTRY))
    .filter((step) => step.enabled)
    .map((step) => step.adapter.key)

beforeEach(async () => {
  await db.delete(bookSource)
})

describe('цепочка из настроек', () => {
  test('по умолчанию всё, кроме Нейропоиска', async () => {
    expect(await keysOf()).toEqual([
      'reference',
      'fantlab',
      'google',
      'openlibrary',
      'web',
    ])
  })

  test('выключенный источник в цепочку не попадает', async () => {
    await setEnabled(ME, 'google', false)
    expect(await keysOf()).not.toContain('google')
  })

  test('выключенный источник отмечен причиной, а не выброшен молча', async () => {
    await setEnabled(ME, 'google', false)
    const chain = await resolveChain(ME, REGISTRY)
    const google = chain.find((step) => step.adapter.key === 'google')
    expect(google?.enabled).toBe(false)
    expect(google?.reason).toMatch(/выключен/i)
  })

  test('перестановка меняет порядок цепочки', async () => {
    await moveSource(ME, 'google', 'up')
    const keys = await keysOf()
    expect(keys.indexOf('google')).toBeLessThan(keys.indexOf('fantlab'))
  })

  test('эталон всегда первый и не выключается', async () => {
    await setEnabled(ME, 'reference', false)
    const keys = await keysOf()
    expect(keys[0]).toBe('reference')
  })
})
```

- [ ] **Шаг 3: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/find/chain.test.ts`

Ожидается: FAIL — `Cannot find module './chain'`.

- [ ] **Шаг 4: Написать резолвер цепочки**

Создать `src/services/find/chain.ts`:

```ts
import { sourceStates } from '@/services/bookSources'
import { ADAPTERS } from './adapters'
import type { SourceAdapter, SourceKey } from './types'

/**
 * Состав и порядок цепочки поиска (M32).
 *
 * Единственное место, где решается «спрашивать ли этот источник». Раньше
 * решение было размазано: `lookupIsbn` смотрел настройки, `enrichMissing` и
 * `proposeForBook` ходили в Google всегда, `searchByTitle` — в FantLab всегда,
 * Яндекс Картинки дёргались мимо суточного лимита.
 *
 * `userId` в сигнатуре — на будущее: если платные ступени когда-нибудь станут
 * доступны не всем, отказ добавится здесь, а не в самой цепочке.
 */
export interface ChainStep {
  adapter: SourceAdapter
  /** Спрашивать ли. Выключенные остаются в списке ради честного отчёта. */
  enabled: boolean
  /** Почему не спрашиваем: показывается человеку и пишется в журнал. */
  reason: string | null
}

export async function resolveChain(
  userId: string,
  registry: Partial<Record<SourceKey, SourceAdapter>> = ADAPTERS,
): Promise<Array<ChainStep>> {
  const states = await sourceStates()
  const steps: Array<ChainStep> = []

  for (const state of states) {
    const adapter = registry[state.key]
    // ключ есть в базе, а адаптера нет — источник выведен из строя кодом
    if (!adapter) continue

    // эталон закреплён первым и не выключается: бесплатный, мгновенный и свой
    if (state.key === 'reference') {
      steps.push({ adapter, enabled: true, reason: null })
      continue
    }
    if (!state.enabled) {
      steps.push({
        adapter,
        enabled: false,
        reason: 'выключен в настройках источников',
      })
      continue
    }
    steps.push({ adapter, enabled: true, reason: null })
  }

  // эталон всегда первый, как бы ни переставили список
  steps.sort((a, b) =>
    a.adapter.key === 'reference' ? -1 : b.adapter.key === 'reference' ? 1 : 0,
  )
  return steps
}
```

- [ ] **Шаг 5: Завести пустой реестр адаптеров**

Чтобы задача была самодостаточной, создать заглушку `src/services/find/adapters.ts` — в задаче 4 она наполнится:

```ts
import type { SourceAdapter, SourceKey } from './types'

/** Реальные источники. Единственное место подсистемы, где живёт сеть. */
export const ADAPTERS: Partial<Record<SourceKey, SourceAdapter>> = {}
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test`

Ожидается: PASS — 5 новых тестов цепочки, прежние 162 не сломаны.

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/find/ src/services/bookSources.ts
git commit -m "M32: состав и порядок цепочки — только из настроек"
```

---

## Задача 4: Адаптеры источников

Сеть переезжает за границу ядра. Адаптеры — тонкие обёртки над уже существующими и проверенными клиентами; логику разбора ответов не трогаем.

**Файлы:**

- Создать: `src/services/find/clean.ts`
- Изменить: `src/services/find/adapters.ts` (заглушка из задачи 3 наполняется)
- Создать: `src/services/find/adapters.test.ts`
- Изменить: `src/services/aiRecognize.ts` (чистилки уезжают, остаётся реэкспорт)

**Интерфейсы:**

- Потребляет: `refLookup` из `@/services/reference`; `fetchFantlab`, `fetchGoogleBooks`, `fetchGoogleByTitle`, `fetchOpenLibrary` из `@/services/metadata/*`; `searchWeb`, `genSearch`, `spendSearch`, `mentionsIsbn`, `fetchOpenGraph`, `searchCoverImages` из `@/services/webSearch`; `ask` из `@/services/ai`; `bestRefBookIdForIsbn` из `@/services/reference`.
- Отдаёт наружу: `ADAPTERS: Partial<Record<SourceKey, SourceAdapter>>`, `WEB_SYSTEM`, `parseGuessDrafts(text)`.

- [ ] **Шаг 1: Написать падающий тест разбора ответа модели**

Создать `src/services/find/adapters.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { ADAPTERS, parseGuessDrafts } from './adapters'

describe('реестр адаптеров', () => {
  test('в реестре все шесть ступеней', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual([
      'fantlab',
      'google',
      'neuro',
      'openlibrary',
      'reference',
      'web',
    ])
  })

  test('платными помечены только веб-ступени', () => {
    const paid = Object.values(ADAPTERS)
      .filter((a) => a?.paid)
      .map((a) => a?.key)
      .sort()
    expect(paid).toEqual(['neuro', 'web'])
  })

  test('у каждой ступени есть таймаут', () => {
    for (const adapter of Object.values(ADAPTERS)) {
      expect(adapter?.timeoutMs).toBeGreaterThan(0)
    }
  })
})

describe('разбор ответа модели', () => {
  test('массив по книге на страницу', () => {
    const found = parseGuessDrafts(
      '[{"known":true,"title":"Зона","authors":"Довлатов","year":1982,"sourceUrl":"https://a.ru"},' +
        '{"known":true,"title":"Зона","year":2001,"sourceUrl":"https://b.ru"}]',
    )
    expect(found).toHaveLength(2)
    expect(found[0]?.draft.title).toBe('Зона')
    expect(found[0]?.sourceUrl).toBe('https://a.ru')
    expect(found[1]?.draft.year).toBe(2001)
  })

  test('одиночный объект тоже принимаем', () => {
    const found = parseGuessDrafts(
      'Вот что нашлось: {"known":true,"title":"Зона","authors":"Довлатов"} — всё.',
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.draft.authors).toBe('Довлатов')
  })

  test('known:false отсеивается, остальное остаётся', () => {
    const found = parseGuessDrafts(
      '[{"known":false},{"known":true,"title":"Зона","sourceUrl":"https://a.ru"}]',
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.draft.title).toBe('Зона')
  })

  test('мусор вместо JSON — находок нет', () => {
    expect(parseGuessDrafts('не знаю такой книги')).toEqual([])
  })

  test('пустой массив — находок нет', () => {
    expect(parseGuessDrafts('[]')).toEqual([])
  })

  test('несуразный год отбрасывается', () => {
    const found = parseGuessDrafts('[{"known":true,"title":"Зона","year":99}]')
    expect(found[0]?.draft.year).toBeUndefined()
  })

  test('без sourceUrl вариант остаётся, ссылку проверит адаптер', () => {
    const found = parseGuessDrafts('[{"known":true,"title":"Зона"}]')
    expect(found[0]?.sourceUrl).toBeNull()
  })
})
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/find/adapters.test.ts`

Ожидается: FAIL — `parseGuessDrafts is not a function`, состав реестра пуст.

- [ ] **Шаг 3: Вынести чистилки текста в отдельный модуль**

`adapters.ts` нужны `cleanFoundTitle`, `cleanPublisher`, `cleanAnnotation` — сейчас они живут в `aiRecognize.ts`, который сам будет звать ядро. Импорт оттуда замкнул бы кольцо `adapters → aiRecognize → core → chain → adapters`, а такое кольцо в ESM ломается молча и не в момент сборки.

Создать `src/services/find/clean.ts` и **перенести** в него без изменений из `src/services/aiRecognize.ts`: `cleanFoundTitle`, `cleanPublisher`, константу `SHOP_NOISE`, `cleanAnnotation` (строки 119–194) и `looksTransliterated` вместе с константой `CYRILLIC` (строки 379–396). Единственный импорт модуля — `isCyrillicRegion` из `@/services/isbnPrefix`.

В `src/services/aiRecognize.ts` на их месте оставить реэкспорт — на эти функции есть тесты в `aiRecognize.test.ts`, и ломать их незачем:

```ts
// чистилки живут в подсистеме поиска: ими пользуются и адаптеры источников
export {
  cleanAnnotation,
  cleanFoundTitle,
  cleanPublisher,
  looksTransliterated,
} from './find/clean'
```

- [ ] **Шаг 4: Написать адаптеры**

Заменить содержимое `src/services/find/adapters.ts`:

````ts
import { ask } from '@/services/ai'
import {
  cleanAnnotation,
  cleanFoundTitle,
  cleanPublisher,
  looksTransliterated,
} from './clean'
import { fetchFantlab } from '@/services/metadata/fantlab'
import {
  fetchGoogleBooks,
  fetchGoogleByTitle,
} from '@/services/metadata/googleBooks'
import { fetchOpenLibrary } from '@/services/metadata/openLibrary'
import { bestRefBookIdForIsbn, refLookup } from '@/services/reference'
import {
  fetchOpenGraph,
  genSearch,
  mentionsIsbn,
  searchCoverImages,
  searchWeb,
  spendSearch,
} from '@/services/webSearch'
import type { MetadataDraft, SourceResult } from '@/services/metadata/types'
import type { Finding, FindContext, SourceAdapter, SourceKey } from './types'

/**
 * Источники как функции — единственное место подсистемы, где живёт сеть.
 *
 * Разбор ответов не переписан: он проверен фикстурами в `metadata.test.ts` и
 * живёт там же, где жил. Здесь только приведение к общему виду `Finding`.
 */

const finding = (
  key: SourceKey,
  draft: MetadataDraft,
  isbn13: string,
  extra: Partial<Finding> = {},
): Finding => ({
  key,
  variantKey: key,
  draft,
  proof: null,
  refBookId: null,
  workId: null,
  covers: draft.coverUrl ? [draft.coverUrl] : [],
  // латиница у русского издания — обычная беда каталогов: находка остаётся
  // запасной, а цепочка идёт дальше за живой страницей на русском
  weak: looksTransliterated(isbn13, draft.title, draft.authors),
  ...extra,
})

/** Одна находка или пусто — каталоги отвечают именно так. */
const one = (found: Finding | null): Array<Finding> => (found ? [found] : [])

/** Первый непустой черновик из набора результатов источника. */
const firstDraft = (
  results: Array<SourceResult> | null,
): MetadataDraft | null => results?.find((r) => r.draft.title)?.draft ?? null

const reference: SourceAdapter = {
  key: 'reference',
  paid: false,
  timeoutMs: 2_000,
  probe: async (ctx) => {
    const draft = firstDraft(await refLookup(ctx.isbn13))
    if (!draft) return []
    return one(
      finding('reference', draft, ctx.isbn13, {
        refBookId: await bestRefBookIdForIsbn(ctx.isbn13),
        // в эталоне латиница — осознанное решение модератора, а не транслит
        weak: false,
      }),
    )
  },
}

const fantlab: SourceAdapter = {
  key: 'fantlab',
  paid: false,
  timeoutMs: 6_000,
  probe: async (ctx) => {
    const result = await fetchFantlab(ctx.isbn13)
    return one(
      result?.draft.title ? finding('fantlab', result.draft, ctx.isbn13) : null,
    )
  },
}

const google: SourceAdapter = {
  key: 'google',
  paid: false,
  timeoutMs: 6_000,
  probe: async (ctx) => {
    const result = await fetchGoogleBooks(ctx.isbn13)
    return one(
      result?.draft.title ? finding('google', result.draft, ctx.isbn13) : null,
    )
  },
  // Google знает обложки и аннотации почти для всего — им и добираем
  enrich: async (_ctx, draft) => {
    if (!draft.title) return { draft: {}, covers: [] }
    const found = await fetchGoogleByTitle(draft.title, draft.authors ?? null)
    if (!found) return { draft: {}, covers: [] }
    return {
      draft: {
        annotation: found.annotation,
        pages: found.pages,
      },
      covers: found.coverUrl ? [found.coverUrl] : [],
    }
  },
}

const openlibrary: SourceAdapter = {
  key: 'openlibrary',
  paid: false,
  timeoutMs: 5_000,
  probe: async (ctx) => {
    const result = await fetchOpenLibrary(ctx.isbn13)
    return one(
      result?.draft.title
        ? finding('openlibrary', result.draft, ctx.isbn13)
        : null,
    )
  },
}

export const WEB_SYSTEM = [
  'Ты читаешь фрагменты веб-страниц и выписываешь выходные данные книги.',
  'Отвечай строго JSON-массивом, без пояснений: по одному объекту на каждую страницу, где книга нашлась.',
  'Поля объекта: known (boolean), sourceUrl (адрес той самой страницы), title, authors, publisher, year (число), pages (число), series, annotation.',
  'sourceUrl обязателен и должен точно совпадать с адресом страницы из входных данных.',
  'Не объединяй данные разных страниц в один объект: у разных магазинов бывают разные издания одной книги.',
  'annotation — описание книги из фрагментов (о чём она), без слов про магазин, цену и доставку; если описания нет, верни null.',
  'Бери только то, что есть во фрагментах.',
  'Если книги с этим ISBN нет ни на одной странице — верни пустой массив.',
].join(' ')

/**
 * Черновики из ответа модели: модели любят обрамлять JSON текстом и ```.
 *
 * Ответ ждём массивом — по книге на страницу. Одиночный объект тоже
 * принимаем: модели периодически возвращают его вместо массива из одного
 * элемента, и ронять из-за этого находку глупо.
 */
export function parseGuessDrafts(
  text: string,
): Array<{ draft: MetadataDraft; sourceUrl: string | null }> {
  const start = text.search(/[[{]/)
  if (start < 0) return []
  const opener = text[start]
  const end = text.lastIndexOf(opener === '[' ? ']' : '}')
  if (end <= start) return []
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  const items = Array.isArray(raw) ? raw : [raw]
  return items
    .map((item) => parseOneGuess(item))
    .filter(
      (v): v is { draft: MetadataDraft; sourceUrl: string | null } =>
        v !== null,
    )
}

function parseOneGuess(
  raw: unknown,
): { draft: MetadataDraft; sourceUrl: string | null } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const str = (v: unknown): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s.length > 0 ? s : undefined
  }
  const rawTitle = str(o.title)
  const title = rawTitle ? cleanFoundTitle(rawTitle) || undefined : undefined
  if (o.known !== true || !title) return null

  const draft: MetadataDraft = { title }
  const authors = str(o.authors)
  if (authors) draft.authors = authors
  const publisher = cleanPublisher(str(o.publisher) ?? null)
  if (publisher) draft.publisher = publisher
  const year = Number(o.year)
  if (Number.isFinite(year) && year > 1400 && year < 2100) draft.year = year
  const pages = Number(o.pages)
  if (Number.isFinite(pages) && pages > 0) draft.pages = pages
  const series = str(o.series) ?? str(o.seriesName)
  if (series) draft.seriesName = series
  const annotation = cleanAnnotation(str(o.annotation) ?? null)
  if (annotation) draft.annotation = annotation
  return { draft, sourceUrl: str(o.sourceUrl) ?? null }
}

/** Страница-кандидат: у каждой находки будет своя ссылка-доказательство. */
interface WebPage {
  url: string
  title: string
  text: string
}

/**
 * Общая часть веб-ступеней: найти страницы, проверить, что на них есть наш
 * номер, и попросить модель выписать данные. Правило приёмки прежнее (M26):
 * без номера в тексте страницы результат не берётся вовсе.
 *
 * Отдаёт **несколько** находок — по одной на страницу. Поиск оплачен один раз,
 * и запирать десяток найденных изданий в единственный вариант незачем: человек
 * листает их стрелками бесплатно.
 */
async function readFromWeb(
  ctx: FindContext,
  key: 'web' | 'neuro',
  collect: () => Promise<Array<WebPage>>,
): Promise<Array<Finding>> {
  const box: { pages: Array<WebPage> } = { pages: [] }
  // расход считается всегда, когда мы реально пошли в поиск, — включая
  // неудачу: иначе платный источник тратится мимо суточного лимита
  await spendSearch(ctx.userId, async () => {
    box.pages = await collect()
    return `${box.pages.length} страниц`
  })

  // страницы без номера отбрасываем до всякой модели: доверять нечему
  const useful = box.pages
    .filter(
      (page) =>
        mentionsIsbn(page.text, ctx.isbn13) ||
        mentionsIsbn(page.title, ctx.isbn13),
    )
    .slice(0, MAX_VARIANTS_PER_STEP)
  if (useful.length === 0) {
    ctx.trace.info('номер на найденных страницах не встретился', { step: key })
    return []
  }

  const payload = useful
    .map((page) => `URL: ${page.url}\n${page.title}\n${page.text}`)
    .join('\n\n')
  const answer = await ask(
    ctx.userId,
    `ISBN: ${ctx.isbn13}. Фрагменты найденных страниц:\n\n${payload.slice(0, 6000)}`,
    { system: WEB_SYSTEM, maxTokens: 1200 },
  )

  const byUrl = new Map(useful.map((page) => [page.url, page]))
  const found: Array<Finding> = []
  for (const parsed of parseGuessDrafts(answer.text)) {
    // ссылка обязана быть одной из поданных: без неё нечего показать человеку
    // как доказательство, а выдуманный адрес хуже отсутствия варианта
    const page = parsed.sourceUrl ? byUrl.get(parsed.sourceUrl) : undefined
    if (!page) continue
    if (found.some((f) => f.proof?.url === page.url)) continue
    found.push(
      finding(key, parsed.draft, ctx.isbn13, {
        variantKey: `${key}#${found.length + 1}`,
        proof: { url: page.url, title: page.title || page.url },
      }),
    )
  }
  ctx.trace.info('страницы разобраны', {
    step: key,
    pages: useful.length,
    variants: found.length,
  })
  return found.slice(0, MAX_VARIANTS_PER_STEP)
}

const web: SourceAdapter = {
  key: 'web',
  paid: true,
  timeoutMs: 20_000,
  probe: (ctx) =>
    readFromWeb(ctx, 'web', async () => {
      const hits = await searchWeb(`ISBN ${ctx.isbn13}`)
      return hits.map((hit) => ({
        url: hit.url,
        title: hit.title,
        text: hit.text,
      }))
    }),
  // страница, на которой встретился номер, — лучший источник обложки
  enrich: async (ctx, draft) => {
    const proof = ctx.soFar.find((f) => f.proof)?.proof
    if (!proof) return { draft: {}, covers: [] }
    const page = await fetchOpenGraph(proof.url)
    return {
      draft: draft.annotation
        ? {}
        : { annotation: page.description ?? undefined },
      covers: page.image ? [page.image] : [],
    }
  },
}

/**
 * Нейропоиск: модель ищет сама и отвечает связным текстом. Ступень остаётся
 * одной находкой и выключена по умолчанию — искать номер генеративным ответом
 * малополезно (ISBN модель не помнит), она сильна как читатель страниц.
 */
const neuro: SourceAdapter = {
  key: 'neuro',
  paid: true,
  timeoutMs: 35_000,
  probe: (ctx) =>
    readFromWeb(ctx, 'neuro', async () => {
      const answer = await genSearch(
        `Книга с ISBN ${ctx.isbn13}: название, автор, издательство, год, число страниц.`,
      )
      // текст ответа кладём к цитируемой странице: номер обычно именно там
      const cited = answer.sources.find((src) => src.used) ?? answer.sources[0]
      if (!cited) return []
      return [
        {
          url: cited.url,
          title: cited.title || cited.url,
          text: answer.text,
        },
      ]
    }),
  // Яндекс Картинки — тоже платная услуга, поэтому живут за платной ступенью
  // и расходуются через общий счётчик, а не мимо него
  enrich: async (ctx, draft) => {
    if (!draft.title) return { draft: {}, covers: [] }
    let covers: Array<string> = []
    await spendSearch(ctx.userId, async () => {
      covers = await searchCoverImages(
        `${draft.title} ${draft.authors ?? ''} книга обложка`.trim(),
        4,
      )
      return `${covers.length} картинок`
    })
    return { draft: {}, covers }
  },
}

export const ADAPTERS: Partial<Record<SourceKey, SourceAdapter>> = {
  reference,
  fantlab,
  google,
  openlibrary,
  web,
  neuro,
}
````

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test`

Ожидается: PASS — 7 новых тестов адаптеров, прежние не сломаны (в том числе тесты чистилок в `aiRecognize.test.ts` — они ходят через реэкспорт).

- [ ] **Шаг 6: Коммит**

```bash
git add src/services/find/ src/services/aiRecognize.ts
git commit -m "M32: источники стали адаптерами — сеть за границей ядра"
```

---

## Задача 5: Слияние по порядку настроек

Требование 2, вторая половина: порядок в списке решает не только очередь опроса, но и **чьи данные победят**. Сейчас приоритет зашит в трёх местах и настройкам не подчиняется.

**Файлы:**

- Создать: `src/services/find/merge.ts`
- Создать: `src/services/find/merge.test.ts`
- Изменить: `src/services/metadata/merge.ts` (удалить `BIB_ORDER`, `ANNOTATION_ORDER`)
- Изменить: `src/services/reference.ts:29-34` (удалить `SOURCE_PRIORITY`)

**Интерфейсы:**

- Потребляет: `Finding`, `SourceKey` из `./types`; `MetadataDraft` из `@/services/metadata/types`.
- Отдаёт наружу: `mergeFindings(findings, order)` → `{ draft: MetadataDraft; covers: Array<string> }`.

- [ ] **Шаг 1: Написать падающий тест**

Создать `src/services/find/merge.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { mergeFindings } from './merge'
import type { Finding, SourceKey } from './types'

const make = (
  key: SourceKey,
  draft: Finding['draft'],
  covers: Array<string> = [],
  weak = false,
): Finding => ({
  key,
  variantKey: key,
  draft,
  proof: null,
  refBookId: null,
  workId: null,
  covers,
  weak,
})

describe('слияние находок', () => {
  test('поле берётся у старшей ступени по порядку', () => {
    const { draft } = mergeFindings(
      [
        make('google', { title: 'Zona', publisher: 'Азбука' }),
        make('fantlab', { title: 'Зона' }),
      ],
      ['reference', 'fantlab', 'google', 'openlibrary'],
    )
    // fantlab выше google — название его, издательство добирается у google
    expect(draft.title).toBe('Зона')
    expect(draft.publisher).toBe('Азбука')
  })

  test('перестановка порядка меняет победителя', () => {
    const findings = [
      make('google', { title: 'Zona' }),
      make('fantlab', { title: 'Зона' }),
    ]
    const asIs = mergeFindings(findings, ['fantlab', 'google'])
    const swapped = mergeFindings(findings, ['google', 'fantlab'])
    expect(asIs.draft.title).toBe('Зона')
    expect(swapped.draft.title).toBe('Zona')
  })

  test('ступень вне порядка игнорируется', () => {
    const { draft } = mergeFindings(
      [make('openlibrary', { title: 'Zone' })],
      ['reference', 'fantlab'],
    )
    expect(draft.title).toBeUndefined()
  })

  test('пустая строка не считается значением', () => {
    const { draft } = mergeFindings(
      [
        make('fantlab', { publisher: '' }),
        make('google', { publisher: 'АСТ' }),
      ],
      ['fantlab', 'google'],
    )
    expect(draft.publisher).toBe('АСТ')
  })

  test('обложки собираются по порядку и без повторов', () => {
    const { covers } = mergeFindings(
      [
        make('google', { title: 'A' }, ['g.jpg', 'shared.jpg']),
        make('fantlab', { title: 'A' }, ['shared.jpg', 'f.jpg']),
      ],
      ['fantlab', 'google'],
    )
    expect(covers).toEqual(['shared.jpg', 'f.jpg', 'g.jpg'])
  })

  test('находок нет — черновик пуст', () => {
    const { draft, covers } = mergeFindings([], ['fantlab'])
    expect(draft).toEqual({})
    expect(covers).toEqual([])
  })

  test('транслит уступает нормальной находке, даже стоя выше', () => {
    const { draft } = mergeFindings(
      [
        make('google', { title: 'Deti-bilingvy' }, [], true),
        make('web', { title: 'Дети-билингвы' }),
      ],
      ['google', 'web'],
    )
    expect(draft.title).toBe('Дети-билингвы')
  })

  test('транслит всё же лучше пустоты', () => {
    const { draft } = mergeFindings(
      [make('google', { title: 'Deti-bilingvy' }, [], true)],
      ['google', 'web'],
    )
    expect(draft.title).toBe('Deti-bilingvy')
  })
})
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/find/merge.test.ts`

Ожидается: FAIL — `Cannot find module './merge'`.

- [ ] **Шаг 3: Написать слияние**

Создать `src/services/find/merge.ts`:

```ts
import type { MetadataDraft } from '@/services/metadata/types'
import type { Finding, SourceKey } from './types'

/**
 * Слияние находок пофилдово (M32).
 *
 * Приоритет полей — это порядок цепочки из настроек, а не зашитая константа.
 * Раньше приоритет лежал в трёх местах (`BIB_ORDER` и `ANNOTATION_ORDER` в
 * metadata/merge.ts, `SOURCE_PRIORITY` в reference.ts) и настройкам не
 * подчинялся: список в «Источниках» создавал иллюзию управления — поднимаешь
 * Google над FantLab, а название всё равно приходит из FantLab.
 *
 * Слабые находки (транслит вместо русского названия) уступают любым нормальным,
 * как бы высоко ни стоял их источник, — но берутся, если больше нечего взять.
 */

const FIELDS = [
  'title',
  'authors',
  'publisher',
  'year',
  'pages',
  'annotation',
  'seriesName',
  'language',
  'heightMm',
  'coverType',
  'sourceRef',
  'fantlabAuthors',
  'fantlabWorks',
] as const

export function mergeFindings(
  findings: Array<Finding>,
  order: Array<SourceKey>,
): { draft: MetadataDraft; covers: Array<string> } {
  // сначала нормальные находки по порядку, затем слабые — тем же порядком
  const ranked = [
    ...order.filter((k) => findings.some((f) => f.key === k && !f.weak)),
    ...order.filter((k) => findings.some((f) => f.key === k && f.weak)),
  ]
  const byKey = new Map<SourceKey, MetadataDraft>()
  for (const key of ranked) {
    const found = findings.find((f) => f.key === key)
    if (found) byKey.set(key, found.draft)
  }

  const draft: MetadataDraft = {}
  for (const field of FIELDS) {
    for (const key of ranked) {
      const value = byKey.get(key)?.[field]
      if (value !== undefined && value !== '') {
        draft[field] = value as never
        break
      }
    }
  }

  const covers: Array<string> = []
  for (const key of ranked) {
    const found = findings.find((f) => f.key === key)
    for (const url of found?.covers ?? []) {
      if (!covers.includes(url)) covers.push(url)
    }
  }
  if (covers[0]) draft.coverUrl = covers[0]
  return { draft, covers }
}
```

- [ ] **Шаг 4: Убрать зашитый приоритет из `reference.ts`**

В `src/services/reference.ts` удалить константу `SOURCE_PRIORITY` (строки 29–34) и переписать `bestRefBookIdForIsbn` так, чтобы порядок приходил параметром:

```ts
/**
 * Издание эталона по номеру. Порядок источников передаётся снаружи — из
 * цепочки настроек: зашитого приоритета в подсистеме поиска больше нет.
 * `manual` (утверждено модератором) всегда впереди: это решение человека.
 */
export async function bestRefBookIdForIsbn(
  isbn13: string,
  order: Array<string> = ['fantlab', 'google', 'openlibrary'],
): Promise<string | null> {
  const rows = await db
    .select({ id: refBook.id, source: refBook.source })
    .from(refBook)
    .where(eq(refBook.isbn13, isbn13))
  for (const source of ['manual', ...order]) {
    const hit = rows.find((r) => r.source === source)
    if (hit) return hit.id
  }
  return null
}
```

- [ ] **Шаг 5: Убрать зашитый приоритет из `metadata/merge.ts`**

`mergeResults` остаётся ради обратной совместимости `refLookup`, но приоритет тоже становится параметром. В `src/services/metadata/merge.ts` заменить объявления `BIB_ORDER` и `ANNOTATION_ORDER` на параметр функции:

```ts
/** Порядок по умолчанию — только для вызовов вне подсистемы поиска. */
const DEFAULT_ORDER: Array<MetadataSource> = [
  'manual',
  'fantlab',
  'google',
  'openlibrary',
]

export function mergeResults(
  results: Array<SourceResult | null>,
  order: Array<MetadataSource> = DEFAULT_ORDER,
): MergedLookup {
  const bySource = new Map<MetadataSource, MetadataDraft>()
  for (const r of results) {
    if (r) bySource.set(r.source, r.draft)
  }

  const draft: MetadataDraft = {}
  for (const field of BIB_FIELDS) {
    for (const source of order) {
      const value = bySource.get(source)?.[field]
      if (value !== undefined && value !== '') {
        draft[field] = value as never
        break
      }
    }
  }
  for (const source of order) {
    const annotation = bySource.get(source)?.annotation
    if (annotation) {
      draft.annotation = annotation
      break
    }
  }
  // …остальная часть функции без изменений, `sources: order.filter((s) => bySource.has(s))`
```

Заменить в конце функции `sources: BIB_ORDER.filter(...)` на `sources: order.filter((s) => bySource.has(s))`.

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test`

Ожидается: PASS — 6 новых тестов слияния, прежние 162 не сломаны. Если `metadata.test.ts` упал — там ожидался прежний приоритет аннотации (`google` раньше `fantlab`); `DEFAULT_ORDER` его сохраняет, значит падение означает опечатку в порядке.

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/find/merge.ts src/services/find/merge.test.ts src/services/metadata/merge.ts src/services/reference.ts
git commit -m "M32: порядок источников решает, чьи данные победят"
```

---

## Задача 6: Кэш, привязанный к настройкам

Кэш перестаёт врать: результат, полученный при одном составе источников, не отдаётся при другом.

**Файлы:**

- Создать: `src/services/find/cache.ts`
- Создать: `src/services/find/cache.test.ts`
- Изменить: `src/db/schema/circulation.ts` (колонка `chain` у `lookup_cache`)
- Создать: миграция через `bun run db:generate`

**Интерфейсы:**

- Потребляет: `db` из `@/db`; `lookupCache` из `@/db/schema/circulation`; типы из `./types`.
- Отдаёт наружу: `chainFingerprint(order)`, `readCache(isbn13, fingerprint)`, `writeCache(isbn13, fingerprint, result)`.

- [ ] **Шаг 1: Добавить колонку в схему**

В `src/db/schema/circulation.ts` в таблицу `lookupCache` добавить поле:

```ts
  /**
   * Отпечаток цепочки, при которой получен ответ. Настройки изменились —
   * запись промахивается и перезаполняется: иначе выключенный Google
   * продолжал бы отдавать свои данные из кэша.
   */
  chain: text('chain'),
```

- [ ] **Шаг 2: Сгенерировать и прочитать миграцию**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run db:generate`

Открыть новый файл в `drizzle/` и **прочитать глазами**. Ожидается простой `ALTER TABLE lookup_cache ADD COLUMN chain text;`. Если drizzle-kit решил пересоздать таблицу — проверить, что в `INSERT ... SELECT` нет колонки `chain`, которой в старой таблице нет (подводный камень №2).

- [ ] **Шаг 3: Написать падающий тест**

Создать `src/services/find/cache.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-findcache-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-find-cache'

const { chainFingerprint, readCache, writeCache } = await import('./cache')
import type { FindResult } from './types'

const result: FindResult = {
  isbn13: '9785171636951',
  isbn10: null,
  draft: { title: 'Зона' },
  found: ['fantlab'],
  probes: [],
  findings: [],
  proof: null,
  refBookId: null,
  workId: null,
  covers: [],
  cached: false,
  truncated: false,
  exhausted: false,
}

describe('кэш поиска', () => {
  test('отпечаток зависит от состава и порядка', () => {
    expect(chainFingerprint(['fantlab', 'google'])).toBe(
      chainFingerprint(['fantlab', 'google']),
    )
    expect(chainFingerprint(['fantlab', 'google'])).not.toBe(
      chainFingerprint(['google', 'fantlab']),
    )
    expect(chainFingerprint(['fantlab'])).not.toBe(
      chainFingerprint(['fantlab', 'google']),
    )
  })

  test('записанное читается тем же отпечатком', async () => {
    const print = chainFingerprint(['reference', 'fantlab'])
    await writeCache('9785171636951', print, result)
    const back = await readCache('9785171636951', print)
    expect(back?.draft.title).toBe('Зона')
    expect(back?.cached).toBe(true)
  })

  test('другой отпечаток — промах', async () => {
    await writeCache(
      '9785171636952',
      chainFingerprint(['reference', 'fantlab']),
      result,
    )
    const back = await readCache(
      '9785171636952',
      chainFingerprint(['reference', 'google']),
    )
    expect(back).toBeNull()
  })

  test('незнакомый номер — промах', async () => {
    expect(
      await readCache('9780000000002', chainFingerprint(['fantlab'])),
    ).toBeNull()
  })
})
```

- [ ] **Шаг 4: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/find/cache.test.ts`

Ожидается: FAIL — `Cannot find module './cache'`.

- [ ] **Шаг 5: Написать кэш**

Создать `src/services/find/cache.ts`:

```ts
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { lookupCache } from '@/db/schema/circulation'
import type { FindResult, SourceKey } from './types'

/**
 * Кэш поиска, привязанный к настройкам (M32).
 *
 * Раньше кэш хранил результат без отметки, при каком составе источников он
 * получен: выключаешь Google — а кэш продолжает отдавать его данные, и
 * настройка не работает задним числом. Теперь ключ кэша — номер плюс
 * отпечаток цепочки.
 */

const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 дней
/** Версия формата записи: при смене структуры старое просто промахивается. */
const VERSION = 3

/** Отпечаток цепочки: состав и порядок, без разделителей внутри ключей. */
export function chainFingerprint(order: Array<SourceKey>): string {
  return `v${VERSION}:${order.join('>')}`
}

export async function readCache(
  isbn13: string,
  fingerprint: string,
): Promise<FindResult | null> {
  const [row] = await db
    .select()
    .from(lookupCache)
    .where(eq(lookupCache.isbn13, isbn13))
  if (!row || row.chain !== fingerprint) return null
  if (Date.now() - row.fetchedAt.getTime() > TTL_MS) return null
  try {
    const parsed = JSON.parse(row.rawJson) as FindResult
    return { ...parsed, cached: true }
  } catch {
    // битую запись молча не глотаем — но и падать из-за неё незачем
    return null
  }
}

export async function writeCache(
  isbn13: string,
  fingerprint: string,
  result: FindResult,
): Promise<void> {
  // оборванная по бюджету цепочка — не ответ: закэшировав её, мы бы навсегда
  // лишили книгу платных ступеней
  if (result.truncated) return
  const rawJson = JSON.stringify({ ...result, cached: false })
  const values = {
    source: result.found.join(','),
    chain: fingerprint,
    rawJson,
    fetchedAt: new Date(),
  }
  await db
    .insert(lookupCache)
    .values({ isbn13, ...values })
    .onConflictDoUpdate({ target: lookupCache.isbn13, set: values })
}
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test`

Ожидается: PASS — 4 новых теста кэша, прежние не сломаны.

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/find/cache.ts src/services/find/cache.test.ts src/db/schema/circulation.ts drizzle/
git commit -m "M32: кэш поиска привязан к составу источников"
```

---

## Задача 7: Ядро `findEdition`

Сборка всего: цепочка, бюджет, устойчивость, слияние, кэш, отчёт и журнал.

**Файлы:**

- Создать: `src/services/find/enrich.ts`
- Создать: `src/services/find/core.ts`
- Создать: `src/services/find/core.test.ts`

**Интерфейсы:**

- Потребляет: `resolveChain` из `./chain`; `deadline` из `./budget`; `safely` из `./safely`; `mergeFindings` из `./merge`; `chainFingerprint`, `readCache`, `writeCache` из `./cache`; `startTrace` из `./trace`; `parseIsbn` из `@/services/isbn`; `AppError` из `@/services/errors`.
- Отдаёт наружу: `findEdition(userId, rawIsbn, options?)` → `Promise<FindResult>`; `enrichDraft(ctx, chain, draft, covers)`.

- [ ] **Шаг 1: Написать добор**

Создать `src/services/find/enrich.ts`:

```ts
import { safely } from './safely'
import type { ChainStep } from './chain'
import type { FindContext } from './types'
import type { MetadataDraft } from '@/services/metadata/types'

/**
 * Добор недостающего: обложка, аннотация, объём.
 *
 * Идёт по той же цепочке и тем же настройкам, что и сам поиск. Раньше добор
 * жил отдельной жизнью — `enrichMissing` ходил в Google и Яндекс Картинки
 * всегда, невзирая на настройки, а Картинки к тому же мимо суточного лимита.
 */
export async function enrichDraft(
  ctx: FindContext,
  chain: Array<ChainStep>,
  draft: MetadataDraft,
  covers: Array<string>,
): Promise<{ draft: MetadataDraft; covers: Array<string> }> {
  if (!draft.title) return { draft, covers }
  const filled = { ...draft }
  const all = [...covers]

  for (const step of chain) {
    const enough = filled.annotation && filled.pages && all.length >= 3
    if (enough) break
    if (!step.enabled || !step.adapter.enrich) continue
    if (!ctx.leftMs || ctx.leftMs() < step.adapter.timeoutMs) {
      ctx.trace.info('добор пропущен: не хватает времени', {
        step: step.adapter.key,
      })
      continue
    }

    const got = await safely(
      `добор ${step.adapter.key}`,
      ctx.trace,
      () => step.adapter.enrich!(ctx, filled),
      step.adapter.timeoutMs,
    )
    if (!got.value) continue
    filled.annotation = filled.annotation ?? got.value.draft.annotation
    filled.pages = filled.pages ?? got.value.draft.pages
    for (const url of got.value.covers) {
      if (url.startsWith('http') && !all.includes(url)) all.push(url)
    }
    ctx.trace.info('добор', {
      step: step.adapter.key,
      covers: got.value.covers.length,
      annotation: Boolean(got.value.draft.annotation),
    })
  }

  if (all[0]) filled.coverUrl = all[0]
  return { draft: filled, covers: all.slice(0, 5) }
}
```

- [ ] **Шаг 2: Написать падающий тест ядра**

Создать `src/services/find/core.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-findcore-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-find-core'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { bookSource, userAccount } = await import('@/db/schema/moderation')
const { lookupCache } = await import('@/db/schema/circulation')
const { findEdition } = await import('./core')
const { setEnabled, moveSource } = await import('@/services/bookSources')
const { looksTransliterated } = await import('./clean')
import type { Finding, SourceAdapter, SourceKey } from './types'

const ME = 'core-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'core@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
await db.insert(userAccount).values({ userId: ME, role: 'admin' })

const ISBN = '9785171636951'
/** Кто из подставных источников был спрошен в этом прогоне. */
let asked: Array<SourceKey> = []

/** Подставная ступень: отвечает одной находкой, списком или ничем. */
const answering = (
  key: SourceKey,
  drafts: Finding['draft'] | Array<Finding['draft']> | null,
  extra: { paid?: boolean; delayMs?: number; throws?: boolean } = {},
): SourceAdapter => ({
  key,
  paid: extra.paid ?? false,
  timeoutMs: 1_000,
  probe: async () => {
    asked.push(key)
    if (extra.delayMs) await new Promise((r) => setTimeout(r, extra.delayMs))
    if (extra.throws) throw new Error(`${key} лёг`)
    if (!drafts) return []
    const list = Array.isArray(drafts) ? drafts : [drafts]
    return list.map((draft, index) => ({
      key,
      variantKey: list.length > 1 ? `${key}#${index + 1}` : key,
      draft,
      proof: null,
      refBookId: null,
      workId: null,
      covers: [],
      // как в боевом адаптере: латиница у русского номера — слабая находка
      weak: looksTransliterated(ISBN, draft.title, draft.authors),
    }))
  },
})

const registry = (
  over: Partial<Record<SourceKey, SourceAdapter>> = {},
): Partial<Record<SourceKey, SourceAdapter>> => ({
  reference: answering('reference', null),
  fantlab: answering('fantlab', { title: 'Зона', authors: 'Довлатов' }),
  google: answering('google', { title: 'Zona', publisher: 'Азбука' }),
  openlibrary: answering('openlibrary', null),
  web: answering('web', null, { paid: true }),
  neuro: answering('neuro', null, { paid: true }),
  ...over,
})

beforeEach(async () => {
  asked = []
  await db.delete(bookSource)
  await db.delete(lookupCache)
})

describe('ядро поиска', () => {
  test('кривой ISBN — понятная ошибка, а не падение', async () => {
    await expect(
      findEdition(ME, '123', { adapters: registry() }),
    ).rejects.toThrow(/ISBN/i)
  })

  test('находки сливаются по порядку цепочки', async () => {
    const result = await findEdition(ME, ISBN, { adapters: registry() })
    expect(result.draft.title).toBe('Зона')
    expect(result.draft.publisher).toBe('Азбука')
    expect(result.found).toContain('fantlab')
  })

  test('выключенный источник не спрашивается', async () => {
    await setEnabled(ME, 'google', false)
    await findEdition(ME, ISBN, { adapters: registry() })
    expect(asked).not.toContain('google')
  })

  test('выключенный источник виден в отчёте', async () => {
    await setEnabled(ME, 'google', false)
    const result = await findEdition(ME, ISBN, { adapters: registry() })
    const probe = result.probes.find((p) => p.key === 'google')
    expect(probe?.outcome).toBe('выключен')
  })

  test('упавший источник не роняет поиск', async () => {
    const result = await findEdition(ME, ISBN, {
      adapters: registry({
        fantlab: answering('fantlab', null, { throws: true }),
      }),
    })
    expect(result.draft.title).toBe('Zona')
    const probe = result.probes.find((p) => p.key === 'fantlab')
    expect(probe?.outcome).toBe('ошибка')
    expect(probe?.detail).toMatch(/лёг/)
  })

  test('нашлось бесплатно — за платное не платим', async () => {
    const paidRegistry = registry({
      web: answering('web', { title: 'Из веба' }, { paid: true }),
    })
    await findEdition(ME, ISBN, { adapters: paidRegistry })
    expect(asked).not.toContain('web')
  })

  test('транслит не считается ответом — цепочка идёт дальше', async () => {
    const translit = registry({
      fantlab: answering('fantlab', null),
      // латиница у русского номера 978-5-… — слабая находка
      google: answering('google', { title: 'Deti-bilingvy' }),
      web: answering('web', { title: 'Дети-билингвы' }, { paid: true }),
    })
    const result = await findEdition(ME, ISBN, { adapters: translit })
    expect(asked).toContain('web')
    expect(result.draft.title).toBe('Дети-билингвы')
  })

  test('маленький бюджет обрывает цепочку до платных ступеней', async () => {
    const silent = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
    })
    const result = await findEdition(ME, ISBN, {
      budgetMs: 1,
      adapters: silent,
    })
    expect(result.truncated).toBe(true)
    expect(asked).not.toContain('web')
  })

  test('оборванная цепочка помечает не дошедшие ступени', async () => {
    const silent = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
    })
    const result = await findEdition(ME, ISBN, {
      budgetMs: 1,
      adapters: silent,
    })
    expect(result.probes.some((p) => p.outcome === 'не успели')).toBe(true)
  })

  test('оборванная цепочка не кэшируется', async () => {
    const silent = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
    })
    await findEdition(ME, ISBN, { budgetMs: 1, adapters: silent })
    asked = []
    const again = await findEdition(ME, ISBN, { adapters: silent })
    expect(again.cached).toBe(false)
    expect(asked.length).toBeGreaterThan(0)
  })

  test('повтор отдаётся из кэша, источники не тревожатся', async () => {
    await findEdition(ME, ISBN, { adapters: registry() })
    asked = []
    const again = await findEdition(ME, ISBN, { adapters: registry() })
    expect(again.cached).toBe(true)
    expect(asked).toEqual([])
  })

  test('смена настроек обесценивает кэш', async () => {
    await findEdition(ME, ISBN, { adapters: registry() })
    await moveSource(ME, 'google', 'up')
    asked = []
    const again = await findEdition(ME, ISBN, { adapters: registry() })
    expect(again.cached).toBe(false)
    expect(asked.length).toBeGreaterThan(0)
  })

  test('force идёт мимо кэша', async () => {
    await findEdition(ME, ISBN, { adapters: registry() })
    asked = []
    const again = await findEdition(ME, ISBN, {
      force: true,
      adapters: registry(),
    })
    expect(again.cached).toBe(false)
    expect(asked).toContain('fantlab')
  })

  test('отвергнутая ступень пропускается', async () => {
    await findEdition(ME, ISBN, {
      rejected: ['fantlab'],
      adapters: registry(),
    })
    expect(asked).not.toContain('fantlab')
  })

  test('никто не ответил — пустой черновик, не исключение', async () => {
    const silent = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
    })
    const result = await findEdition(ME, ISBN, { adapters: silent })
    expect(result.draft.title).toBeUndefined()
    expect(result.exhausted).toBe(true)
  })

  test('ступень отдаёт несколько вариантов — все попадают в находки', async () => {
    const many = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
      web: answering(
        'web',
        [
          { title: 'Зона', year: 2020 },
          { title: 'Зона', year: 2001 },
          { title: 'Зона: записки надзирателя' },
        ],
        { paid: true },
      ),
    })
    const result = await findEdition(ME, ISBN, { adapters: many })
    expect(result.findings).toHaveLength(3)
    expect(result.findings.map((f) => f.variantKey)).toEqual([
      'web#1',
      'web#2',
      'web#3',
    ])
  })

  test('в слитый черновик идёт первый вариант ступени', async () => {
    const many = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
      web: answering(
        'web',
        [
          { title: 'Зона', year: 2020 },
          { title: 'Зона', year: 2001 },
        ],
        { paid: true },
      ),
    })
    const result = await findEdition(ME, ISBN, { adapters: many })
    expect(result.draft.year).toBe(2020)
  })
})
```

- [ ] **Шаг 3: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/find/core.test.ts`

Ожидается: FAIL — `Cannot find module './core'`.

- [ ] **Шаг 4: Написать ядро**

Создать `src/services/find/core.ts`:

```ts
import { AppError } from '@/services/errors'
import { parseIsbn } from '@/services/isbn'
import { deadline } from './budget'
import { chainFingerprint, readCache, writeCache } from './cache'
import { resolveChain } from './chain'
import { enrichDraft } from './enrich'
import { mergeFindings } from './merge'
import { safely } from './safely'
import { startTrace } from './trace'
import { FULL_BUDGET_MS } from './types'
import type {
  Finding,
  FindContext,
  FindOptions,
  FindResult,
  SourceProbe,
} from './types'

/**
 * Единая точка поиска издания по номеру (M32).
 *
 * Одна функция на все входы: добавление по ISBN, «Не распознано», карточка
 * книги, фоновая доигровка. Вариаций нет — есть параметры: бюджет времени,
 * список отвергнутых ступеней и признак «забыть кэш».
 *
 * Каждая ступень обёрнута `safely`: её отказ становится строкой отчёта, а не
 * падением. Бюджет решает, докуда дойти: не хватило времени на платную
 * ступень — цепочка честно помечается `truncated`, и доигрывает её воркер.
 */
export async function findEdition(
  userId: string,
  rawIsbn: string,
  options: FindOptions = {},
): Promise<FindResult> {
  const parsed = parseIsbn(rawIsbn)
  if (!parsed) {
    throw new AppError(
      'Это не похоже на ISBN — проверьте цифры или заполните карточку вручную',
    )
  }
  const { isbn13, isbn10 } = parsed
  const trace = startTrace(isbn13, userId)
  const budget = deadline(options.budgetMs ?? FULL_BUDGET_MS)
  const rejected = new Set(options.rejected ?? [])

  const chain = await resolveChain(userId, options.adapters)
  const order = chain.map((step) => step.adapter.key)
  const fingerprint = chainFingerprint(order)
  trace.info('поиск начат', {
    chain: order.join('>'),
    budgetMs: options.budgetMs ?? FULL_BUDGET_MS,
    force: Boolean(options.force),
  })

  if (!options.force && rejected.size === 0) {
    const hit = await safely('чтение кэша', trace, () =>
      readCache(isbn13, fingerprint),
    )
    if (hit.value) {
      trace.info('отдано из кэша', { ms: trace.ms() })
      return hit.value
    }
  }

  const probes: Array<SourceProbe> = []
  const findings: Array<Finding> = []
  let truncated = false

  for (const step of chain) {
    const key = step.adapter.key
    if (rejected.has(key)) {
      probes.push({
        key,
        outcome: 'выключен',
        detail: 'отвергнут человеком',
        ms: 0,
      })
      continue
    }
    if (!step.enabled) {
      probes.push({ key, outcome: 'выключен', detail: step.reason, ms: 0 })
      continue
    }
    // за платное не платим, если бесплатное уже дало годный ответ: цепочка
    // лесенкой — это её главный смысл, а не побочный эффект
    if (step.adapter.paid && findings.some((f) => !f.weak && f.draft.title)) {
      probes.push({
        key,
        outcome: 'молчит',
        detail: 'не понадобился: книга нашлась раньше',
        ms: 0,
      })
      continue
    }
    if (!budget.enoughFor(step.adapter.timeoutMs)) {
      truncated = true
      probes.push({
        key,
        outcome: 'не успели',
        detail: `осталось ${budget.left()} мс`,
        ms: 0,
      })
      trace.info('ступень отложена: не хватает бюджета', {
        step: key,
        leftMs: budget.left(),
      })
      continue
    }

    const ctx: FindContext = {
      userId,
      isbn13,
      soFar: findings,
      trace,
      leftMs: () => budget.left(),
    }
    const got = await safely(
      `ступень ${key}`,
      trace,
      () => step.adapter.probe(ctx),
      step.adapter.timeoutMs,
    )
    if (got.failure) {
      probes.push({ key, outcome: 'ошибка', detail: got.failure, ms: got.ms })
      continue
    }
    if (!got.value || got.value.length === 0) {
      probes.push({ key, outcome: 'молчит', detail: null, ms: got.ms })
      trace.info('ступень промолчала', { step: key, ms: got.ms })
      continue
    }

    findings.push(...got.value)
    const first = got.value[0]!
    probes.push({
      key,
      outcome: 'нашёл',
      // у веб-ступени вариантов может быть несколько — говорим сколько
      detail:
        got.value.length > 1
          ? `${got.value.length} варианта`
          : (first.proof?.url ?? null),
      ms: got.ms,
    })
    trace.info('ступень ответила', {
      step: key,
      title: first.draft.title,
      variants: got.value.length,
      ms: got.ms,
    })
    // бесплатные каталоги опрашиваем целиком: их ответы дополняют друг друга.
    // платную ступень, которая уже дала название, повторять незачем
    if (step.adapter.paid && first.draft.title) break
  }

  const merged = mergeFindings(findings, order)
  const ctx: FindContext = {
    userId,
    isbn13,
    soFar: findings,
    trace,
    leftMs: () => budget.left(),
  }
  const enriched = await enrichDraft(ctx, chain, merged.draft, merged.covers)

  const confirmed = findings.find((f) => f.refBookId)
  const proven = findings.find((f) => f.proof)
  const result: FindResult = {
    isbn13,
    isbn10,
    draft: enriched.draft,
    found: findings.map((f) => f.key),
    probes,
    findings,
    proof: proven?.proof ?? null,
    refBookId: confirmed?.refBookId ?? null,
    workId: confirmed?.workId ?? null,
    covers: enriched.covers,
    cached: false,
    truncated,
    exhausted: !truncated && findings.length === 0,
  }

  if (findings.length > 0 || !truncated) {
    const written = await safely('запись кэша', trace, () =>
      writeCache(isbn13, fingerprint, result),
    )
    // кэш — не best-effort молчком: если он не пишется, поиск будет ходить
    // в платные источники по кругу, и об этом надо знать
    if (written.failure) {
      trace.error('кэш не записался', { failure: written.failure })
    }
  }

  trace.info('поиск закончен', {
    found: result.found.join(',') || 'ничего',
    truncated,
    ms: trace.ms(),
  })
  return result
}
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test`

Ожидается: PASS — 12 новых тестов ядра, прежние не сломаны.

- [ ] **Шаг 6: Коммит**

```bash
git add src/services/find/
git commit -m "M32: ядро findEdition — одна цепочка на все входы"
```

---

## Задача 8: Переезд точек входа

Четыре ветки становятся вызовами ядра. Здесь же снимаются `NODE_ENV === 'test'` из боевых клиентов — они больше не нужны, потому что тесты подставляют адаптеры.

**Файлы:**

- Создать: `src/services/bookWriter.ts`
- Создать: `src/services/bookWriter.test.ts`
- Изменить: `src/services/metadata/lookup.ts` (целиком)
- Изменить: `src/services/unrecognized.ts:78-151` (`retryLookup`)
- Изменить: `src/services/aiRecognize.ts` (`recognizeIsbn`, `proposeForBook`)
- Изменить: `src/services/titleSearch.ts:206-226` (FantLab по настройке)
- Изменить: `src/services/covers.ts:283-303` (`searchCoversForBook`)
- Изменить: `src/services/metadata/{googleBooks,fantlab,openLibrary}.ts` (снять `NODE_ENV`)

**Интерфейсы:**

- Потребляет: `findEdition` из `@/services/find/core`; `FindResult` из `@/services/find/types`.
- Отдаёт наружу: `applyDraftToBook(bookId, draft, options)` → `Promise<void>`.

- [ ] **Шаг 1: Написать падающий тест единой записи в карточку**

Создать `src/services/bookWriter.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-writer-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-writer'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { book } = await import('@/db/schema/catalog')
const { eq } = await import('drizzle-orm')
const { createLibrary } = await import('./libraries')
const { createShelf } = await import('./shelves')
const { createBook } = await import('./books')
const { applyDraftToBook } = await import('./bookWriter')

const ME = 'writer-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'writer@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const lib = await createLibrary(ME, { name: 'Дом' })
const shelfRow = await createShelf(ME, { libraryId: lib.id, name: 'Полка' })

// `BookInput` поля `status` не имеет: статус выводится из размещения
const makeBook = async (title: string) =>
  createBook(ME, {
    title,
    authors: '',
    libraryId: lib.id,
    shelfId: shelfRow.id,
  })

const read = async (id: string) => {
  const [row] = await db.select().from(book).where(eq(book.id, id))
  return row!
}

describe('запись найденного в карточку', () => {
  test('пишет все поля черновика разом', async () => {
    const created = await makeBook('9785171636951')
    await applyDraftToBook(created.id, {
      title: 'Зона',
      authors: 'Довлатов',
      publisher: 'Азбука',
      year: 2020,
      pages: 224,
      language: 'ru',
      coverType: 'hard',
      heightMm: 215,
    })
    const row = await read(created.id)
    expect(row.title).toBe('Зона')
    expect(row.pages).toBe(224)
    expect(row.coverType).toBe('hard')
    expect(row.heightMm).toBe(215)
  })

  test('нормализованные поля пишутся вместе с исходными', async () => {
    const created = await makeBook('9785171636952')
    await applyDraftToBook(created.id, { title: 'Зона', authors: 'Довлатов' })
    const row = await read(created.id)
    expect(row.titleNorm).toBe('зона')
    expect(row.authorsNorm).toBe('довлатов')
  })

  test('появилось название — пометка «не распознано» снимается', async () => {
    const created = await makeBook('9785171636953')
    await db
      .update(book)
      .set({ unrecognized: true })
      .where(eq(book.id, created.id))
    await applyDraftToBook(created.id, { title: 'Зона' })
    expect((await read(created.id)).unrecognized).toBe(false)
  })

  test('режим «только пустое» не затирает заполненное', async () => {
    const created = await makeBook('9785171636954')
    await applyDraftToBook(created.id, { title: 'Зона', publisher: 'Азбука' })
    await applyDraftToBook(
      created.id,
      { title: 'Другое', publisher: 'АСТ', year: 1999 },
      { mode: 'fill' },
    )
    const row = await read(created.id)
    expect(row.title).toBe('Зона')
    expect(row.publisher).toBe('Азбука')
    expect(row.year).toBe(1999)
  })

  test('пустой черновик карточку не трогает', async () => {
    const created = await makeBook('9785171636955')
    await applyDraftToBook(created.id, {})
    expect((await read(created.id)).title).toBe('9785171636955')
  })
})
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/bookWriter.test.ts`

Ожидается: FAIL — `Cannot find module './bookWriter'`.

- [ ] **Шаг 3: Написать единого писателя карточки**

Создать `src/services/bookWriter.ts`:

```ts
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { book } from '@/db/schema/catalog'
import { log } from '@/lib/logger'
import { syncBookAuthors } from './authors'
import { normalizeForSearch } from './search'
import { resolveSeriesByName } from './series'
import type { MetadataDraft } from './metadata/types'

/**
 * Единственное место, которое переносит найденное в карточку книги (M32).
 *
 * Раньше это делали три разных куска кода с разными наборами полей:
 * `retryLookup` писал язык, переплёт и высоту, `applyRecognition` — нет,
 * `applyProposal` — третий набор. Одна и та же книга получала разную карточку
 * в зависимости от того, с какого экрана её нашли.
 */
export interface WriteOptions {
  /** `replace` — переписать всё найденное, `fill` — только пустые поля. */
  mode?: 'replace' | 'fill'
  /** Владелец: нужен, чтобы завести серию в его личном словаре. */
  userId?: string
}

/** Поля черновика, которые ложатся в карточку один в один. */
const DIRECT = [
  'publisher',
  'year',
  'pages',
  'annotation',
  'language',
  'coverType',
  'heightMm',
] as const

export async function applyDraftToBook(
  bookId: string,
  draft: MetadataDraft,
  options: WriteOptions = {},
): Promise<void> {
  const [row] = await db.select().from(book).where(eq(book.id, bookId))
  if (!row) return
  const fill = options.mode === 'fill'

  const patch: Record<string, unknown> = {}
  const put = (field: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return
    const current = (row as unknown as Record<string, unknown>)[field]
    const empty = current === null || current === undefined || current === ''
    if (fill && !empty) return
    if (current === value) return
    patch[field] = value
  }

  if (draft.title) {
    put('title', draft.title.trim())
    if (patch.title) patch.titleNorm = normalizeForSearch(draft.title)
  }
  if (draft.authors !== undefined) {
    put('authors', draft.authors.trim())
    if (patch.authors !== undefined) {
      patch.authorsNorm = normalizeForSearch(draft.authors)
    }
  }
  for (const field of DIRECT) put(field, draft[field])

  if (draft.seriesName && options.userId) {
    const seriesId = await resolveSeriesByName(options.userId, draft.seriesName)
    put('seriesId', seriesId)
  }

  // название появилось — книга перестала быть болванкой из сканера
  const titleNow = (patch.title as string | undefined) ?? row.title
  if (row.unrecognized && titleNow && titleNow !== row.isbn13) {
    patch.unrecognized = false
  }

  if (Object.keys(patch).length === 0) return
  patch.updatedAt = new Date()
  await db.update(book).set(patch).where(eq(book.id, bookId))

  if (typeof patch.authors === 'string') {
    await syncBookAuthors(bookId, patch.authors, draft.fantlabAuthors)
  }
  log.info('find', 'карточка дозаполнена', {
    bookId,
    mode: options.mode ?? 'replace',
    fields: Object.keys(patch).join(','),
  })
}
```

- [ ] **Шаг 4: Убедиться, что тест проходит**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/bookWriter.test.ts`

Ожидается: PASS, 5 тестов.

- [ ] **Шаг 5: Перевести `lookupIsbn` на ядро**

Заменить содержимое `src/services/metadata/lookup.ts` целиком:

```ts
import { and, eq, inArray, or } from 'drizzle-orm'

import { db } from '@/db'
import { book } from '@/db/schema/catalog'
import { findEdition } from '@/services/find/core'
import { memberLibraryIds } from '@/services/members'
import type { FindOptions } from '@/services/find/types'
import type { MetadataDraft } from './types'

/**
 * Поиск метаданных по ISBN для экрана «Добавить».
 *
 * Тонкая обёртка над единым ядром (M32): своей цепочки у неё больше нет.
 * Раньше здесь жил отдельный порядок опроса без веб-поиска — из-за чего одна
 * и та же книга в «Добавить» и на «Не распознано» искалась по-разному.
 */
export interface LookupResult {
  isbn13: string
  isbn10: string | null
  draft: MetadataDraft
  sources: Array<string>
  /** Отчёт по каждой ступени: «не нашлось» не должно быть загадкой. */
  probes: Array<{ name: string; outcome: string; detail: string | null }>
  found: boolean
  /** Цепочка оборвана по бюджету — остаток доигрывает воркер. */
  truncated: boolean
  /** Уже есть в доступных книгах — предупреждение о дубле (дубль допустим). */
  duplicates: Array<{ id: string; title: string }>
}

const SOURCE_NAME: Record<string, string> = {
  reference: 'Свой эталон',
  fantlab: 'FantLab',
  google: 'Google Books',
  openlibrary: 'OpenLibrary',
  web: 'Яндекс Поиск',
  neuro: 'Нейропоиск',
}

async function findDuplicates(userId: string, isbn13: string) {
  const libIds = await memberLibraryIds(userId)
  return db
    .select({ id: book.id, title: book.title })
    .from(book)
    .where(
      and(
        eq(book.isbn13, isbn13),
        or(
          libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
          eq(book.addedBy, userId),
        ),
      ),
    )
    .limit(5)
}

export async function lookupIsbn(
  userId: string,
  rawIsbn: string,
  options: FindOptions = {},
): Promise<LookupResult> {
  const found = await findEdition(userId, rawIsbn, options)
  const duplicates = await findDuplicates(userId, found.isbn13)
  return {
    isbn13: found.isbn13,
    isbn10: found.isbn10,
    draft: found.draft,
    sources: found.found,
    probes: found.probes.map((p) => ({
      name: SOURCE_NAME[p.key] ?? p.key,
      outcome: p.outcome,
      detail: p.detail,
    })),
    found: Boolean(found.draft.title),
    truncated: found.truncated,
    duplicates,
  }
}
```

- [ ] **Шаг 6: Перевести `retryLookup` на ядро и общего писателя**

В `src/services/unrecognized.ts` заменить тело цикла в `retryLookup` (строки 101–149) на:

```ts
const { findEdition } = await import('./find/core')
const { applyDraftToBook } = await import('./bookWriter')
const { saveCoverFromUrl } = await import('./covers')

let resolved = 0
let missed = 0
for (const row of rows) {
  const found = await findEdition(userId, row.isbn13!)
  if (!found.draft.title?.trim()) {
    missed++
    continue
  }
  await applyDraftToBook(row.id, found.draft, { userId })
  if (!row.coverPath && found.draft.coverUrl) {
    try {
      const saved = await saveCoverFromUrl(row.id, found.draft.coverUrl)
      await db
        .update(book)
        .set({ coverPath: saved.path, coverColor: saved.color })
        .where(eq(book.id, row.id))
    } catch (error) {
      // обложка — best-effort, но молчать об отказе нельзя
      log.warn('find', 'обложка не сохранилась', {
        bookId: row.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  resolved++
}
return { resolved, missed }
```

Добавить в шапку файла импорт: `import { log } from '@/lib/logger'`. Удалить ставшие ненужными импорты `normalizeForSearch` и `syncBookAuthors`, если они больше нигде в файле не используются (проверить `bun run typecheck`).

- [ ] **Шаг 7: Перевести `recognizeIsbn` на ядро**

В `src/services/aiRecognize.ts` заменить тело `recognizeIsbn` (строки 403–748) на обёртку, которая приводит `FindResult` к прежней форме `CoreResult` — чтобы UI не переписывать:

```ts
export async function recognizeIsbn(
  userId: string,
  isbn13: string,
  options: { force?: boolean; mode?: 'extract' | 'generative' } = {},
): Promise<CoreResult> {
  const { findEdition } = await import('./find/core')
  const hit = await cached(isbn13)
  const rejected = options.force ? [] : parseRejected(hit?.rejectedVias)

  const found = await findEdition(userId, isbn13, {
    force: options.force,
    rejected: rejected as Array<SourceKey>,
  })

  const variants: Array<FoundVariant> = found.findings.map((f) => ({
    via: f.variantKey,
    verdict: f.refBookId ? 'confirmed' : 'unconfirmed',
    title: f.draft.title ?? '',
    authors: f.draft.authors ?? null,
    publisher: f.draft.publisher ?? null,
    year: f.draft.year ?? null,
    pages: f.draft.pages ?? null,
    seriesName: f.draft.seriesName ?? null,
    annotation: f.draft.annotation ?? null,
    coverUrl: f.draft.coverUrl ?? null,
    coverOptions: f.covers,
    refBookId: f.refBookId,
    workId: f.workId,
    proofUrl: f.proof?.url ?? null,
    proofTitle: f.proof?.title ?? null,
  }))

  const title = found.draft.title ?? null
  const verdict: Verdict = found.refBookId
    ? 'confirmed'
    : title
      ? 'unconfirmed'
      : 'unknown'
  const top = found.findings[found.findings.length - 1]

  await writeGuess({
    isbn13,
    verdict,
    title,
    authors: found.draft.authors ?? null,
    publisher: found.draft.publisher ?? null,
    year: found.draft.year ?? null,
    seriesName: found.draft.seriesName ?? null,
    pages: found.draft.pages ?? null,
    annotation: found.draft.annotation ?? null,
    coverUrl: found.draft.coverUrl ?? null,
    coverOptions: JSON.stringify(found.covers),
    refBookId: found.refBookId,
    workId: found.workId,
    via: top?.variantKey ?? 'none',
    proofUrl: found.proof?.url ?? null,
    proofTitle: found.proof?.title ?? null,
    rejectedVias: JSON.stringify(rejected),
    variants: JSON.stringify(variants),
  })

  return {
    isbn13,
    verdict,
    guess: {
      known: verdict !== 'unknown',
      title,
      authors: found.draft.authors ?? null,
      publisher: found.draft.publisher ?? null,
      year: found.draft.year ?? null,
      seriesName: found.draft.seriesName ?? null,
    },
    fromPrefix: isbnOrigin(isbn13).publisher,
    refBookId: found.refBookId,
    workId: found.workId,
    confirmed: title
      ? {
          title,
          authors: found.draft.authors ?? '',
          publisher: found.draft.publisher ?? null,
          year: found.draft.year ?? null,
          pages: found.draft.pages ?? null,
          seriesName: found.draft.seriesName ?? null,
          coverUrl: found.draft.coverUrl ?? null,
          annotation: found.draft.annotation ?? null,
        }
      : null,
    cached: found.cached,
    askedModel: found.findings.some(
      (f) => f.key === 'web' || f.key === 'neuro',
    ),
    sources: found.probes.map((p) => ({
      name: SOURCE_NAME[p.key] ?? p.key,
      outcome:
        p.outcome === 'нашёл'
          ? 'нашёл'
          : p.outcome === 'ошибка'
            ? 'ошибка'
            : 'молчит',
      detail: p.detail,
    })),
    exhausted: found.exhausted,
    coverOptions: found.covers,
    variants,
    variantIndex: Math.max(0, variants.length - 1),
    via: top?.variantKey ?? 'none',
    proof: found.proof,
  }
}
```

Добавить в шапку файла рядом с прочими импортами:

```ts
import type { SourceKey } from './find/types'

const SOURCE_NAME: Record<string, string> = {
  reference: 'Свой эталон',
  fantlab: 'FantLab',
  google: 'Google Books',
  openlibrary: 'OpenLibrary',
  web: 'Яндекс Поиск',
  neuro: 'Нейропоиск',
}
```

Удалить из файла ставшие мёртвыми `webLookup`, `WEB_SYSTEM`, `enrichMissing`, `verify`, `looksTransliterated` и их импорты (`fetchOpenGraph`, `genSearch`, `searchCoverImages`, `searchWeb`, `spendSearch`, `webSettings`, `searchByTitle`, `adoptExternalWork`, `fetchWorkEditions`, `isCyrillicRegion`). Ориентир — `bun run lint`: он покажет всё неиспользуемое.

**Оставить:** реэкспорты `cleanFoundTitle` / `cleanPublisher` / `cleanAnnotation` / `looksTransliterated` (заведены в задаче 4) и функцию `parseGuess` — на них есть тесты в `aiRecognize.test.ts`, и они продолжают работать через реэкспорт. Правило «транслит из каталога не считается ответом» (коммит `01ad992`) никуда не делось: находка помечается `weak: true` в адаптере, а `mergeFindings` ставит слабые в конец приоритета — цепочка идёт дальше за русским названием, но при полной неудаче транслит всё же возвращается.

- [ ] **Шаг 8: Перевести `proposeForBook` на ядро**

В `src/services/aiRecognize.ts:1490-1513` заменить прямой вызов Google на цепочку:

```ts
// штатная цепочка: та же, что в разборе нераспознанных. Книга без ISBN
// ищется по названию — но той же цепочкой, а не в обход настроек
const found = row.isbn13
  ? await recognizeIsbn(userId, row.isbn13, { force: fresh })
  : null
const shown =
  found?.variants.find((v) => v.via === variantVia) ??
  found?.variants[found.variantIndex] ??
  found?.variants[found.variants.length - 1] ??
  null

const draft = {
  title: shown?.title ?? null,
  authors: shown?.authors ?? null,
  publisher: shown?.publisher ?? null,
  year: shown?.year ?? null,
  pages: shown?.pages ?? null,
  annotation: shown?.annotation ?? null,
  coverUrl: shown?.coverUrl ?? null,
  seriesName: shown?.seriesName ?? null,
}
if (!draft.title) return null
```

Ветка `fetchGoogleByTitle` удаляется: добор по названию теперь живёт в `enrichDraft` и подчиняется настройкам.

- [ ] **Шаг 9: Починить признак «это работа ИИ»**

Раньше находка каталогов имела `via = 'sources'`, и по этой строке `applyRecognition` отличала обычное дозаполнение от работы модели. Теперь `via` — ключ ступени (`fantlab`, `google`, `web`…), и старое сравнение всегда истинно: каждая находка поехала бы в очередь модератора с пометкой «нашёл ИИ».

В `src/services/aiRecognize.ts` завести рядом с `SOURCE_NAME` предикат:

```ts
/** Каталоги — обычное дозаполнение; модель участвует только в веб-ступенях. */
const FROM_AI = (via: string | null): boolean =>
  // у веб-ступени ключ варианта с номером: web#1, web#2 …
  Boolean(via && (via.startsWith('web') || via.startsWith('neuro')))
```

Заменить `if (hit.via !== 'sources')` в `applyRecognition` (строка 1120) на `if (FROM_AI(hit.via))`, а в `backfillAiQueue` (строка 1694) — `rows.filter((row) => row.via !== 'sources')` на `rows.filter((row) => FROM_AI(row.via))`.

Записи, сделанные до M32, хранят в `via` старые значения (`sources`, `model`, `web-extract`, `web-generative`). Для них предикат вернёт `false` — они и так уже стоят в очереди с прошлого раза, повторно ставить не нужно.

- [ ] **Шаг 10: Подчинить FantLab настройкам в поиске по названию**

В `src/services/titleSearch.ts:206-217` в `searchByTitle` перед вызовом внешнего источника добавить проверку:

```ts
export async function searchByTitle(
  userId: string,
  query: string,
): Promise<TitleSearchResult> {
  const trimmed = query.trim()
  if (trimmed.length < 3) return { mine: [], reference: [], external: [] }

  const [mine, reference] = await Promise.all([
    searchMine(userId, trimmed),
    searchReference(trimmed),
  ])
  // внешний источник спрашиваем, только если он включён в настройках:
  // выключенный FantLab не должен отвечать в обход списка источников
  const { isEnabled } = await import('./bookSources')
  const external = (await isEnabled('fantlab'))
    ? await searchFantlab(trimmed)
    : []
```

- [ ] **Шаг 11: Подчинить поиск обложек настройкам**

В `src/services/covers.ts:283-303` в `searchCoversForBook` добавить проверку перед расходом:

```ts
const { isEnabled } = await import('@/services/bookSources')
if (!(await isEnabled('neuro'))) {
  throw new AppError(
    'Поиск обложек выключен в настройках источников',
    'invalid',
  )
}
```

- [ ] **Шаг 12: Снять `NODE_ENV === 'test'` из боевых клиентов**

Удалить строки-заглушки:

- `src/services/metadata/googleBooks.ts:59` и `:113`
- `src/services/metadata/fantlab.ts:139`
- `src/services/metadata/openLibrary.ts:44`
- `src/services/titleSearch.ts:164`
- `src/services/webSearch.ts:402` и `:441`

Тесты в сеть больше не пойдут: они подставляют адаптеры через `options.adapters`. Если после снятия какой-то тест полез наружу — значит эта ветка не переехала на ядро, и её надо переводить, а не возвращать заглушку.

- [ ] **Шаг 13: Прогнать всё**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test && bun run lint`

Ожидается: PASS. Тесты `aiRecognize.test.ts` могли опираться на прежнее поведение (`via === 'sources'`, транслит, `nextVariant`) — их надо привести к новым именам ступеней (`fantlab`/`google` вместо общего `sources`), сохранив смысл проверки.

- [ ] **Шаг 14: Коммит**

```bash
git add src/services/ src/db/
git commit -m "M32: все точки входа зовут одно ядро"
```

---

## Задача 9: Фоновая доигровка

Оборванная по бюджету цепочка доигрывается воркером — сканер не ждёт платных ступеней.

**Файлы:**

- Изменить: `src/db/schema/catalog.ts` (таблица `find_task`)
- Создать: миграция через `bun run db:generate`
- Создать: `src/services/find/queue.ts`
- Создать: `src/services/find/queue.test.ts`
- Изменить: `src/db/index.ts:119` (запуск воркера)

**Интерфейсы:**

- Потребляет: `findEdition` из `./core`; `applyDraftToBook` из `@/services/bookWriter`.
- Отдаёт наружу: `enqueueFind(bookId, userId, isbn13)`, `runNextFind()`, `startFindWorker()`.

- [ ] **Шаг 1: Завести таблицу задач**

В `src/db/schema/catalog.ts` рядом с `crawlTask` добавить:

```ts
/**
 * Доигровка оборванного поиска (M32).
 *
 * Сканер в быстром режиме показывает найденное бесплатными каталогами и идёт
 * дальше, а платные ступени доигрывает воркер — человек над стопкой книг не
 * ждёт по минуте на каждую.
 */
export const findTask = sqliteTable(
  'find_task',
  {
    id: id(),
    bookId: text('book_id')
      .notNull()
      .references(() => book.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    isbn13: text('isbn13').notNull(),
    status: text('status', { enum: ['pending', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    scheduledAt: integer('scheduled_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    doneAt: integer('done_at', { mode: 'timestamp' }),
    error: text('error'),
  },
  (t) => [uniqueIndex('find_task_book').on(t.bookId)],
)
```

- [ ] **Шаг 2: Сгенерировать и прочитать миграцию**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run db:generate`

Прочитать сгенерированный SQL глазами: ожидается `CREATE TABLE find_task` + `CREATE UNIQUE INDEX find_task_book`. Пересоздания соседних таблиц быть не должно.

- [ ] **Шаг 3: Написать падающий тест очереди**

Создать `src/services/find/queue.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, test } from 'bun:test'

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
import type { SourceAdapter, SourceKey } from './types'

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
    await runNextFind({ adapters: ADAPTERS })
    const [row] = await db.select().from(book).where(eq(book.id, created.id))
    expect(row?.title).toBe('Зона')
    expect(row?.unrecognized).toBe(false)
  })

  test('выполненная задача закрывается', async () => {
    const created = await makeBook()
    await enqueueFind(created.id, ME, ISBN)
    await runNextFind({ adapters: ADAPTERS })
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
        probe: async () => {
          throw new Error('всё сломалось')
        },
      },
    }
    await expect(runNextFind({ adapters: broken })).resolves.toBeUndefined()
  })
})
```

- [ ] **Шаг 4: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/find/queue.test.ts`

Ожидается: FAIL — `Cannot find module './queue'`.

- [ ] **Шаг 5: Написать очередь и воркер**

Создать `src/services/find/queue.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm'

import { db } from '@/db'
import { book, findTask } from '@/db/schema/catalog'
import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import { applyDraftToBook } from '@/services/bookWriter'
import { findEdition } from './core'
import { FULL_BUDGET_MS } from './types'
import type { FindOptions } from './types'

/**
 * Доигровка оборванного поиска (M32).
 *
 * В быстром режиме сканирования цепочка обрывается по бюджету, не дойдя до
 * платных ступеней. Книга сохраняется тем, что нашли каталоги, а остаток
 * доигрывает воркер — и сам дописывает карточку. Функция поиска при этом одна
 * и та же: меняется только то, кто её вызывает.
 */

const TICK_MS = 30_000
const MAX_ATTEMPTS = 3

export async function enqueueFind(
  bookId: string,
  userId: string,
  isbn13: string,
): Promise<void> {
  await db
    .insert(findTask)
    .values({ bookId, userId, isbn13 })
    // одна задача на книгу: повторное сканирование не плодит очередь
    .onConflictDoNothing()
  log.info('find', 'книга поставлена на доигровку', { bookId, isbn: isbn13 })
}

export async function runNextFind(options: FindOptions = {}): Promise<void> {
  const [task] = await db
    .select()
    .from(findTask)
    .where(eq(findTask.status, 'pending'))
    .orderBy(asc(findTask.scheduledAt))
    .limit(1)
  if (!task) return

  const attempts = task.attempts + 1
  try {
    const found = await findEdition(task.userId, task.isbn13, {
      ...options,
      budgetMs: FULL_BUDGET_MS,
    })
    if (found.draft.title) {
      // «только пустое»: пока задача ждала, человек мог заполнить карточку сам
      await applyDraftToBook(task.bookId, found.draft, {
        mode: 'fill',
        userId: task.userId,
      })
    }
    await db
      .update(findTask)
      .set({ status: 'done', attempts, doneAt: new Date() })
      .where(eq(findTask.id, task.id))
    log.info('find', 'доигровка закончена', {
      bookId: task.bookId,
      isbn: task.isbn13,
      title: found.draft.title ?? 'ничего',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(findTask)
      .set({
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        error: message,
      })
      .where(eq(findTask.id, task.id))
    log.error('find', 'доигровка не удалась', {
      bookId: task.bookId,
      isbn: task.isbn13,
      attempt: attempts,
      error: error instanceof Error ? error : new Error(message),
    })
  }
}

declare global {
  var __polkaFindWorkerStarted: boolean | undefined
}

/** Запуск воркера: одна инстанция на процесс, guard от dev-перезагрузок. */
export function startFindWorker(): void {
  if (env.CRAWL_ENABLED !== '1') {
    log.info('find', 'воркер доигровки выключен (CRAWL_ENABLED != 1)')
    return
  }
  if (globalThis.__polkaFindWorkerStarted) return
  globalThis.__polkaFindWorkerStarted = true
  log.info('find', 'воркер доигровки запущен', { tickMs: TICK_MS })

  const tick = async () => {
    try {
      await runNextFind()
    } catch (error) {
      // воркер не должен ронять процесс, но и молчать ему нельзя
      log.error('find', 'тик воркера упал', {
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), TICK_MS)
  }, 15_000)
}
```

Примечание к `and`: импорт понадобится, только если появится фильтр по числу попыток; если `bun run lint` ругается на неиспользуемый импорт — убрать его.

- [ ] **Шаг 6: Запустить воркер вместе с приложением**

В `src/db/index.ts:119` рядом с запуском краулера добавить:

```ts
      import('@/services/find/queue').then((m) => m.startFindWorker()),
```

- [ ] **Шаг 7: Убедиться, что тесты проходят**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test`

Ожидается: PASS — 5 новых тестов очереди, прежние не сломаны.

- [ ] **Шаг 8: Коммит**

```bash
git add src/services/find/queue.ts src/services/find/queue.test.ts src/db/
git commit -m "M32: платные ступени доигрываются фоном"
```

---

## Задача 10: Режим сканирования и отчёт источников

Человек выбирает, ждать ли полного поиска. Плюс на «Добавить» появляется тот же отчёт по источникам, что есть в разборе.

**Файлы:**

- Изменить: `src/server/lookup.ts`
- Изменить: `src/routes/_app/add.tsx`
- Изменить: `docs/ux-ui-guideline.md` (раздел «Мобильные паттерны»)

**Интерфейсы:**

- Потребляет: `lookupIsbn(userId, rawIsbn, options)`; `enqueueFind` из `@/services/find/queue`; `QUICK_BUDGET_MS`, `FULL_BUDGET_MS` из `@/services/find/types`.

- [ ] **Шаг 1: Принять режим в серверной функции**

Заменить содержимое `src/server/lookup.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { lookupIsbn } from '@/services/metadata/lookup'
import { FULL_BUDGET_MS, QUICK_BUDGET_MS } from '@/services/find/types'
import { authMiddleware } from './middleware'

/**
 * Режим — это только бюджет времени, а не другая цепочка: «быстро» успевает
 * бесплатные каталоги, «подробно» проходит список до конца.
 */
export const lookupIsbnFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .validator(
    z.object({
      isbn: z.string(),
      depth: z.enum(['quick', 'full']).optional(),
    }),
  )
  .handler(({ context, data }) =>
    lookupIsbn(context.user.id, data.isbn, {
      budgetMs: data.depth === 'full' ? FULL_BUDGET_MS : QUICK_BUDGET_MS,
    }),
  )
```

- [ ] **Шаг 2: Ставить книгу на доигровку при сохранении**

В `src/server/books.ts` в схему `bookInput` (строка 22) добавить поле:

```ts
  /** Цепочку оборвал бюджет — остаток доиграет воркер (M32). */
  truncated: z.boolean().optional(),
```

`createBook` возвращает только `{ id }`, поэтому номер берём из входа, а не из
ответа. Заменить однострочный обработчик `createBookFn` (строки 54–57) на:

```ts
export const createBookFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(bookInput)
  .handler(async ({ context, data }) => {
    const { truncated, ...input } = data
    const created = await createBook(context.user.id, input)
    // остаток цепочки доиграет воркер и сам допишет карточку
    if (truncated && input.isbn13?.trim()) {
      const { enqueueFind } = await import('@/services/find/queue')
      await enqueueFind(created.id, context.user.id, input.isbn13.trim())
    }
    return created
  })
```

`truncated` в `BookInput` не добавляем: это признак хода поиска, а не поле
книги — сервис о нём знать не должен.

- [ ] **Шаг 3: Добавить выбор режима на экран «Добавить»**

В `src/routes/_app/add.tsx`:

Рядом с `DEST_KEY` (строка 28) добавить ключ хранения:

```ts
const DEPTH_KEY = 'polka.add.depth'
type Depth = 'quick' | 'full'
```

Рядом с прочими `useState` добавить состояние с липким значением:

```ts
const [depth, setDepth] = useState<Depth>('quick')
useEffect(() => {
  const stored = localStorage.getItem(DEPTH_KEY)
  if (stored === 'quick' || stored === 'full') setDepth(stored)
}, [])
```

В `runLookup` (строка 83) передать режим и запомнить `truncated`:

```ts
const result = await lookupIsbnFn({ data: { isbn, depth } })
```

и добавить `depth` в массив зависимостей `useCallback`.

Под выбором «Складываю в…» вывести сегмент режима и ленту цепочки — **строго по макету `docs/design/add-search.html`**, он же описан в разделе «Лента цепочки» гайдлайна. Разметку и классы брать из макета; ниже — только каркас состояния:

```tsx
      <SectionLabel>Как ищу</SectionLabel>
      <div className="flex gap-0.5 rounded-full border bg-background p-1">
        {(
          [
            ['quick', 'Стопкой'],
            ['full', 'По одной'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setDepth(value)
              localStorage.setItem(DEPTH_KEY, value)
            }}
            className={cn(
              'min-h-11 flex-1 rounded-full text-sm font-semibold',
              depth === value
                ? 'bg-foreground text-background'
                : 'text-muted-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {depth === 'quick'
          ? 'Не жду: показываю, что нашлось в каталогах. Остальное дособеру сам.'
          : 'Ищу до конца, вплоть до интернета. Дольше, зато карточка сразу целиком.'}
      </p>
```

Названия режимов — «Стопкой» и «По одной», а не «Быстро» и «Подробно»: человек выбирает то, что делает, а не устройство поиска. Слов «бюджет» и «цепочка» в интерфейсе быть не должно.

- [ ] **Шаг 4: Передать признак оборванной цепочки при сохранении**

В `src/routes/_app/add.tsx:131` в функции `save` дополнить вход книги:

```ts
const { id } = await createBookFn({
  data: { ...toBookInput(draft), truncated: lookup?.truncated ?? false },
})
```

- [ ] **Шаг 5: Показать ленту цепочки**

Отчёт по источникам — не строка через точки, а лента из макета `docs/design/add-search.html`: список источников в порядке цепочки, линия слева (сплошная там, где шли, точечная — куда не пошли), штамп только у события. Вынести в отдельный компонент, он понадобится и на «Не распознано»:

**Создать `src/components/book/SearchChain.tsx`** — разметку, классы и правила брать из макета. Контракт:

```tsx
export function SearchChain({
  probes,
  truncated,
}: {
  probes: Array<{ name: string; outcome: string; detail: string | null }>
  truncated: boolean
}) {
  // …разметка по макету: <ol> со строками, точка + имя + исход
}
```

Когда книга нашлась, лента сворачивается: вместо списка — строка «Нашли: FantLab, Google Books» и кнопка «Как искали», раскрывающая ленту. Хорошая новость должна быть короткой — экран отдан книге.

Если цепочка оборвана (`truncated`), под лентой — строка «Сохраним по номеру — карточка дополнится сама».

Заодно убрать импорт `SOURCE_LABEL` из `@/services/metadata/types` (строка 19)
и его использование: он знает только четыре старых источника
(`manual`/`fantlab`/`google`/`openlibrary`), а `lookup.probes` теперь приходит
с человеческими именами всех шести ступеней уже готовыми. Проверить, что
`bun run lint` не оставил неиспользуемых импортов.

- [ ] **Шаг 6: Сверить с гайдлайном**

Раздел «Лента цепочки: как показывать поиск (M32)» в `docs/ux-ui-guideline.md` уже написан вместе с макетом. Пройти по нему и убедиться, что реализация ему следует: порядок строк равен порядку из настроек, «не дошли» кодируется формой точки и линии (а не бледностью — иначе контраст уходит ниже AA), штамп стоит только у «нашёл» и у отказа источника, время ответа показано только у ответивших.

- [ ] **Шаг 7: Проверить руками**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun run typecheck && bun test && bun run dev`

Открыть `/add`, проверить: переключатель виден и переживает перезагрузку страницы; ввод ISBN в режиме «Быстро» отвечает за секунды; отчёт по источникам виден под черновиком; сохранение книги в режиме «Быстро» с ненайденным номером ставит задачу (`select * from find_task` в `data/polka.db`).

- [ ] **Шаг 8: Коммит**

```bash
git add src/routes/_app/add.tsx src/server/ docs/ux-ui-guideline.md
git commit -m "M32: режим поиска выбирает человек, отчёт источников виден при добавлении"
```

---

## Задача 11: Документация

Требование 6. Отдельный документ на подсистему + правки в сквозных документах.

**Файлы:**

- Создать: `docs/search.md`
- Изменить: `docs/architecture.md` (разделы «Метаданные по ISBN», «Источники книг», «Журнал», «Тестирование», «Подводные камни»)
- Изменить: `docs/roadmap.md` (строка этапа M32 и его проверка)

- [ ] **Шаг 1: Написать `docs/search.md`**

Создать документ со следующими разделами (содержание — из фактического кода, а не из этого плана: план к моменту написания уже исполнен):

1. **Зачем один поиск** — что было до M32: четыре ветки (`lookupIsbn`, `recognizeIsbn`, `retryLookup`, `proposeForBook`), разный результат по одному номеру, веб-поиск не работал при сканировании.
2. **Цепочка** — таблица ступеней: ключ, что умеет, платная ли, таймаут, чем подтверждается находка. Отдельно — правило лесенки: платная ступень не спрашивается, если бесплатная уже дала годный ответ.
3. **Кто что решает** — `resolveChain(userId)` решает состав и порядок; `merge` решает, чьи данные победят; бюджет решает, докуда дойти. Зашитых порядков в коде нет.
   3а. **Слабые находки** — что такое `weak`, почему транслит (`Deti-bilingvy` вместо «Дети-билингвы») не останавливает цепочку, но возвращается, если больше нечего вернуть.
4. **Бюджет времени и режимы** — `QUICK_BUDGET_MS` / `FULL_BUDGET_MS`, почему глубина — это число, а не список источников; что такое `truncated` и кто доигрывает.
5. **Устойчивость** — правило «ни одна ступень не роняет поиск», `safely`, запрет глухих `catch {}`.
6. **Журнал** — scope `find`, корреляционный id, что пишется на каждом уровне, как прочитать один поиск целиком: `grep 'find=abc123' /data/logs/polka.log`.
7. **Кэш** — отпечаток цепочки, почему оборванная цепочка не кэшируется, TTL.
8. **Точки входа** — таблица: экран → функция → бюджет.
9. **Как добавить источник** — пошагово: адаптер в `adapters.ts`, ключ в `SourceKey`, строка в `SOURCES`, тест.
10. **Как это тестируется** — подстановка `options.adapters`, почему `NODE_ENV`-заглушек в боевом коде больше нет.

- [ ] **Шаг 2: Обновить `docs/architecture.md`**

- Раздел «Метаданные по ISBN» (строки 149–159): заменить описание алгоритма на ссылку `см. docs/search.md` + короткую сводку в три предложения. Таблицу источников оставить.
- Раздел «Источники книг: список = цепочка (M30)» (строки 338–355): дописать, что с M32 порядок влияет и на приоритет полей, а не только на очередь опроса; убрать `model` из перечня ключей.
- Раздел «Журнал приложения» (строка 214): дописать про scope `find` и корреляционный id.
- Раздел «Тестирование» (строки 370–374): обновить число тестов (посчитать по факту прогона) и дописать, что источники подставляются, а `NODE_ENV`-заглушек в боевом коде нет.
- Раздел «Подводные камни»: добавить пункт 9 — «Кэш без отпечатка настроек лжёт: выключенный источник продолжает отвечать из кэша. Ключ кэша обязан включать состав и порядок цепочки».

- [ ] **Шаг 3: Обновить `docs/roadmap.md`**

В таблицу этапов после строки M27 добавить:

```markdown
| M32 | Единый поиск изданий: одно ядро, порядок из настроек, устойчивость, журнал | ✅ 2026-08-XX (дата коммита) |
```

В раздел «Проверки этапов» добавить:

```markdown
- **M32** ✔ Одна книга ищется одинаково из «Добавить», «Не распознано» и карточки. Выключенный в «Источниках» Google не спрашивается нигде, включая добор обложек; поднятый над FantLab — даёт название. Отключение сети на сервере не роняет ни один экран: поиск возвращает отчёт «источник: ошибка». В `/data/logs/polka.log` один поиск читается целиком по `find=<id>`, у каждой ступени свой уровень. Сканирование стопки в режиме «Быстро» не ждёт платных ступеней, карточки дополняются сами в течение минуты.
```

- [ ] **Шаг 4: Проверить документацию на соответствие коду**

Пройти по `docs/search.md` и сверить каждое имя функции, файла и константы с кодом: `grep -n "findEdition\|resolveChain\|QUICK_BUDGET_MS\|FULL_BUDGET_MS\|chainFingerprint" src/services/find/*.ts`. Расхождения — исправить в документе.

- [ ] **Шаг 5: Коммит**

```bash
git add docs/
git commit -m "docs: единый поиск изданий (M32)"
```

---

## Самопроверка плана

**Покрытие требований владельца:**

| Требование                                      | Где закрыто                                                                                                                                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Уникальность — одна функция из разных частей | Задача 7 (ядро), задача 8 (переезд всех четырёх точек входа + единый писатель карточки)                                                                                                                                                      |
| 2. Соответствие настройкам — состав и порядок   | Задача 3 (`resolveChain`), задача 5 (порядок решает приоритет полей), задача 8 шаги 9–10 (`titleSearch`, `covers`)                                                                                                                           |
| 3. Поиск не роняет приложение                   | Задача 2 (`safely`), задача 7 (каждая ступень обёрнута), задача 9 (воркер не роняет процесс)                                                                                                                                                 |
| 4. Winston: info / warn / error                 | Задача 1 (`trace`), задача 2 (warn на отказе ступени), задача 7 (info на ход дела, error на незаписанный кэш), задача 9 (error на упавшую задачу)                                                                                            |
| 5. Мои варианты                                 | Кэш с отпечатком настроек (задача 6), общий бюджет времени (задача 1), отчёт источников в «Добавить» (задача 10), тестируемость через подстановку адаптеров (задачи 3–9), мёртвый ключ `model` (задача 3), три зашитых приоритета (задача 5) |

**Сохранённое поведение, которое легко потерять при рефакторинге:**

- Лесенка: платная ступень не спрашивается, если бесплатная уже дала годный ответ (задача 7, тест «нашлось бесплатно — за платное не платим»).
- Транслит из каталога не считается ответом — коммит `01ad992` (задачи 4–5, поле `weak` и порядок в `mergeFindings`).
- Приёмка веб-находки только по номеру в тексте страницы — M26 (задача 4, `readFromWeb`).
- Находка каталогов не помечается «заполнил ИИ» и не идёт в очередь модератора — M30 (`applyRecognition` продолжает смотреть на `hit.via`; после переезда `via` — это ключ ступени, поэтому условие `hit.via !== 'sources'` заменить на проверку «ступень платная»: `!['reference','fantlab','google','openlibrary'].includes(hit.via ?? '')`).
- Ступени «спросить модель по памяти» нет — M30.1 (в `SourceKey` ключа `model` больше нет вовсе).
  | 6. Документация в `docs/` | Задача 11 |

**Согласованность имён:** `findEdition`, `resolveChain`, `mergeFindings`, `chainFingerprint`, `readCache`/`writeCache`, `enrichDraft`, `safely`, `startTrace`, `deadline`, `applyDraftToBook`, `enqueueFind`/`runNextFind`/`startFindWorker` — каждое объявляется ровно в одной задаче и используется в последующих под тем же именем. `SourceKey` определён в `find/types.ts` и реэкспортируется из `bookSources.ts`.

**Что этот план сознательно не делает:**

- Не трогает `moderation`, `crawl`, `reference` дальше, чем нужно для снятия зашитого приоритета.
- Не реализует пейвол Нейропоиска: в коде остаётся только `userId` в сигнатуре `resolveChain` и комментарий, что решение «спрашивать ли источник» принимается там.
- Не переписывает интерфейс «Не распознано» и карточки книги: `recognizeIsbn` сохраняет прежнюю форму ответа, поэтому UI остаётся на месте. Вариантов в нём становится больше (`web#1`…`web#3`), но листаются они тем же кодом.
- Не даёт Нейропоиску несколько вариантов: он остаётся одной находкой и выключенным по умолчанию. Генеративный ответ по номеру малополезен — ISBN модель не помнит.
- Не вводит FTS5 и не трогает текстовый поиск по своему каталогу — это другая подсистема (`services/search.ts`).
