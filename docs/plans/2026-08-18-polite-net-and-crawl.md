# Вежливая сеть и живой краулер — план реализации (M33)

> **Для исполнителя-агента:** ОБЯЗАТЕЛЬНЫЙ СУБ-НАВЫК — `superpowers:subagent-driven-development` (рекомендуется) либо `superpowers:executing-plans`. Задачи выполняются по одной, шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** вынести политику вежливости к внешним API в один сетевой слой, починить фоновый краулер (он умеет обновляться, не берёт задачу дважды и не врёт в журнал), добавить Wikidata + Википедию как источник по авторам, которых FantLab не знает, и показать очередь наполнения в «Настройках».

**Архитектура:** новая подсистема `src/services/net/` — единственное место, где живёт `fetch` наружу: политика по хостам, очередь с приоритетом (интерактив вперёд фона), соблюдение `Retry-After`, карантин хоста, условные запросы. Краулер `src/services/crawl.ts` (416 строк, один файл) разбирается на `src/services/crawl/`: чистые парсеры отдельно от сети и от записи в базу — как уже сделано в `services/metadata/`. Источники автора становятся списком адаптеров с приоритетом полей, а не двумя `if`-ветками.

**Стек:** TypeScript 6 strict, Bun 1.3, Drizzle ORM 0.45.2 (только core-запросы), zod 4, Winston 3, `bun test`.

**Порядок:** этап идёт **после M32** (`docs/plans/2026-08-18-unified-search.md`) — так решил владелец. Задача 1 (сетевой слой) ни от чего в M32 не зависит; если M32 затянется, её можно поднять вперёд отдельным коммитом, остальные задачи опираются на неё.

---

## Контекст: что не так сегодня

### Нагрузка на источники

Сам краулер вежлив до предела: один тик в 75–90 с, одна задача за тик, один запрос к FantLab на задачу (плюс фото через паузу 4–6.5 с). Потолок ≈ 1150 запросов в сутки, фактически на порядок меньше — в боевой базе 21 задача. Это меньше, чем один человек, листающий сайт.

**Нагрузку создаёт не он.** Политика вежливости написана внутри краулера, а мимо него ходят три пути без единого ограничителя:

1. `fetchWorkEditions` (`src/services/reference.ts:417`) вызывается при открытии страницы произведения — `void fetchWorkEditionsFn(...)` в `src/routes/_app/works.$workId.tsx:35`. Один запрос к API + **до 12 скачиваний обложек подряд с паузой 400 мс**, прямо внутри пользовательского POST. Десять произведений подряд — ~130 запросов к fantlab.ru за минуту, в сто раз больше, чем весь краулер за то же время.
2. `retryLookup` (`src/services/unrecognized.ts:107`) — цикл по произвольному списку книг, каждая книга это `Promise.allSettled` по трём каталогам. Сто книг = 300 запросов встык без единой паузы.
3. Отрицательные ответы `lookupIsbn` **не кэшируются** (`src/services/metadata/lookup.ts:131` — `if (merged.sources.length > 0)`). «Не распознано» — это ровно то множество ISBN, которые всегда мимо; каждое «Найти снова» опрашивает все три источника заново.

**`Retry-After` не читается нигде** (ноль совпадений по репозиторию). В краулере 429 попадает в общую ветку `!res.ok` → `null` → «пустой ответ» → бэкоф 6 часов (случайно вежливо, но причина теряется). А `src/services/metadata/googleBooks.ts:64-76` на 429 повторяет ещё дважды через 400 и 800 мс — это ровно то, чего делать нельзя.

**User-Agent непоследователен.** Общий `POLKA_USER_AGENT` с контактом существует (`src/services/userAgent.ts`) и заведён после реального инцидента — но три запроса к FantLab в `src/services/metadata/fantlab.ts` (:141, :152, :161) идут вообще без него, как и пробы в `src/services/sources.ts` (:113, :173) и оба запроса Google Books. Для FantLab, у которого API в режиме «test mode» без SLA, анонимный клиент — худшее, что можно предъявить.

### Покрытие

`author.openlibraryId` **не пишется ни одной строкой кода** — колонка есть, читается в `crawl.ts:102` и `:263`, но `set({ openlibraryId })` нет нигде. Значит `crawlOpenlibraryAuthor` (46 строк) недостижим, второй скан таблицы каждые 75 секунд всегда пуст, а обещанный в `docs/product.md:219` фолбэк «для авторов, которых FantLab не знает» не существует. Отсюда и вся картина: библиография есть только у фантастов.

`author.fantlabId` тоже проставляется в единственном месте — `src/services/authors.ts:69-77`, только когда пользователь сохраняет книгу и имя автора совпало после нормализации. Авторы, пришедшие через эталон (`persistLookup`, `adoptExternalWork`), для постановщика невидимы навсегда.

### Обновляемость

Сделанная задача — `done` навсегда; unique-индекс `(kind, source, author_id)` не даёт вставить вторую. Новые публикации автора не появятся никогда. Перекрауливание делали SQL-миграциями (`drizzle/0010_repending-crawl.sql`, `drizzle/0012_repending-cycles.sql`). Упавшие задачи лежат мёртвым грузом и не видны нигде: `grep crawlTask src/routes` пуст.

### Журнал

Инфраструктура хорошая: Winston, четыре уровня, scope, структурные поля, ротация, перехват падений и отказов промисов (`src/lib/logger.ts`). Сам `crawl.ts` логирует прилично — 12 вызовов, везде `ms`. Плохо другое:

- **Наблюдаемость обрывается на границе модуля.** Всё, что краулер зовёт, глушит ошибки: `covers.ts:170,206,230,265` — четыре `catch {}` с `return null`; `metadata/fantlab.ts:167,172,180`; `metadata/openLibrary.ts:66,72`; `reference.ts:443` — `.catch(() => null)`. Скачивание фото автора провалилось по таймауту — в журнале **ни строчки**, а задача пишет «выполнена».
- В полях есть `author: authorRow.name` и нет `authorId`/`taskId`: двух однофамильцев не различить, конкретную задачу не найти грепом.
- `ensureCrawlTasks` не пишет, сколько задач поставил; глубина очереди не видна нигде.
- В `crawl_task.error` всегда ложится бесполезное «fantlab: пустой ответ» — статус ответа известен в `fetchJson` на строке 50 и теряется к строке 370.
- На уровне `info` (умолчание в проде) не видно, какие URL дёргались — это только `debug`.

### Дублирование

| Что                                | Где                                                                            | Чем плохо                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `NON_WORK_TYPES`                   | `crawl.ts:22` и `metadata/fantlab.ts:66`                                       | Одно имя, **разный состав**: восемь терминов расходятся. Одна и та же строка типа классифицируется по-разному в зависимости от пути          |
| Год из строки                      | `crawl.ts:145` (`yearOf`) и `metadata/types.ts:38` (`yearFrom`)                | Одинаковый регэксп, разные имена и null-ность. `crawl.ts:10` уже импортирует из этого файла                                                  |
| Скачать картинку → webp            | `covers.ts:176-209` и `covers.ts:236-268`                                      | Два почти идентичных блока по 33 строки; разница — папка, размер, качество. Плюс третий частичный `saveCover` и три близнеца-валидатора пути |
| Ретрай на 5xx                      | `googleBooks.ts:64` и `googleBooks.ts:140` (в одном файле!) и `sources.ts:105` | Три копии, `RETRY_STATUS` объявлен дважды, обобщённый `fetchRetry` никем не используется                                                     |
| `fetch` + таймаут + UA + `.json()` | 8 рукописных копий                                                             | Таймауты 4/6/7/8/10/12 с без объяснения разницы                                                                                              |
| Маппер ответа FantLab              | `crawl.ts:157`, `metadata/fantlab.ts:69`, `reference.ts:444`                   | Три обхода одной формы `Record<string, { list?: [] }>`, ни одного общего типа                                                                |
| Вставка `refBook` из черновика     | `reference.ts:78` и `reference.ts:501` (+ третий в `aiRecognize.ts`)           | 14 одинаковых полей                                                                                                                          |
| Предикат `accessible`              | 6+ копий; в `authors.ts:129` и `:203` — **другая** вторая ветка                | Молчаливое расхождение в контроле доступа                                                                                                    |

### Баги

Порядок — по последствиям.

1. **Сетевой сбой навсегда хоронит издания произведения.** `reference.ts:443` глушит ошибку в `null`, тело `if (data)` пропускается, но `reference.ts:551` **всё равно** ставит `editionsFetchedAt`. Вход рано выходит по `editionsFetchedAt !== null` (`:423`) — один двенадцатисекундный таймаут, и у произведения навсегда пустой список изданий. В журнале ничего.
2. **Задача не помечается взятой.** `setInterval(() => void tick(), ...)` не ждёт `tick`, а `runNextTask` выбирает по `status='pending'` без лизинга. Тик длиннее интервала — и два тика берут одну задачу, удвоив трафик к тому самому источнику, который модуль обещает щадить.
3. **Джиттер вычисляется один раз.** `crawl.ts:411`: `Math.random()` в аргументе `setInterval` считается в момент создания — интервал фиксирован на всю жизнь процесса. Комментарий на `:16-17` обещает «паузы с джиттером».
4. **`ensureRefWork` не может дозаполнить `workType`.** `reference.ts:157`: `where(and(eq(id, ...), sql`year is null`))` при `set({ workType })` — произведение, заведённое с годом и без типа, тип уже не получит никогда.
5. **`ensureCrawlTasks` — полный скан таблицы дважды за тик, вечно, плюс N+1 вставки** (`crawl.ts:76-117`), хотя работа идемпотентна и сходится после первого прогона.
6. **Дети циклов минуют фильтр типов** (`flattenCycle` не фильтрует) и безусловно приписываются краулимому автору (`crawl.ts:250`) — в межавторских циклах чужие книги попадают в библиографию. `linkWorkAuthor` к тому же зашивает `position: 0`.
7. **`null` подставляется в URL**: `crawl.ts:158` интерполирует `fantlabId: number | null` без проверки, `:263` даёт `.../authors/undefined.json`. Ответ 404 → автор навсегда «нет в источнике».
8. **`authorRefUpdatedAt`** (`reference.ts:288`) показывает дату создания самого нового произведения, а не дату наполнения: `refWork.fetchedAt` ставится только при вставке и никогда не обновляется.
9. **Гонка при вставке `refBook`**: `reference.ts:99` и `:521` — `onConflictDoNothing().returning()` даёт пусто, `refBookId` становится `undefined`, строка молча пропускается вместе со связью и обложкой.
10. **`probeSources` не сохраняет результат**, пока админ не сохранит ключ Google: `sources.ts:215` — UPDATE по строке, которую создаёт только `saveSourceSettings`.
11. **`export { refWorkAuthor }`** (`crawl.ts:416`) — мёртвый реэкспорт, ради которого файл импортирует символ схемы.
12. Таймеры не сохраняются и не `unref()`-ятся: остановить краулер нельзя, на `SIGTERM` процесс выходит через 150 мс посреди задачи.

### Что решено

- Wikidata (CC0, атрибуция не нужна) — структурные факты; вводный абзац ru.wikipedia (CC BY-SA) — биография, **обязательно со ссылкой на статью и лицензию** рядом с текстом.
- Модель в фоне: отдельный системный суточный бюджет, **по умолчанию выключен**; людской лимит не трогаем.
- Разбор раздела «Библиография» из статьи моделью в этот этап не входит — сознательно отложено.
- Страница «Настройки → Наполнение» с счётчиками, ошибками и кнопками нужна; макет — по принятому процессу, в `docs/design/`.

---

## Глобальные ограничения

Действуют во всех задачах без повторения.

- **Язык кода:** комментарии, сообщения об ошибках и тексты журнала — по-русски. Идентификаторы — по-английски.
- **Слои:** вся логика в `src/services/`, серверные функции в `src/server/` тонкие (auth + валидация + вызов сервиса). Логику в `createServerFn` не заворачивать (`docs/ts-guideline.md`, п. 15).
- **Импорты:** внутри подсистемы — относительные (`./policy`); наружу — алиасы (`@/db`, `@/lib/logger`).
- **Запуск команд:** перед любой командой `bun` — `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"`.
- **Проверки только через `&&`**, никогда через пайп: `bun run typecheck && bun test`. Пайп маскирует код возврата (`architecture.md`, подводный камень №7).
- **Миграции** генерируются `bun run db:generate` и **читаются глазами** перед коммитом (подводный камень №2).
- **Тесты не ходят в сеть.** Сеть подставляется параметром (`options.transport`), а не проверкой `NODE_ENV`.
- **Границы данных — zod** (`ts-guideline.md`, п. 16). Ответы внешних API разбираются схемой, а не приводятся через `as`.
- **Уровни журнала:** `info` — ход дела (взяли задачу, источник ответил, записали N произведений); `warn` — не получилось, но работа продолжается (источник молчит, хост в карантине, фото не скачалось); `error` — сломалось то, что ломаться не должно (упал воркер, не записалась база). Scope: `net` у сетевого слоя, `crawl` у краулера.
- **Коммит после каждой задачи**, сообщение по-русски в стиле репозитория («M33: …»).

---

## Карта файлов

Новое — `src/services/net/`:

| Файл         | Ответственность                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`   | `HostPolicy`, `NetOptions`, `NetError`, `Priority`. Логики нет                                                                                               |
| `policy.ts`  | Таблица политик по хостам — единственное место, где записано «как часто можно»                                                                               |
| `limiter.ts` | Очередь на хост: два приоритета, минимальный интервал, потолок параллельности, карантин. Часы и сон инжектируются — модуль тестируется без реального времени |
| `cache.ts`   | Условные запросы: `ETag`/`Last-Modified` в таблице `http_cache`, разбор 304                                                                                  |
| `client.ts`  | `getJson(url, schema, opts)` и `getBytes(url, opts)` — единственная дверь наружу: UA, таймаут, ретраи, `Retry-After`, журнал                                 |
| `*.test.ts`  | Лимитер на фальшивых часах, разбор `Retry-After`, карантин, 304                                                                                              |

Новое — `src/services/crawl/` (вместо файла `src/services/crawl.ts`):

| Файл            | Ответственность                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `types.ts`      | `AuthorFacts`, `WorkRef`, `CycleRef`, `AuthorSource`                                                                  |
| `queue.ts`      | Постановщик, выбор задачи с лизингом, бэкоф, TTL обновления                                                           |
| `worker.ts`     | Тик, запуск/останов, `CRAWL_ENABLED`                                                                                  |
| `fantlab.ts`    | Чистые парсеры `/autor/{id}/extended` + адаптер                                                                       |
| `wiki.ts`       | Wikidata (поиск, сущность) + Википедия (вводный абзац)                                                                |
| `apply.ts`      | Единственное место, которое пишет факты автора в базу: приоритет источников, не затирать непустое                     |
| `*.test.ts`     | Парсеры на записанных фикстурах, матчер Wikidata, приоритет полей                                                     |
| `__fixtures__/` | Записанные ответы: `wikidata-search-dovlatov.json`, `wikidata-entity-Q311516.json`, `wikipedia-summary-dovlatov.json` |

Правится существующее:

| Файл                                                                               | Что меняется                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/schema/catalog.ts`                                                         | `author`: `wikidataId`, `wikipediaUrl`, `bioSource`. `crawl_task`: статус `running`, `startedAt`, новые `kind`/`source`. Новая `http_cache` |
| `src/db/schema/moderation.ts`                                                      | `ai_setting`: `systemEnabled`, `systemDailyLimit`. Новая `ai_system_usage`                                                                  |
| `src/services/metadata/{fantlab,googleBooks,openLibrary}.ts`                       | Сеть — через `net/client`; три копии ретрая уходят; UA появляется везде                                                                     |
| `src/services/{titleSearch,covers,sources,reference}.ts`                           | То же; `fetchRetry` удаляется                                                                                                               |
| `src/services/find/adapters.ts` (из M32)                                           | Обёртки зовут клиентов, которые уже ходят через `net` — правка на несколько строк                                                           |
| `src/services/reference.ts`                                                        | Баги 1, 4, 8, 9; `fantlabId`/`wikidataId` проставляются и здесь                                                                             |
| `src/services/metadata/lookup.ts`                                                  | Кэшировать отрицательный ответ                                                                                                              |
| `src/services/unrecognized.ts`                                                     | `retryLookup` — потолок пачки и фоновый приоритет                                                                                           |
| `src/services/authors.ts`                                                          | Отдать `accessible` в общий хелпер, чинить расхождение                                                                                      |
| `src/services/ai.ts`                                                               | Транспорт отделяется от лимита; появляется `askSystem`                                                                                      |
| `src/services/covers.ts`                                                           | Один `saveImageFromUrl`, один валидатор пути                                                                                                |
| `src/db/index.ts`                                                                  | Запуск воркера выносится из-под `existsSync(migrationsFolder)`                                                                              |
| `src/routes/_app/service.tsx` + новый `service_.crawl.tsx` + `src/server/crawl.ts` | Страница «Наполнение»                                                                                                                       |
| `docs/{architecture,product,roadmap}.md`, `docs/design/crawl.html`, `.env.example` | Документация                                                                                                                                |

---

## Задача 1: Сетевой слой — политика по хостам и лимитер

Ядро этапа. Ни от чего не зависит; всё остальное на неё опирается.

**Файлы:**

- Создать: `src/services/net/types.ts`, `src/services/net/policy.ts`, `src/services/net/limiter.ts`, `src/services/net/limiter.test.ts`

**Интерфейсы:**

- Отдаёт наружу: `HostPolicy`, `policyFor(url): HostPolicy`, `createLimiter(deps): Limiter`, `limiter` (общий экземпляр), `Limiter.run<T>(url, priority, task): Promise<T>`, `Limiter.quarantine(host, untilMs, reason)`, `Limiter.stats()`.

- [ ] **Шаг 1: Написать падающий тест лимитера**

Создать `src/services/net/limiter.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'

import { createLimiter } from './limiter'

/** Фальшивые часы: время двигаем руками, сон мгновенный. */
function fakeClock() {
  let now = 0
  const waiters: Array<{ at: number; resolve: () => void }> = []
  return {
    now: () => now,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => waiters.push({ at: now + ms, resolve })),
    async advance(ms: number) {
      now += ms
      const due = waiters.filter((w) => w.at <= now)
      waiters.length = 0
      waiters.push(...waiters.filter((w) => w.at > now))
      for (const w of due) w.resolve()
      await Promise.resolve()
    },
  }
}

describe('лимитер запросов', () => {
  test('второй запрос к тому же хосту ждёт минимальный интервал', async () => {
    const clock = fakeClock()
    const limiter = createLimiter({ now: clock.now, sleep: clock.sleep })
    const done: Array<number> = []
    const url = 'https://api.fantlab.ru/autor/1/extended'

    void limiter.run(url, 'background', async () => done.push(clock.now()))
    void limiter.run(url, 'background', async () => done.push(clock.now()))
    await clock.advance(0)
    expect(done).toEqual([0])

    await clock.advance(3000)
    expect(done.length).toBe(2)
    expect(done[1]).toBeGreaterThanOrEqual(3000)
  })

  test('интерактивный запрос идёт вперёд фонового', async () => {
    const clock = fakeClock()
    const limiter = createLimiter({ now: clock.now, sleep: clock.sleep })
    const order: Array<string> = []
    const url = 'https://api.fantlab.ru/work/1'

    void limiter.run(url, 'background', async () => order.push('первый'))
    await clock.advance(0)
    void limiter.run(url, 'background', async () => order.push('фон'))
    void limiter.run(url, 'interactive', async () => order.push('человек'))
    await clock.advance(10_000)

    expect(order).toEqual(['первый', 'человек', 'фон'])
  })

  test('карантин отбивает запросы сразу, не занимая очередь', async () => {
    const clock = fakeClock()
    const limiter = createLimiter({ now: clock.now, sleep: clock.sleep })
    limiter.quarantine('api.fantlab.ru', 60_000, '429')

    await expect(
      limiter.run('https://api.fantlab.ru/x', 'interactive', async () => 1),
    ).rejects.toThrow(/карантин/)
  })

  test('после карантина хост снова доступен', async () => {
    const clock = fakeClock()
    const limiter = createLimiter({ now: clock.now, sleep: clock.sleep })
    limiter.quarantine('api.fantlab.ru', 60_000, '429')
    await clock.advance(60_001)
    await expect(
      limiter.run('https://api.fantlab.ru/x', 'interactive', async () => 42),
    ).resolves.toBe(42)
  })
})
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/net/limiter.test.ts`

Ожидается: FAIL — `Cannot find module './limiter'`.

- [ ] **Шаг 3: Типы**

Создать `src/services/net/types.ts`:

```ts
/** Приоритет: человек ждёт ответа прямо сейчас — или это фоновая работа. */
export type Priority = 'interactive' | 'background'

export interface HostPolicy {
  /** Минимальный промежуток между запросами к хосту, мс. */
  minIntervalMs: number
  /** Сколько запросов к хосту допустимо держать в полёте одновременно. */
  maxConcurrent: number
  /** Таймаут запроса по умолчанию, мс. */
  timeoutMs: number
  /** Хост отдаёт ETag/Last-Modified — есть смысл в условных запросах. */
  conditional: boolean
  /** Понятное имя для журнала и страницы «Наполнение». */
  label: string
}

/** Ожидаемый сетевой отказ: сообщение годится и для журнала, и для админки. */
export class NetError extends Error {
  constructor(
    message: string,
    public readonly kind:
      'quarantined' | 'timeout' | 'status' | 'transport' | 'shape',
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'NetError'
  }
}
```

- [ ] **Шаг 4: Политики хостов**

Создать `src/services/net/policy.ts`:

```ts
import type { HostPolicy } from './types'

/**
 * Сколько можно просить у каждого источника.
 *
 * Единственное место, где это записано. Цифры взяты с большим запасом вниз:
 * платных тарифов у этих API нет, сервера держат энтузиасты, и наши задачи
 * никуда не спешат. FantLab к тому же в режиме «test mode» без SLA.
 */
const POLICIES: Record<string, HostPolicy> = {
  'api.fantlab.ru': {
    minIntervalMs: 3000,
    maxConcurrent: 1,
    timeoutMs: 12_000,
    conditional: false,
    label: 'FantLab API',
  },
  'fantlab.ru': {
    minIntervalMs: 1500,
    maxConcurrent: 1,
    timeoutMs: 10_000,
    conditional: false,
    label: 'FantLab (картинки)',
  },
  // документация OpenLibrary разрешает до 3 rps с честным User-Agent — берём 1
  'openlibrary.org': {
    minIntervalMs: 1000,
    maxConcurrent: 1,
    timeoutMs: 6000,
    conditional: true,
    label: 'OpenLibrary',
  },
  'covers.openlibrary.org': {
    minIntervalMs: 1000,
    maxConcurrent: 1,
    timeoutMs: 10_000,
    conditional: true,
    label: 'OpenLibrary (обложки)',
  },
  'www.wikidata.org': {
    minIntervalMs: 1000,
    maxConcurrent: 1,
    timeoutMs: 8000,
    conditional: true,
    label: 'Wikidata',
  },
  'ru.wikipedia.org': {
    minIntervalMs: 1000,
    maxConcurrent: 1,
    timeoutMs: 8000,
    conditional: true,
    label: 'Википедия',
  },
  'commons.wikimedia.org': {
    minIntervalMs: 1000,
    maxConcurrent: 1,
    timeoutMs: 10_000,
    conditional: true,
    label: 'Wikimedia Commons',
  },
  // здесь платный ключ с оплаченной квотой — щадить нечего, но и лавину не льём
  'www.googleapis.com': {
    minIntervalMs: 200,
    maxConcurrent: 4,
    timeoutMs: 6000,
    conditional: false,
    label: 'Google Books',
  },
}

const DEFAULT: HostPolicy = {
  minIntervalMs: 1000,
  maxConcurrent: 2,
  timeoutMs: 8000,
  conditional: false,
  label: 'прочее',
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'неизвестный-хост'
  }
}

export function policyFor(url: string): HostPolicy {
  return POLICIES[hostOf(url)] ?? DEFAULT
}

export const KNOWN_HOSTS = Object.keys(POLICIES)
```

- [ ] **Шаг 5: Лимитер**

Создать `src/services/net/limiter.ts`. Ключевые решения: на хост — две очереди (интерактив забирается первым), счётчик занятых слотов, отметка времени последнего старта; карантин проверяется до постановки в очередь, чтобы не копить хвост к мёртвому хосту.

```ts
import { log } from '@/lib/logger'
import { hostOf, policyFor } from './policy'
import { NetError } from './types'
import type { Priority } from './types'

interface Deps {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

interface HostState {
  lastStartedAt: number
  inFlight: number
  quarantineUntil: number
  waiting: { interactive: Array<() => void>; background: Array<() => void> }
}

export interface Limiter {
  run<T>(url: string, priority: Priority, task: () => Promise<T>): Promise<T>
  quarantine(host: string, ms: number, reason: string): void
  isQuarantined(host: string): boolean
  stats(): Array<{ host: string; waiting: number; quarantinedForMs: number }>
}

export function createLimiter(deps: Deps): Limiter {
  const hosts = new Map<string, HostState>()

  const stateOf = (host: string): HostState => {
    let s = hosts.get(host)
    if (!s) {
      s = {
        lastStartedAt: -Infinity,
        inFlight: 0,
        quarantineUntil: 0,
        waiting: { interactive: [], background: [] },
      }
      hosts.set(host, s)
    }
    return s
  }

  /** Пропускаем следующего: интерактив всегда вперёд фона. */
  const wake = (s: HostState): void => {
    const next = s.waiting.interactive.shift() ?? s.waiting.background.shift()
    next?.()
  }

  async function acquire(host: string, priority: Priority): Promise<void> {
    const policy = policyFor(`https://${host}`)
    const s = stateOf(host)
    for (;;) {
      const now = deps.now()
      const idle = now - s.lastStartedAt
      if (s.inFlight < policy.maxConcurrent && idle >= policy.minIntervalMs) {
        s.inFlight++
        s.lastStartedAt = now
        return
      }
      if (s.inFlight >= policy.maxConcurrent) {
        // ждём, пока освободится слот — разбудит release()
        await new Promise<void>((r) => s.waiting[priority].push(r))
        continue
      }
      await deps.sleep(policy.minIntervalMs - idle)
    }
  }

  const release = (host: string): void => {
    const s = stateOf(host)
    s.inFlight = Math.max(0, s.inFlight - 1)
    wake(s)
  }

  return {
    async run(url, priority, task) {
      const host = hostOf(url)
      const s = stateOf(host)
      if (deps.now() < s.quarantineUntil) {
        const left = Math.round((s.quarantineUntil - deps.now()) / 1000)
        throw new NetError(`${host}: карантин ещё ${left} с`, 'quarantined')
      }
      await acquire(host, priority)
      try {
        return await task()
      } finally {
        release(host)
      }
    },
    quarantine(host, ms, reason) {
      const s = stateOf(host)
      const until = deps.now() + ms
      if (until <= s.quarantineUntil) return
      s.quarantineUntil = until
      log.warn('net', 'источник отправлен в карантин', {
        host,
        forSec: Math.round(ms / 1000),
        reason,
      })
    },
    isQuarantined(host) {
      return deps.now() < stateOf(host).quarantineUntil
    },
    stats() {
      return [...hosts.entries()].map(([host, s]) => ({
        host,
        waiting: s.waiting.interactive.length + s.waiting.background.length,
        quarantinedForMs: Math.max(0, s.quarantineUntil - deps.now()),
      }))
    },
  }
}

declare global {
  var __polkaLimiter: Limiter | undefined
}

/** Один экземпляр на процесс: серверная точка входа и бандл — разные графы. */
export const limiter = (globalThis.__polkaLimiter ??= createLimiter({
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}))
```

- [ ] **Шаг 6: Прогнать тест**

Выполнить: `export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"; bun test src/services/net/limiter.test.ts`

Ожидается: PASS, 4 теста.

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/net
git commit -m "M33: лимитер запросов к внешним источникам"
```

---

## Задача 2: Клиент — единый User-Agent, Retry-After, условные запросы

**Файлы:**

- Создать: `src/services/net/cache.ts`, `src/services/net/client.ts`, `src/services/net/client.test.ts`
- Изменить: `src/db/schema/catalog.ts` (таблица `http_cache`)

**Интерфейсы:**

- Потребляет: `limiter`, `policyFor` (задача 1); `POLKA_USER_AGENT` из `@/services/userAgent`.
- Отдаёт наружу: `getJson<T>(url, schema: z.ZodType<T>, opts?): Promise<T>`, `getBytes(url, opts?): Promise<ArrayBuffer>`, `parseRetryAfter(header, now): number | null`. `opts`: `{ priority?, timeoutMs?, headers?, transport? }` — `transport` подменяет `fetch` в тестах.

- [ ] **Шаг 1: Таблица условного кэша**

В `src/db/schema/catalog.ts` рядом с `crawlTask` добавить:

```ts
/** Условные запросы: помним ETag и тело, чтобы 304 не стоил источнику ничего. */
export const httpCache = sqliteTable('http_cache', {
  url: text('url').primaryKey(),
  etag: text('etag'),
  lastModified: text('last_modified'),
  body: text('body').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})
```

Сгенерировать миграцию (`bun run db:generate`), прочитать SQL глазами.

- [ ] **Шаг 2: Тест разбора `Retry-After` и поведения на 429**

Создать `src/services/net/client.test.ts` с тестами: `parseRetryAfter('120', now)` → 120000; `parseRetryAfter(<HTTP-дата +30с>, now)` ≈ 30000; `parseRetryAfter('мусор', now)` → null. И тест на `getJson` с подставным `transport`, отдающим 429 с `Retry-After: 5` — ожидается `NetError` с `kind: 'status'` и хост в карантине (`limiter.isQuarantined('...') === true`), **без повторной попытки**.

- [ ] **Шаг 3: Клиент**

Создать `src/services/net/client.ts`. Здесь собрана вся политика вежливости — важна каждая ветка, поэтому она приведена целиком:

```ts
import { log } from '@/lib/logger'
import { POLKA_USER_AGENT } from '@/services/userAgent'
import { readCache, writeCache } from './cache'
import { limiter } from './limiter'
import { hostOf, policyFor } from './policy'
import { NetError } from './types'
import type { Priority } from './types'
import type { z } from 'zod'

/** Повторяем только «сервер моргнул». 429 и 503 — это отказ, а не помеха. */
const RETRY_STATUS = new Set([500, 502, 504])
const RETRIES = 2
/** Сколько держать хост в карантине, если Retry-After не прислали. */
const QUARANTINE_STEPS = [60_000, 300_000, 1_800_000, 3_600_000]

export interface NetOptions {
  priority?: Priority
  timeoutMs?: number
  headers?: Record<string, string>
  /** Подмена fetch в тестах — наружу подсистема не ходит. */
  transport?: typeof fetch
}

/** `Retry-After` бывает числом секунд и HTTP-датой. Мусор — это null. */
export function parseRetryAfter(
  header: string | null,
  now: number,
): number | null {
  if (!header) return null
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const at = Date.parse(header)
  return Number.isFinite(at) && at > now ? at - now : null
}

const quarantineHits = new Map<string, number>()

function punish(host: string, res: Response): never {
  const wait =
    parseRetryAfter(res.headers.get('retry-after'), Date.now()) ??
    QUARANTINE_STEPS[
      Math.min(quarantineHits.get(host) ?? 0, QUARANTINE_STEPS.length - 1)
    ]!
  quarantineHits.set(host, (quarantineHits.get(host) ?? 0) + 1)
  limiter.quarantine(host, wait, `HTTP ${res.status}`)
  throw new NetError(
    `${host} ответил ${res.status} — ждём ${Math.round(wait / 1000)} с`,
    'status',
    res.status,
  )
}

async function once(
  url: string,
  opts: NetOptions,
  extraHeaders: Record<string, string>,
): Promise<Response> {
  const policy = policyFor(url)
  const doFetch = opts.transport ?? fetch
  try {
    return await doFetch(url, {
      headers: {
        // единый и честный: контакт внутри, строго ASCII (см. userAgent.ts)
        'User-Agent': POLKA_USER_AGENT,
        ...extraHeaders,
        ...opts.headers,
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? policy.timeoutMs),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    throw new NetError(
      `${hostOf(url)}: ${timedOut ? 'не ответил вовремя' : 'запрос не удался'}`,
      timedOut ? 'timeout' : 'transport',
    )
  }
}

/** Текст ответа с соблюдением всех правил; условный кэш — по политике хоста. */
async function fetchText(url: string, opts: NetOptions): Promise<string> {
  const host = hostOf(url)
  const policy = policyFor(url)
  const priority = opts.priority ?? 'background'

  return limiter.run(url, priority, async () => {
    const cached = policy.conditional ? await readCache(url) : null
    const conditional: Record<string, string> = {}
    if (cached?.etag) conditional['If-None-Match'] = cached.etag
    if (cached?.lastModified)
      conditional['If-Modified-Since'] = cached.lastModified

    let lastError: NetError | null = null
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      const started = performance.now()
      let res: Response
      try {
        res = await once(url, opts, conditional)
      } catch (error) {
        lastError = error as NetError
        if (attempt === RETRIES) break
        await sleepBackoff(attempt)
        continue
      }
      const ms = Math.round(performance.now() - started)

      if (res.status === 304 && cached) {
        log.debug('net', 'ответ не изменился', { host, url, ms })
        await writeCache(url, cached.etag, cached.lastModified, cached.body)
        return cached.body
      }
      if (res.status === 429 || res.status === 503) {
        log.warn('net', 'источник просит подождать', {
          host,
          url,
          status: res.status,
          ms,
        })
        punish(host, res)
      }
      if (RETRY_STATUS.has(res.status) && attempt < RETRIES) {
        log.warn('net', 'источник моргнул, повторяем', {
          host,
          url,
          status: res.status,
          ms,
        })
        await sleepBackoff(attempt)
        continue
      }
      if (!res.ok) {
        log.warn('net', 'источник ответил ошибкой', {
          host,
          url,
          status: res.status,
          ms,
        })
        throw new NetError(
          `${host} ответил ${res.status}`,
          'status',
          res.status,
        )
      }

      quarantineHits.delete(host)
      const body = await res.text()
      log.debug('net', 'ответ получен', { host, url, ms, bytes: body.length })
      if (policy.conditional) {
        await writeCache(
          url,
          res.headers.get('etag'),
          res.headers.get('last-modified'),
          body,
        )
      }
      return body
    }
    throw lastError ?? new NetError(`${host}: нет ответа`, 'transport')
  })
}

/** Бэкоф с джиттером: 1 с, 3 с (±25 %). */
const sleepBackoff = (attempt: number): Promise<void> => {
  const base = attempt === 0 ? 1000 : 3000
  const jitter = base * 0.25 * (Math.random() * 2 - 1)
  return new Promise((r) => setTimeout(r, base + jitter))
}

/** Единственная дверь за JSON: форма ответа проверяется схемой, не приведением. */
export async function getJson<T>(
  url: string,
  schema: z.ZodType<T>,
  opts: NetOptions = {},
): Promise<T> {
  const text = await fetchText(url, opts)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new NetError(`${hostOf(url)}: ответ не разбирается как JSON`, 'shape')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    log.warn('net', 'ответ источника не той формы', {
      host: hostOf(url),
      url,
      issue: parsed.error.issues[0]?.message,
    })
    throw new NetError(`${hostOf(url)}: ответ не той формы`, 'shape')
  }
  return parsed.data
}

/** Картинки: те же очередь и карантин, но без разбора и без кэша тел. */
export async function getBytes(
  url: string,
  opts: NetOptions = {},
): Promise<ArrayBuffer> {
  return limiter.run(url, opts.priority ?? 'background', async () => {
    const res = await once(url, opts, {})
    if (res.status === 429 || res.status === 503) punish(hostOf(url), res)
    if (!res.ok)
      throw new NetError(
        `${hostOf(url)} ответил ${res.status}`,
        'status',
        res.status,
      )
    return res.arrayBuffer()
  })
}
```

Что здесь важно и почему:

- `POLKA_USER_AGENT` уходит **всегда** — тест из задачи 3 стережёт, чтобы мимо этого файла никто не ходил.
- **429 и 503 не повторяются никогда.** Это отказ по лимиту, и повтор через 400 мс (как сегодня в `googleBooks.ts`) делает источнику только хуже. Вместо повтора — карантин ровно на `Retry-After`, а при его отсутствии по нарастающей: минута, пять, полчаса, час.
- `500/502/504` — «сервер моргнул», два повтора с бэкофом и джиттером. `sources.ts` сегодня спит даже после последней попытки — здесь нет.
- `404` доезжает до вызывающего как `NetError` со статусом: краулер сам решает, что «нет в источнике» — это не поломка.
- Тело разбирается `schema.safeParse` — ни одного `as` (`ts-guideline.md`, п. 16). Сегодня на пути краулера восемь непроверенных приведений.
- Удачный ответ снимает счётчик карантина: хост, который починился, не тащит за собой прошлые грехи.

- [ ] **Шаг 4: Прогнать тесты** — `bun test src/services/net/`. Ожидается PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/services/net src/db/schema/catalog.ts drizzle
git commit -m "M33: единый сетевой клиент — вежливый агент, Retry-After, условные запросы"
```

---

## Задача 3: Перевести все внешние вызовы на сетевой слой

Механическая, но самая полезная задача: после неё политика вежливости одна на всё приложение.

**Файлы (изменить):** `src/services/metadata/{fantlab,googleBooks,openLibrary}.ts`, `src/services/titleSearch.ts`, `src/services/covers.ts`, `src/services/sources.ts`, `src/services/reference.ts`, `src/services/find/adapters.ts` (из M32), `src/services/crawl.ts`

- [ ] **Шаг 1: Тест-сторож на User-Agent**

Расширить `src/services/userAgent.test.ts`: пройти `grep`-ом (через `Bun.Glob` по `src/services/**/*.ts`) и убедиться, что вне `src/services/net/` не осталось ни одного вызова `fetch(` — кроме белого списка (`webSearch.ts`, `ai.ts` — платные API Яндекса со своей авторизацией, их переводим в задаче 9). Тест падает, пока переезд не закончен, и не даёт завести девятую копию политики потом.

- [ ] **Шаг 2: Убедиться, что тест падает** — `bun test src/services/userAgent.test.ts`, ожидается FAIL со списком файлов.

- [ ] **Шаг 3: Перевести клиенты метаданных**

В `metadata/fantlab.ts`, `metadata/openLibrary.ts`, `metadata/googleBooks.ts`: заменить рукописные `fetch` на `getJson(url, schema, { priority: 'interactive' })`. Схемы zod пишутся по уже существующим `interface` в этих файлах (`SearchMatch`, `OlBook` и т. п.) — форма известна, менять её не нужно. Удалить: обе копии цикла ретрая в `googleBooks.ts` (:64-76 и :140-151), обе константы `RETRY_STATUS`, все проверки `process.env.NODE_ENV === 'test'` (герметичность теперь даёт `opts.transport`).

- [ ] **Шаг 4: Перевести остальных** — `titleSearch.ts:168`, `covers.ts:62/181/241` (через `getBytes`), `sources.ts:113/173` (удалить `fetchRetry` целиком), `reference.ts:437`, `crawl.ts:39` (`fetchJson` удаляется). В `find/adapters.ts` (M32) правок почти нет — адаптеры зовут те же клиенты.

- [ ] **Шаг 5: Приоритеты по местам вызова**

`priority: 'background'` — краулер, `retryLookup`, догрузка обложек. `priority: 'interactive'` — всё, что вызвано нажатием: `lookupIsbn`, `searchByTitle`, `probeSources`, `fetchWorkEditions`, `recognizeIsbn`.

- [ ] **Шаг 6: Прогнать всё** — `bun run typecheck && bun test`. Ожидается PASS, включая сторожа из шага 1.

- [ ] **Шаг 7: Коммит**

```bash
git add src/services
git commit -m "M33: все внешние запросы идут через один вежливый клиент"
```

---

## Задача 4: Убрать дубли вокруг краулера

**Файлы:** `src/services/metadata/fantlab.ts`, `src/services/metadata/types.ts`, `src/services/covers.ts`, `src/services/crawl.ts`, `src/services/members.ts`, `src/services/authors.ts`

- [ ] **Шаг 1: Тест на единый фильтр типов**

В `src/services/metadata/metadata.test.ts` добавить: `isNonWork('эссе')`, `isNonWork('указатель имён')`, `isNonWork('микрорассказ')` → `true`; `isNonWork('роман')`, `isNonWork('повесть')` → `false`. Список — объединение обеих сегодняшних регулярок.

- [ ] **Шаг 2: Убедиться, что тест падает.**

- [ ] **Шаг 3: Свести дубли**
  - `isNonWork` — один экспорт в `metadata/fantlab.ts`; обе локальные `NON_WORK_TYPES` удаляются.
  - `yearOf` из `crawl.ts` удаляется, используется `yearFrom` из `metadata/types.ts`. Заодно расширить регэксп до `(1[0-9]|20)\d{2}` — сегодняшний не берёт авторов раньше XV века.
  - `saveRefCoverFromUrl` и `saveAuthorPhotoFromUrl` сводятся к общему `saveImageFromUrl(url, { dir, name, width, height, quality })`; три валидатора пути — к одному `assetAbsolutePath(kind, relativePath)`.
  - Предикат «книга доступна пользователю» переезжает в `src/services/members.ts` как `accessibleBooks(userId)`; шесть копий заменяются вызовом. Расхождение в `authors.ts:129/203` разбирается отдельно: там нужен именно виш-лист — оставить как есть, но назвать `ownWishlistBooks(userId)`, чтобы отличие было видно из имени.
  - `export { refWorkAuthor }` (`crawl.ts:416`) и импорт ради него — удалить.

- [ ] **Шаг 4: Прогнать** — `bun run typecheck && bun test`. Ожидается PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add src/services
git commit -m "M33: один фильтр типов, один загрузчик картинок, один предикат доступа"
```

---

## Задача 5: Очередь — лизинг, обновляемость, честные ошибки

**Файлы:**

- Создать: `src/services/crawl/types.ts`, `src/services/crawl/queue.ts`, `src/services/crawl/queue.test.ts`
- Изменить: `src/db/schema/catalog.ts`

**Интерфейсы:**

- Отдаёт наружу: `ensureTasks(): Promise<number>`, `claimNext(): Promise<CrawlTask | null>`, `finishOk(taskId, refreshMs)`, `finishMissing(taskId)`, `finishFailed(taskId, error)`, `releaseStale(): Promise<number>`. Админские `queueStats()` и `retryFailed()` добавляются в задаче 10 — здесь их ещё нет.

- [ ] **Шаг 1: Схема**

В `crawl_task`: `status` расширяется до `['pending', 'running', 'done', 'failed']`; добавляется `startedAt: integer('started_at', { mode: 'timestamp' })`; `kind` — до `['author-bibliography', 'author-wiki']`; `source` — до `['fantlab', 'openlibrary', 'wikidata']`.

Смысл `scheduledAt` уточняется в комментарии: **«не раньше этого момента»** — и для первой попытки, и для бэкофа, и для планового обновления. Успешная задача переходит в `done` с `scheduledAt = now + REFRESH_MS`, а не в терминальное состояние.

В `author` добавляются `wikidataId` (частичный unique по not-null), `wikipediaUrl`, `bioSource`.

Сгенерировать миграцию, прочитать SQL глазами. В ту же миграцию — разовый `UPDATE crawl_task SET scheduled_at = unixepoch() WHERE status = 'done'`, чтобы существующие 15 авторов перекраулились по новой логике один раз.

- [ ] **Шаг 2: Тесты очереди**

Создать `src/services/crawl/queue.test.ts` на временной SQLite (по образцу `src/services/catalog.test.ts` — `DATA_DIR` в `mkdtemp` до импорта `@/db`):

- `claimNext` ставит `status='running'` и `startedAt`; повторный `claimNext` **не возвращает ту же задачу**;
- `releaseStale` возвращает в `pending` задачу, у которой `startedAt` старше аренды;
- `finishOk` ставит `done` и переносит `scheduledAt` на срок обновления; после сдвига часов задача снова выбирается;
- `finishFailed` на третьей попытке ставит `failed`; `retryFailed` возвращает их в `pending`;
- `ensureTasks` при повторном вызове возвращает 0 и не делает вставок.

- [ ] **Шаг 3: Убедиться, что тесты падают.**

- [ ] **Шаг 4: Реализовать `queue.ts`**

Что меняется по сравнению с сегодняшним `crawl.ts`:

- **Лизинг.** `claimNext` — `UPDATE crawl_task SET status='running', started_at=now WHERE id = (SELECT id FROM crawl_task WHERE ... ORDER BY scheduled_at LIMIT 1) RETURNING *`. Один запрос вместо SELECT-затем-UPDATE: два тика не возьмут одну строку.
- **Зависшие аренды.** `releaseStale()` возвращает в `pending` всё, что в `running` дольше `LEASE_MS` (15 минут) — процесс мог умереть посреди задачи.
- **Обновление.** `REFRESH_MS` по виду задачи: библиография — 90 дней, вики — 180 дней. `SourceMissing` закрывает задачу как `done` со сроком 180 дней, а не как `failed`: автора может не быть сегодня и появиться завтра, а «failed» — это про поломку, а не про отсутствие.
- **Постановщик не каждый тик.** `ensureTasks` вызывается раз в `ENSURE_EVERY_TICKS` (по умолчанию 40 — примерно раз в час) и делает **одну** батч-вставку вместо N. Возвращает число заведённых задач; воркер пишет его в журнал на `info`, когда оно не ноль.
- **Кандидаты.** Задачи заводятся для авторов, у которых есть хоть одна книга в каталоге, по трём правилам: `fantlabId != null` → `('author-bibliography','fantlab')`; всем без исключения → `('author-wiki','wikidata')`; ветка `openlibrary` не заводится, пока `openlibraryId` некому писать (см. задачу 8).
- **Ошибка сохраняется честно.** `finishFailed(taskId, error)` пишет в `crawl_task.error` текст `NetError` со статусом (`«FantLab ответил 503»`), а не «пустой ответ».

- [ ] **Шаг 5: Прогнать** — `bun test src/services/crawl/`. Ожидается PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add src/services/crawl src/db/schema/catalog.ts drizzle
git commit -m "M33: очередь наполнения — аренда задачи, плановое обновление, честная ошибка"
```

---

## Задача 6: FantLab-источник — чистые парсеры и запись фактов

**Файлы:**

- Создать: `src/services/crawl/fantlab.ts`, `src/services/crawl/apply.ts`, `src/services/crawl/fantlab.test.ts`
- Использовать фикстуру: `src/services/metadata/__fixtures__/openlibrary-author-OL182660A.json` как образец формата; записать новую `crawl/__fixtures__/fantlab-autor-extended.json`

**Интерфейсы:**

- Отдаёт наружу: `parseFantlabAuthor(json): AuthorFacts`, `fantlabAuthorSource: AuthorSource`, `applyAuthorFacts(authorId, facts, source)`.
- `AuthorFacts`: `{ bio?, birthYear?, deathYear?, country?, photoUrl?, works: Array<WorkRef>, cycles: Array<CycleRef> }`.

- [ ] **Шаг 1: Тесты парсера на фикстуре**

Проверяются ровно те места, где сегодня баги: BB-теги и HTML снимаются с биографии; годы жизни берутся из дат; произведения с типом из `isNonWork` отброшены; **дети циклов проходят тот же фильтр** (сегодня не проходят); цикл с одним ребёнком отброшен; позиции в цикле идут подряд без дыр после фильтрации.

- [ ] **Шаг 2: Убедиться, что тесты падают.**

- [ ] **Шаг 3: Разделить разбор и сеть**

`parseFantlabAuthor` — чистая функция от `unknown` к `AuthorFacts`, с zod-схемой на входе. `fantlabAuthorSource.fetch(author)` — один `getJson` через `net/client`, с проверкой `fantlabId != null` **до** сборки URL (баг 7: сегодня `null` уезжает в путь и возвращается 404).

- [ ] **Шаг 4: Единая запись фактов**

Создать `apply.ts` — единственное место, которое пишет `author`. Правила:

- Поле пишется, только если у нас пусто **или** источник приоритетнее нынешнего `bioSource`. Приоритет биографии: `fantlab` → `wikipedia` → `openlibrary` (FantLab пишет про фантастов подробнее и без лицензионных условий).
- Годы жизни и страна: непустое значение из более приоритетного источника перекрывает; пустое не затирает заполненное. Сегодня `crawl.ts:203` перезаписывает безусловно.
- Фото — только если его ещё нет.
- `patch` типизирован через `Partial<typeof author.$inferInsert>`, а не `Record<string, unknown>` (сегодня типы Drizzle выбрасываются).
- Провал скачивания фото логируется на `warn` со ссылкой — сегодня `covers.ts` глушит это молча, а задача рапортует «выполнена».

Записи произведений и циклов переезжают сюда же из `crawl.ts:206-254`; позиция соавтора в `linkWorkAuthor` перестаёт быть зашитым нулём, а дети межавторских циклов привязываются к автору **только если** FantLab указал его среди авторов узла (баг 6).

- [ ] **Шаг 5: Прогнать** — `bun test src/services/crawl/`. Ожидается PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add src/services/crawl
git commit -m "M33: FantLab-источник — разбор отдельно от сети, запись отдельно от разбора"
```

---

## Задача 7: Wikidata и Википедия — авторы, которых FantLab не знает

**Файлы:**

- Создать: `src/services/crawl/wiki.ts`, `src/services/crawl/wiki.test.ts`, фикстуры `crawl/__fixtures__/wikidata-search-*.json`, `wikidata-entity-*.json`, `wikipedia-summary-*.json`

**Интерфейсы:**

- Отдаёт наружу: `pickWikidataCandidate(candidates, hints): { id, score } | null`, `parseWikidataEntity(json): WikiFacts`, `wikiAuthorSource: AuthorSource`.
- `hints`: `{ name, birthYear?, deathYear?, workTitles: Array<string> }` — то, что мы уже знаем об авторе из своего каталога.

Два запроса на автора, оба бесплатные и явно предназначенные для такого использования:

1. `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=<имя>&language=ru&uselang=ru&type=item&limit=7&format=json` — отдаёт `label` и `description` («русский писатель, 1941—1990») по каждому кандидату.
2. `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q1|Q2|Q3&props=claims|sitelinks|labels&languages=ru|en&sitefilter=ruwiki&format=json` — до трёх кандидатов одним запросом.

Биография — третьим запросом, только если нашлась статья: `https://ru.wikipedia.org/api/rest_v1/page/summary/<title>` → поле `extract`, вводный абзац простым текстом.

- [ ] **Шаг 1: Тесты матчера**

Матчер — самое рискованное место, его и покрываем плотно:

- однофамильцы: «Александр Кузнецов»-писатель и «Александр Кузнецов»-хоккеист → выбран писатель;
- совпадение годов жизни с уже известными из FantLab добавляет уверенности;
- пересечение `P800` (известные работы) с названиями произведений из нашего эталона добавляет уверенности;
- **два кандидата с близкими баллами → `null`**: лучше без биографии, чем чужая;
- кандидат без `P31 = Q5` (человек) отброшен всегда.

Схема баллов: человек `+3`; занятие из писательского набора (`P106` ∈ {писатель, поэт, прозаик, драматург, романист, эссеист}) или писательское слово в описании `+3`; совпадение года рождения `+2`; совпадение года смерти `+2`; каждое пересечение `P800` с нашим каталогом `+2` (максимум `+4`); статья в ru.wikipedia `+1`. Порог — `5`; разрыв с вторым местом меньше `2` — отказ с записью `warn` в журнал и списком кандидатов.

- [ ] **Шаг 2: Убедиться, что тесты падают.**

- [ ] **Шаг 3: Разбор сущности**

`parseWikidataEntity` достаёт: `P569`/`P570` (даты — с учётом `precision`: точность грубее года игнорируется), `P27` (гражданство — Q-id), `P18` (файл на Commons → `https://commons.wikimedia.org/wiki/Special:FilePath/<file>?width=320`), `sitelinks.ruwiki.title`. Метка страны берётся отдельным `wbgetentities` по её Q-id — это самый частый повторяющийся запрос в этапе, и условный кэш из задачи 2 делает его почти бесплатным.

- [ ] **Шаг 4: Источник и атрибуция**

`wikiAuthorSource` собирает `AuthorFacts` и заполняет `author.wikipediaUrl` + `bioSource='wikipedia'`. **Текст Википедии — CC BY-SA**, поэтому запись биографии без `wikipediaUrl` запрещена на уровне `apply.ts`: если ссылки нет, био не пишется. Вывод ссылки на странице автора — шаг 5.

- [ ] **Шаг 5: Ссылка на странице автора**

В `src/routes/_app/authors.$authorId.tsx` под биографией — строка вида «Биография — из Википедии, CC BY-SA» со ссылкой на статью; показывается, только когда `bioSource === 'wikipedia'`.

- [ ] **Шаг 6: Прогнать** — `bun run typecheck && bun test`. Ожидается PASS.

- [ ] **Шаг 7: Коммит**

```bash
git add src/services/crawl src/routes/_app/authors.\$authorId.tsx
git commit -m "M33: Wikidata и Википедия — биография и даты для авторов вне фантастики"
```

---

## Задача 8: Воркер и связывание концов

**Файлы:**

- Создать: `src/services/crawl/worker.ts`, `src/services/crawl/index.ts`
- Удалить: `src/services/crawl.ts`
- Изменить: `src/db/index.ts`, `src/services/reference.ts`, `src/services/authors.ts`, `src/services/metadata/lookup.ts`, `src/services/unrecognized.ts`, `src/services/metadata/openLibrary.ts`

- [ ] **Шаг 1: Воркер**

`startCrawlWorker()` переезжает в `worker.ts` со следующими правками:

- Джиттер считается **на каждый тик**: вместо `setInterval` — самоперепланирующийся `setTimeout`, интервал `TICK_MS + Math.random() * 15_000` вычисляется заново (баг 3).
- Тики не наслаиваются: флаг `busy` — если предыдущий не закончил, тик пропускается с записью `debug`.
- Хендл таймера сохраняется, `unref()`-ится (как `startHeartbeat` в `logger.ts:202`), и на `SIGTERM` вызывается `stopCrawlWorker()`.
- В начале тика — `releaseStale()`.
- `ensureTasks()` — раз в `ENSURE_EVERY_TICKS` тиков.
- Все записи журнала получают `taskId` и `authorId` в дополнение к имени.
- Если хост в карантине, задача не берётся вовсе — она возвращается в `pending` со сроком «после карантина», и мы не тратим попытку.

- [ ] **Шаг 2: Запуск не зависит от папки миграций**

В `src/db/index.ts` вынести `background('запуск краулера', ...)` **из-под** `if (existsSync(migrationsFolder))` (баг 14). Заодно: `startCrawlWorker` возвращает `void` синхронно, поэтому «готово» в журнале означает «таймер поставлен» — переформулировать сообщение.

- [ ] **Шаг 3: Починить `reference.ts`**

- `editionsFetchedAt` ставится **только внутри `if (data)`** (баг 1). При сетевом сбое — `warn` в журнал и ранний возврат: произведение попробуют открыть ещё раз.
- `ensureRefWork`: условие `year is null` убирается из `where`, вместо этого `set` собирается из полей, которых сегодня нет (`COALESCE`-стиль) — баг 4.
- `refWork.fetchedAt` обновляется при каждом успешном наполнении, чтобы `authorRefUpdatedAt` перестал врать (баг 8).
- Оба места вставки `refBook` при конфликте **дочитывают** существующую строку вместо `continue` (баг 9).
- `persistLookup` и `adoptExternalWork` проставляют `author.fantlabId`, когда источник его дал (баг 11).

- [ ] **Шаг 4: Оживить OpenLibrary или убрать его**

`metadata/openLibrary.ts:33-37` уже вычисляет `authorKeys` и выбрасывает их на `:70`. Прокинуть их в `SourceResult`, а `persistLookup` — писать в `author.openlibraryId`. После этого `ensureTasks` заводит и `('author-bibliography','openlibrary')` для авторов без `fantlabId`, а `crawlOpenlibraryAuthor` переезжает в `crawl/openLibrary.ts` тем же адаптером, что и остальные, с пагинацией вместо зашитого `limit=100` (баг 9 из разбора).

- [ ] **Шаг 5: Кэшировать «не нашлось»**

`metadata/lookup.ts:131` — писать в `lookup_cache` и пустой результат, с коротким TTL (7 дней вместо 30). Это снимает главный источник повторной нагрузки: «Не распознано» перестаёт опрашивать все три каталога на каждое нажатие.

- [ ] **Шаг 6: Ограничить пачку `retryLookup`**

`unrecognized.ts:107` — потолок в 25 книг за вызов, `priority: 'background'`, и пауза между книгами не нужна: её теперь держит лимитер.

- [ ] **Шаг 7: Прогнать** — `bun run typecheck && bun test`. Ожидается PASS.

- [ ] **Шаг 8: Коммит**

```bash
git add src/services src/db
git commit -m "M33: воркер без наслоений, издания переживают сбой сети, «не нашлось» кэшируется"
```

---

## Задача 9: Системный бюджет модели

Инфраструктура под будущие фоновые ИИ-функции и под необязательный разрешатель однофамильцев. **По умолчанию выключено.**

**Файлы:** `src/db/schema/moderation.ts`, `src/services/ai.ts`, `src/services/crawl/wiki.ts`, `src/routes/_app/service_.ai.tsx`, `src/server/ai.ts`

- [ ] **Шаг 1: Схема** — в `ai_setting` добавить `systemEnabled` (default `false`) и `systemDailyLimit` (default `50`); новая таблица `ai_system_usage(day PK, calls, tokens)`. Отдельная таблица нужна потому, что `ai_usage.userId` — внешний ключ на `user`, а у фона пользователя нет.

- [ ] **Шаг 2: Разделить транспорт и лимит** — из `ask(userId, prompt)` выделяется `callModel(prompt)` (только сеть, через `net/client`); `ask` остаётся обёрткой с людским лимитом, рядом появляется `askSystem(prompt)` с системным. Дублирования транспорта не возникает — это и есть смысл правки.

- [ ] **Шаг 3: Применение** — в `pickWikidataCandidate` при отказе по близким баллам и включённом `systemEnabled` задаётся один вопрос модели: описания кандидатов + названия наших книг этого автора → какой Q-id. Ответ принимается, только если он есть среди кандидатов. Выключено — работает детерминированный отказ, и это нормальный режим.

- [ ] **Шаг 4: Настройка в UI** — в «Настройки → ИИ» переключатель «Разрешить модели работать в фоне» и поле суточного лимита, рядом — расход за день.

- [ ] **Шаг 5: Прогнать и закоммитить**

```bash
git add src/db src/services src/routes src/server
git commit -m "M33: у фоновых задач свой лимит модели, по умолчанию выключен"
```

---

## Задача 10: Страница «Настройки → Наполнение»

**Файлы:**

- Создать: `docs/design/crawl.html`, `src/routes/_app/service_.crawl.tsx`, `src/server/crawl.ts`
- Изменить: `src/routes/_app/service.tsx`, `src/services/crawl/queue.ts`

- [ ] **Шаг 1: Макет** — `docs/design/crawl.html` по образцу `docs/design/sources.html`: токены из `docs/design/tokens.css`, мобильная ширина, разделы как в `ux-ui-guideline.md`. Показать: счётчики по статусам, срок следующего обновления, список последних ошибок, состояние хостов (в карантине / свободен), кнопки «Повторить упавшие» и «Обновить сейчас» у автора. Владелец апрувит макет до кода — так заведено в репозитории.

- [ ] **Шаг 2: Сервисный слой** — в `queue.ts` добавить `queueStats()` (счётчики, ближайшее обновление, последние 10 ошибок с именем автора и текстом) и `retryFailed()`; состояние хостов берётся из `limiter.stats()`.

- [ ] **Шаг 3: Серверные функции** — `src/server/crawl.ts`: `crawlStatsFn` (GET) и `retryFailedCrawlFn` (POST), обе через `authMiddleware` + `requireAdmin` — ровно по образцу `src/server/sources.ts`.

- [ ] **Шаг 4: Страница и строка в списке** — `service_.crawl.tsx` по образцу `service_.sources.tsx` (хлебные крошки, `SectionLabel`, `Drawer` для деталей ошибки). В `service.tsx` — строка «Наполнение» в разделе «Откуда берутся данные», с состоянием: «в очереди N» / «всё обновлено» / «упало N».

- [ ] **Шаг 5: Проверить вживую** — `bun run dev`, открыть `/service/crawl` с телефона, нажать «Повторить упавшие», убедиться, что счётчики сходятся с `select status, count(*) from crawl_task group by status`.

- [ ] **Шаг 6: Коммит**

```bash
git add docs/design/crawl.html src/routes src/server src/services/crawl
git commit -m "M33: очередь наполнения видна в настройках"
```

---

## Задача 11: Документация

**Файлы:** `docs/architecture.md`, `docs/product.md`, `docs/roadmap.md`, `.env.example`, `README.md`

- [ ] **Шаг 1: `architecture.md`** — новый раздел «Вежливая сеть и фоновое наполнение (M33)» после «Источники книг: список = цепочка (M30)»:
  - таблица политик по хостам (та же, что в `net/policy.ts`) — чтобы цифры были видны без чтения кода;
  - правило «наружу ходим только через `services/net`», перечень приоритетов;
  - `Retry-After` и карантин: почему на 429 не ретраим;
  - конечный автомат `crawl_task` с новым `running` и смыслом `scheduledAt`;
  - источники фактов об авторе и приоритет полей;
  - **лицензии**: Wikidata CC0, текст Википедии CC BY-SA со ссылкой — это требование, а не примечание;
  - в таблицу схемы БД — `http_cache`, `ai_system_usage`, новые колонки `author` и `crawl_task`;
  - в таблицу переменных окружения — `CRAWL_ENABLED` уже есть; убрать `REGISTRATION_OPEN`, которого в коде нет.
  - в «Подводные камни» — два новых пункта: «`editionsFetchedAt` ставился и при сетевом сбое» и «`setInterval` без аренды задачи брал одну строку дважды».

- [ ] **Шаг 2: `product.md`** — раздел M15 привести в соответствие с реальностью (обещаны три источника и кнопка «Обновить» — теперь они есть; убрать обещание «не чаще раза в N месяцев» в пользу конкретных сроков) и добавить раздел M33: что видит человек (биографии у нефантастов, ссылка на Википедию, страница «Наполнение»).

- [ ] **Шаг 3: `roadmap.md`** — догнать отставание: M28, M30, M30.1, M31 есть в коде, но не в таблице. Добавить строки M32 и M33 с проверками этапа:
  - **M33** ✔ Открыть десять произведений подряд — в журнале видно, что запросы к fantlab.ru идут не чаще одного в три секунды; у автора-нефантаста через сутки появилась биография со ссылкой на Википедию; страница «Наполнение» показывает очередь, «Повторить упавшие» работает; выключение `CRAWL_ENABLED=0` останавливает фон и не мешает поиску по кнопке.

- [ ] **Шаг 4: `.env.example` и `README.md`** — дописать `CRAWL_ENABLED` и `LOG_LEVEL` (сегодня их там нет, и краулер в проде включён по умолчанию без видимого выключателя). В README — абзац про то, что смотреть на странице «Наполнение».

- [ ] **Шаг 5: Вычистить старое название раздела**

Раздел давно называется **«Настройки»**, но «Сервис» остался в двенадцати местах. Заменить везде (`«Сервис» → «Почта»` становится `«Настройки» → «Почта»` и так далее):

| Файл                                   | Строки                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `docs/architecture.md`                 | 210, 267                                                                         |
| `docs/product.md`                      | 322, 349, 386                                                                    |
| `docs/roadmap.md`                      | 31, 64, 68                                                                       |
| `README.md`                            | 39, 41                                                                           |
| `src/routes/_app/settings.tsx`         | 34 (комментарий «в „Сервисе“»)                                                   |
| `src/routes/_app/service.tsx`          | 18 (комментарий «бывший „Сервис“» — убрать целиком, переименование давно позади) |
| `src/services/metadata/googleBooks.ts` | 3 (комментарий про то, где задаётся ключ)                                        |

Имена файлов и роуты (`service.tsx`, `/service/sources`) не трогаем — это отдельная правка с редиректами, к этому этапу отношения не имеет.

После правки проверить, что не осталось: `grep -rn "Сервис" docs README.md src | grep -v docs/plans` — ожидается пусто.

- [ ] **Шаг 6: Коммит**

```bash
git add docs .env.example README.md src
git commit -m "docs: вежливая сеть и фоновое наполнение (M33); раздел везде называется «Настройки»"
```

---

## Проверка этапа

Автоматически:

```bash
export BUN_INSTALL="$PWD/.bun"; export BUN_TMPDIR="$PWD/.bun/tmp"; export PATH="$BUN_INSTALL/bin:$PATH"
bun run typecheck && bun run lint && bun test
```

Ожидается: зелёный тайпчек, зелёный линт, все тесты проходят. Новых тестов не меньше 25: лимитер (4), клиент и `Retry-After` (5), фильтр типов (3), очередь (5), парсер FantLab (5), матчер Wikidata (5).

Руками, на копии боевой базы в Docker (как заведено перед рискованными выкатками):

1. `LOG_LEVEL=debug`, открыть подряд десять страниц произведений. В журнале по scope `net`: запросы к `api.fantlab.ru` идут не чаще одного в три секунды, у всех есть `User-Agent`, интерактивные обгоняют фоновые.
2. Выключить сеть на минуту, открыть новое произведение. В журнале `warn`, `editions_fetched_at` **остался NULL**, при повторном открытии издания подтягиваются.
3. Автор-нефантаст (например, из нон-фикшена) через один-два тика получает даты жизни из Wikidata и биографию из Википедии; на странице автора под текстом — ссылка на статью и CC BY-SA.
4. Однофамилец не получает чужую биографию: в журнале `warn` «кандидаты неразличимы» со списком.
5. `/service/crawl` показывает те же цифры, что `select status, count(*) from crawl_task group by status`; «Повторить упавшие» переводит `failed` в `pending`.
6. `CRAWL_ENABLED=0` — в журнале «воркер выключен», фоновых запросов нет, поиск по кнопке работает.
7. `docker stop` посреди задачи, старт заново: задача не висит в `running` — `releaseStale` вернула её в очередь.

---

## Что сознательно не делается

- **Разбор раздела «Библиография» из статьи Википедии моделью.** Решение владельца: сначала структурные факты. Место под это готово — `AuthorFacts.works` уже общий для всех источников, добавится ещё один адаптер.
- **Перенос догрузки обложек изданий из пользовательского запроса в очередь.** После лимитера двенадцать картинок перестают быть залпом, и острота уходит; полноценный перенос — отдельный разговор, он меняет поведение экрана.
- **Отказ от `console`-перехвата и переход журнала на JSON.** Сегодняшний человекочитаемый формат удобен на одном сервере; менять его без нужды в агрегаторе смысла нет.
- **FTS5, уведомления, экспорт** — они в «Что дальше» роадмапа и к этому этапу отношения не имеют.
