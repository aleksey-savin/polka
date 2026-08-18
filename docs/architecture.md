# Polka — архитектура

Статус: утверждена 2026-08-10. Версии и API проверены по актуальной документации на эту дату.

## Стек

| Слой         | Технология                          | Версия                                  | Замечания                                                                       |
| ------------ | ----------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| Runtime / PM | Bun                                 | ≥ 1.3.14                                | Встроенный `Bun.Image` для обложек                                              |
| Фреймворк    | TanStack Start (React)              | `@tanstack/react-start` ~1.168 (RC)     | Чистый Vite-плагин, vinxi больше нет                                            |
| Сборка       | Vite                                | 8.x                                     |                                                                                 |
| UI           | React 19, shadcn/ui, Tailwind CSS 4 |                                         | Тема — oklch CSS-переменные                                                     |
| БД           | SQLite (`bun:sqlite`) + Drizzle ORM | drizzle-orm 0.45.2, drizzle-kit 0.31.10 | **Не** v1-rc; только core-запросы (без RQB) — миграция на v1 потом механическая |
| Auth         | better-auth                         | 1.6.26                                  | **Не** 1.7-rc                                                                   |
| Валидация    | zod                                 | 4.x                                     |                                                                                 |
| Сканер       | barcode-detector (ponyfill)         | 3.2.1                                   | Поверх zxing-wasm                                                               |
| Тесты        | `bun test`                          | —                                       | Только чистые модули `services/`                                                |
| TypeScript   | 6.x                                 | strict                                  | См. ts-guideline.md                                                             |

**Политика версий:** зависимости пинуются точно (без `^`) — TanStack Start в RC, у better-auth на подходе 1.7; истории переименований API уже случались (`validator`↔`inputValidator`, `reactStartCookies`→`tanstackStartCookies`). Бамп — только осознанно, с чтением ченджлога.

## Слои и структура

Правило: **вся логика — в чистых модулях `services/`**, серверные функции тонкие (auth + валидация + вызов сервиса). Логику не заворачивать в `createServerFn` — обёртки не тестируются напрямую (валидаторы не срабатывают при прямом вызове).

```
polka/
├── docs/                     # эта документация
├── public/                   # manifest.webmanifest, icons/, zxing/*.wasm (самохост!)
├── drizzle/                  # сгенерированные SQL-миграции
├── data/                     # gitignore: polka.db(+wal,+shm), covers/ → Docker volume /data
├── server.ts                 # прод-сервер на Bun.serve (по официальному примеру start-bun)
├── vite.config.ts            # tanstackStart() + react() + tailwindcss()
├── drizzle.config.ts
├── Dockerfile  compose.yaml
└── src/
    ├── routes/
    │   ├── __root.tsx  index.tsx  login.tsx
    │   ├── s.$token.tsx              # публичная витрина — ВНЕ _app-гарда
    │   ├── _app.tsx                  # layout с beforeLoad-гардом сессии
    │   ├── _app/                     # libraries.index, libraries.$libraryId,
    │   │                             # shelves.$shelfId, books.index (каталог, скоупы
    │   │                             # «мои»/«у друзей»), books.$bookId,
    │   │                             # series.index, series.$seriesId, add, wishlist,
    │   │                             # loans, requests, friends (полки друзей + мои ссылки)
    │   └── api/
    │       ├── auth.$.ts             # better-auth catch-all (server.handlers)
    │       └── covers.$bookId.ts     # отдача файлов обложек
    ├── server/                       # createServerFn: тонкие обёртки
    │   ├── middleware.ts             # сессия из getRequestHeaders()
    │   └── libraries.ts shelves.ts books.ts series.ts tags.ts
    │       lookup.ts covers.ts loans.ts shares.ts savedShares.ts requests.ts
    ├── services/                     # чистая логика, покрыта bun test
    │   ├── isbn.ts                   # валидация, 10↔13, EAN-13 → ISBN
    │   ├── search.ts                 # нормализация кириллицы, построение LIKE
    │   ├── covers.ts                 # скачивание/ресайз/хранение (Bun.Image)
    │   ├── shelfTint.ts              # патина по медианному году
    │   └── metadata/                 # googleBooks.ts openLibrary.ts fantlab.ts merge.ts types.ts
    ├── db/
    │   ├── index.ts                  # bun:sqlite + drizzle + PRAGMA + migrate() на старте
    │   └── schema/  auth.ts (генерируется CLI)  catalog.ts  circulation.ts
    ├── lib/  auth.ts  auth-client.ts  env.ts
    ├── components/  ui/ (shadcn)  scanner/  book/  shelf/  layout/
    └── styles/app.css                # токены темы (см. ux-ui-guideline.md)
```

## Схема БД

PK — текстовые id (совместимо с better-auth). Все `?` — nullable.

**auth** (генерируется `@better-auth/cli generate`, руками не править): `user`, `session`, `account` (хранит хэш пароля), `verification`.

**catalog.ts**

| Таблица          | Колонки                                                                                                                                                                                                                                                                                                                                                                                                                                    | Ограничения                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `library`        | id, name, description?, position, createdBy→user, createdAt                                                                                                                                                                                                                                                                                                                                                                                | владение — через `library_member`                                                                                                                        |
| `library_member` | libraryId→library (cascade), userId→user (cascade), role ('owner'\|'member'), joinedAt                                                                                                                                                                                                                                                                                                                                                     | PK (libraryId, userId); idx (userId). Совладение: все участники полноправны в каталоге; 'owner' (создатель) управляет участниками и удалением библиотеки |
| `library_invite` | id, libraryId→library (cascade), token unique, createdBy→user, createdAt, revokedAt?                                                                                                                                                                                                                                                                                                                                                       | инвайт-ссылка: залогиненный открывает → становится участником                                                                                            |
| `shelf`          | id, libraryId→library (cascade), name, position, accentColor? (NULL = авто-патина), createdAt                                                                                                                                                                                                                                                                                                                                              | unique (libraryId, name)                                                                                                                                 |
| `series`         | id, ownerId→user, name, nameNorm, description?, createdAt                                                                                                                                                                                                                                                                                                                                                                                  | unique (ownerId, name); личный словарь, но в общей библиотеке привязанные серии видны всем участникам, autocomplete — по сериям всех участников          |
| `book`           | id, addedBy→user (кто добавил; для wishlist — чей виш), libraryId?→library (NULL только при wishlist), shelfId?→shelf (set null; NULL = «Неразобранное»), title, authors, isbn10?, isbn13?, publisher?, year?, seriesId?→series (set null), seriesNumber? (текст), pages?, language='ru', annotation?, coverPath?, status ('in_library'\|'wishlist'\|'gifted'\|'lost'), giftedTo?, giftedAt?, titleNorm, authorsNorm, createdAt, updatedAt | idx: (addedBy), (libraryId, shelfId), (isbn13), (seriesId), (status). Личных полей нет — они в `book_personal`                                           |
| `book_personal`  | userId→user (cascade), bookId→book (cascade), readingStatus ('unread'\|'reading'\|'read'\|'abandoned') default 'unread', readAt?, rating? CHECK 1–5, review?, reviewedAt?, notes?                                                                                                                                                                                                                                                          | PK (userId, bookId). Личный слой каждого участника: чтение, оценка, рецензия, приватные заметки                                                          |
| `tag`            | id, ownerId, name                                                                                                                                                                                                                                                                                                                                                                                                                          | unique (ownerId, name); тэги на книгах общей библиотеки видны всем участникам                                                                            |
| `book_tag`       | bookId (cascade), tagId (cascade)                                                                                                                                                                                                                                                                                                                                                                                                          | PK (bookId, tagId)                                                                                                                                       |

**circulation.ts**

| Таблица          | Колонки                                                                                                                                                                                           | Ограничения                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `loan`           | id, bookId→book (cascade), borrowerName, note?, lentAt, dueAt?, returnedAt?, requestId?→borrow_request, createdAt                                                                                 | **частичный unique (bookId) WHERE returnedAt IS NULL** — одна активная выдача на книгу                   |
| `share`          | id, createdBy→user, token unique (≥24 случайных байт, base64url), scope ('library'\|'shelf'), libraryId?, shelfId?, allowRequests=1, createdAt, revokedAt?                                        | CHECK: заполнено ровно одно из libraryId/shelfId согласно scope; создать может любой участник библиотеки |
| `borrow_request` | id, shareId→share (cascade), bookId→book (cascade), guestName, requesterUserId?→user (set null — заявка залогиненного), note?, status ('pending'\|'approved'\|'declined'), createdAt, resolvedAt? | approve → создаёт loan (borrowerName=guestName, loan.requestId)                                          |
| `saved_share`    | userId→user (cascade), shareId→share (cascade), savedAt                                                                                                                                           | PK (userId, shareId) — «полки друзей»: сохранённые чужие ссылки                                          |
| `lookup_cache`   | isbn13 PK, source, rawJson, fetchedAt                                                                                                                                                             | кэш ответов метаданных                                                                                   |

**Эталонный каталог (M14–M16)** — общий для всех пользователей, правки живут в копиях-книгах:

| Таблица           | Колонки                                                                                                              | Смысл                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `author`          | id, name, nameNorm unique, fantlabId?, openlibraryId?, bio?, birthYear?, deathYear?, country?, photoPath?             | дедуп по nameNorm; био заполняет фоновый воркер                             |
| `book_author`     | bookId (cascade), authorId (cascade), position                                                                        | PK (bookId, authorId)                                                        |
| `ref_work`        | id, source, sourceId, title, titleNorm, year?, workType?, annotation?, editionsFetchedAt?                            | произведение; unique (source, sourceId). `workType='cycle'` — это цикл       |
| `ref_book`        | id, source, sourceRef, isbn13?, isbn10?, title, publisher?, year?, pages?, heightMm?, coverType?, coverPath?, rawJson | издание; unique (source, sourceRef)                                          |
| `ref_book_work`   | refBookId (cascade), workId (cascade)                                                                                 | сборник покрывает несколько произведений                                     |
| `ref_work_link`   | parentId→ref_work, childId→ref_work, position                                                                         | состав цикла по порядку чтения (M16)                                         |
| `ref_work_author` | workId, authorId, position                                                                                            | PK (workId, authorId)                                                        |
| `crawl_task`      | id, kind, source, authorId, status, attempts, scheduledAt, doneAt?, error?                                            | очередь фонового наполнения; unique (kind, source, authorId)                |

**Списки — вишлисты и подборки (M17)**:

| Таблица          | Колонки                                                                                                      | Ограничения                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `book_list`      | id, ownerId→user (cascade), kind ('wishlist'\|'collection'), title, description?, position, createdAt, updatedAt | idx (ownerId, kind, position)                                                          |
| `book_list_item` | id, listId (cascade), bookId?/refWorkId?/refBookId?, note?, position, addedBy, createdAt                     | CHECK: ровно одна ссылка; частичные unique по каждой форме — дублей в списке нет      |
| `gift_hold`      | id, itemId (cascade), shareId (cascade), guestName, holderKey, createdAt, canceledAt?                        | частичный unique (itemId) WHERE canceledAt IS NULL — одна активная бронь на книгу      |

**Роли, модерация и почта (M21–M22)** — `schema/moderation.ts`:

| Таблица             | Колонки                                                                                                             | Смысл                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `user_account`      | userId PK→user (cascade), role ('user'\|'moderator'\|'admin'), publishBannedAt?, publishBanReason?, blockedAt?, blockedReason? | глобальная роль; роль в библиотеке — отдельная история                  |
| `moderation_item`   | id, kind ('book_cover'\|'share'\|'ref_work'\|'ref_book'), targetId, status, ownerId?, reportCount, reason?, reviewedBy?, reviewedAt? | очередь; idx (status, reportCount)                                      |
| `moderation_report` | id, itemId (cascade), reason, note?, reporterId?                                                                    | жалоба, в том числе от гостя без аккаунта                              |
| `moderation_log`    | id, actorId?, action, kind?, targetId?, subjectId?, reason?, createdAt                                              | журнал решений — без него спор не разобрать                            |
| `mail_setting`      | id='default', host?, port?, secure, username?, passwordEnc?, fromName?, fromEmail?, флаги видов писем, lastResult?  | пароль SMTP шифруется AES-GCM ключом из `BETTER_AUTH_SECRET`           |

Инварианты, которые следит сервисный слой:

- `book.status='wishlist'` ⇔ `libraryId IS NULL` (личный виш, доступ по `addedBy`); при остальных статусах `libraryId NOT NULL`.
- `shelfId` принадлежит той же `libraryId` (проверка при записи).
- «На руках» — вычислимо: существует loan с `returnedAt IS NULL`.
- `book.unrecognized=1` ⇔ названием служит ISBN (M18); флаг снимается, как только появилось настоящее название.
- Членство книги в списке резолвится **сквозь формы**: моя книга ↔ произведение ↔ издание связываются через `refBookId`/`refWorkId`/`ref_book_work`/совпадение названия (M17).
- Публикация не ждёт модерации: `share` работает сразу, а объект встаёт в `moderation_item` со статусом `pending`.

**Авторизация каталога — только через членство.** Единый хелпер `assertMember(libraryId, userId)` (join `library_member`) во всех сервисах: доступ к книге/полке/выдаче/заявке определяется членством в её библиотеке, а не `addedBy`. Wishlist-книги (без библиотеки) — только их `addedBy`. Действия «owner»: удаление библиотеки, управление участниками и инвайтами. Личный слой (`book_personal`) пишет только его `userId`; читают участники библиотеки книги (карточка показывает оценки всех участников).

## Аутентификация (better-auth)

- `src/lib/auth.ts`: `betterAuth({ database: drizzleAdapter(db, { provider: 'sqlite' }), emailAndPassword: { enabled: true, disableSignUp: !env.REGISTRATION_OPEN }, plugins: [..., tanstackStartCookies()] })`.
- **`tanstackStartCookies` — строго последний плагин** (иначе серверный sign-in не ставит cookie).
- Catch-all роут: `src/routes/api/auth.$.ts` → `server.handlers.GET/POST = ({request}) => auth.handler(request)`.
- Сессия в серверных функциях: общий middleware `auth.api.getSession({ headers: getRequestHeaders() })`; id пользователя **никогда** не принимается с клиента.
- Гард UI: layout `_app.tsx`, `beforeLoad` → `redirect({ to: '/login' })`. Публичные роуты (`s.$token`, `login`, api) — вне `_app`.
- Email-верификация выключена (закрытый круг, без SMTP).
- **Регистрация по приглашению**: `hooks.before` на `/sign-up/email` — пустая система пропускает свободно, иначе требуется валидный одноразовый токен в заголовке `x-signup-invite` (таблица `signup_invite`, TTL 7 дней); `hooks.after` гасит токен после успешной регистрации.

## Метаданные по ISBN

Всё серверно (`server/lookup.ts` → `services/metadata/*`): CORS, ключи и вежливые заголовки клиенту не показываем.

| Источник     | Endpoint                                                                                 | Ограничения                                                             | Сильные стороны                                |
| ------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| Google Books | `googleapis.com/books/v1/volumes?q=isbn:{isbn13}`                                        | keyless (плавающие лимиты) или ключ `GOOGLE_BOOKS_API_KEY` (~1000/день) | Аннотации, обложки, лучшая база современных RU |
| OpenLibrary  | `openlibrary.org/isbn/{isbn}.json`, обложки `covers.openlibrary.org/b/isbn/{isbn}-L.jpg` | 1 rps аноним; слать `User-Agent: Polka (контакт)` — тогда 3 rps         | Старые/переводные издания                      |
| FantLab      | `api.fantlab.ru/search-editions?q={isbn}`                                                | API v0.9 «test mode», без SLA — best-effort                             | Русская фантастика: серии, обложки             |

Алгоритм: нормализовать ISBN (дефисы, 10↔13, чек-цифра) → `Promise.allSettled` по трём источникам с таймаутом 4с → нормализация каждого в `Partial<BookDraft>` → пофилдовый merge: **FantLab > Google > OpenLibrary** для библио-полей (название, авторы, издательство, год, серия), **Google > FantLab** для аннотации; кандидаты обложек в том же порядке. Сырые ответы — в `lookup_cache` (при разборе завала один ISBN сканируют по нескольку раз). Обложка **скачивается на диск при сохранении книги** — не хотлинкуем (ссылки Google протухают, FantLab хотлинкать невежливо).

## Поиск и кириллица

`LOWER()`/`LIKE` в SQLite сворачивают регистр **только ASCII** — «Стругацкие» не найдётся по «стругацкие». Решение: теневые колонки `titleNorm`, `authorsNorm` у книги и `nameNorm` у серии, заполняются в JS (`.toLowerCase().trim()` + схлопывание пробелов, `ё`→`е`) при каждой записи; поиск — `LIKE '%…%'` по ним (+ join series для поиска по названию серии). FTS5 — осознанно после MVP.

Скоуп «У друзей»: тот же поиск, но по книгам из сохранённых шэров (`saved_share` → `share` (не отозван) → библиотека/полка → книги), наружу — **тот же публичный allowlist полей, что и на витрине**; свои заметки/выдачи/оценки чужих книг не утекают.

## Живые полки (визуальная фишка)

- **Авто-патина:** `services/shelfTint.ts` — медианный год изданий книг полки (книги без года не участвуют) → интерполяция цвета в OKLCH от «пожелтевшей бумаги» (старые) к «свежему белому» (новые); конкретные конечные точки задаёт ux-ui-guideline.md. Отдаётся как CSS custom property на секции полки. Полка без данных — нейтральная. Легенда в UI: «медианный год изданий — N».
- **Ручной акцент:** `shelf.accentColor` (пресеты + произвольный цвет) перекрывает авто-патину.

## Сканер штрихкодов

- Пакет `barcode-detector` (ponyfill W3C `BarcodeDetector` поверх zxing-wasm; нативный API в Safari всё ещё за флагом, в Firefox отсутствует). Импорт из `barcode-detector/ponyfill`, `formats: ['ean_13']`, цикл `detect(video)` по `requestAnimationFrame`.
- **WASM самохостится из `public/zxing/`** — по умолчанию пакет тянет его с CDN, нам нужна автономность.
- Камера (`getUserMedia`) работает только в secure context: **HTTPS или localhost**. iOS: `<video playsinline muted>`, старт камеры — по тапу пользователя.
- EAN-13 с префиксом 978/979 = ISBN-13; конверсия и валидация в `services/isbn.ts`.

## Обложки

Загрузка: серверная функция `method:'POST'` с FormData (валидация MIME/размера) — или скачивание по URL из метаданных. Обработка: `Bun.Image` → оригинал + webp-превью ~600px в `data/covers/`. Отдача: `src/routes/api/covers.$bookId.ts` → `new Response(Bun.file(path))` + `Cache-Control` + `?v=updatedAt`; путь берётся **только из БД по bookId** (никаких путей из инпута — защита от traversal).

## PWA

`vite-plugin-pwa` сейчас ломает прод-сборку Start (issue TanStack/router#4988), serwist имеет свой баг. MVP: рукописный `public/manifest.webmanifest` + иконки + `theme-color` — приложение устанавливается на домашний экран; service worker не делаем.

## Прод и деплой

- Сборка: `vite build` → `dist/client` (статика) + `dist/server/server.js` (SSR-обработчик). Запуск: `server.ts` на `Bun.serve` (адаптация официального примера start-bun: мелкая статика прогревается в память, остальное — в SSR-обработчик).
- **Миграции применяются программно на старте** (`migrate()` из `drizzle-orm/bun-sqlite/migrator`) — до `Bun.serve`; это же даёт авто-миграцию в Docker. Генерация миграций в разработке: `bunx --bun drizzle-kit generate` (флаг `--bun` обязателен — иначе drizzle-kit не резолвит `bun:sqlite`).
- PRAGMA на старте: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- Docker: multi-stage от `oven/bun:1.3`, в рантайм — `dist/`, `drizzle/`, `server.ts`, `public/` **плюс production `node_modules`** (`bun install --production` в рантайм-слое: серверный бандл Vite экстернализует зависимости); `ENV DATA_DIR=/data`, `VOLUME /data`, порт 3000.
- VPS: контейнер за **Nginx Proxy Manager** (существующий у владельца) — NPM терминирует HTTPS на поддомене и проксирует на порт контейнера. HTTPS обязателен: без него не работает камера-сканер. better-auth читает клиентский IP из `x-forwarded-for`/`x-real-ip` (`advanced.ipAddress.ipAddressHeaders`) — для rate-limit за прокси.
- CD **pull-моделью** (VPS за reverse-proxy, входящего ssh нет): GitHub Actions на пуш в `main` → проверки → сборка образа → публичный GHCR; на VPS рядом с приложением живёт **watchtower** (`--interval 300 --cleanup polka`) и сам перекатывает контейнер на свежий образ. Секреты GitHub не нужны. Этот инстанс — живое дев-превью, по готовности MVP он же становится боевым. (GitHub Pages для приложения непригоден — SSR+БД; туда при желании выкладываются только статические макеты дизайна.)
- Бэкап: остановить контейнер и скопировать весь `/data` (WAL = три файла БД + covers), либо `sqlite3 polka.db ".backup"` на горячую. Процедура — в README.

## Переменные окружения

| Переменная             | Обязательна          | Смысл                                    |
| ---------------------- | -------------------- | ---------------------------------------- |
| `DATA_DIR`             | да (в проде `/data`) | Каталог БД и обложек                     |
| `BETTER_AUTH_SECRET`   | да                   | Секрет сессий                            |
| `APP_URL`              | да                   | Внешний URL (для better-auth)            |
| `REGISTRATION_OPEN`    | нет (default `true`) | `false` — скрыть и запретить регистрацию |
| `GOOGLE_BOOKS_API_KEY` | нет                  | Поднимает лимиты Google Books            |
| `CRAWL_ENABLED`        | нет (default `1`)    | `0` — выключить фоновый краулер эталона  |
| `LOG_LEVEL`            | нет (default `info`) | `debug` добавляет статику и серверные функции |
| `GIT_SHA`              | ставится сборкой     | Версия образа, видна в журнале при старте |

Почта (SMTP) в окружении не живёт — настраивается в приложении, «Сервис» → «Почта»; пароль хранится в базе зашифрованным.

## Журнал приложения

Winston пишет в stdout (`docker compose logs`) и в файлы `/data/logs` — контейнер пересоздаётся каждой выкаткой и уносит свои логи, том остаётся. Посуточная ротация, 14 дней, симлинк `polka.log` на текущий. Ловим всё: любой вывод через `console` (в том числе библиотечный), неперехваченные исключения и отказы промисов, сигналы остановки, каждый HTTP-запрос со статусом и длительностью, старт с версией и временем миграций, работу краулера, heartbeat с памятью раз в пять минут. Подробности и команды — в README.

## ИИ (M24)

Одна дверь к модели — `services/ai.ts`. Всё, что появится дальше, ходит только
через `ask(userId, prompt)`; напрямую в сеть не лезет никто.

```
ai_setting (одна строка, id='default')
  enabled · provider ('yandex' | 'openai') · api_key_enc · folder_id
  model · endpoint · daily_limit · last_result · last_result_at
ai_usage (user_id + day)  calls · tokens   -- лимит на человека в сутки
```

- Ключ шифруется тем же `lib/secretbox.ts`, что и пароль SMTP; наружу отдаётся
  только `hasKey`. Пустое поле при сохранении — оставить прежний ключ.
- Яндекс: `POST llm.api.cloud.yandex.net/foundationModels/v1/completion`,
  заголовки `Authorization: Api-Key`, `x-folder-id`; модель уезжает в
  `modelUri: gpt://<каталог>/<модель>`. OpenAI-совместимые — `/chat/completions`
  с `Bearer`. Таймаут 30 с.
- Каталога моделей у Яндекса нет, поэтому список известных + всегда открытое
  поле ввода; у OpenAI-совместимых спрашиваем `/models`.
- Ошибка сервиса показывается дословно (`Модель ответила 401: …`) и ложится в
  `last_result` — гадать про квоты и права бессмысленно.
- Лимит проверяется до запроса, счётчик растёт только после удачного ответа:
  отказ сервиса не должен съедать чужие запросы.

## Разбор нераспознанных (M25)

```
ai_isbn_guess (isbn13 PK)   verdict · title · authors · publisher · year
                            ref_book_id · work_id · model · raw_json
ai_suggestion               book_id · isbn13 · verdict · status
                            before_json · after_json · applied_by · reviewed_by
```

- `services/aiRecognize.ts`: `recognizeBook` (кэш → `ask` → проверка каталогом),
  `applyRecognition` / `revertRecognition` (снимок «до» лежит в `before_json`),
  `listAiReview` / `approveToReference` / `rejectRecognition` — модерация.
- Проверка гипотезы: `searchByTitle` по «название + автор», при нужде
  `adoptExternalWork`, затем `fetchWorkEditions` подтягивает издания с FantLab —
  и `bestRefBookIdForIsbn` смотрит, появился ли наш номер. FantLab часто молчит
  на поиск по ISBN, но отдаёт то же издание в списке произведения.
- `services/isbnPrefix.ts`: издательство по префиксу, самое длинное совпадение.
- `ref_book.source` и `ref_work.source` получили значение `manual` — запись,
  утверждённую модератором; в приоритете источников она стоит первой.
- Доступ: разбор и откат — только для своих книг и книг своих библиотек;
  очередь и утверждение — `requireModerator`.

## Источники метаданных: ключи и порядок (M25.1)

- **Google Books без ключа мёртв**: общая анонимная квота исчерпана, ответ 429 —
  и для человека это выглядит как «книга не нашлась». Ключ задаётся в
  «Сервис → Источники» (шифрованно) либо через `GOOGLE_BOOKS_API_KEY`.
- Ключи Google по умолчанию ограничены по **HTTP-referrer**, а серверный запрос
  реферер не посылает: ответ 403 `API_KEY_HTTP_REFERRER_BLOCKED`. Поэтому в
  запросе подставляем `Referer: ${APP_URL}/` — ключ выдан для этого же домена.
- Порядок в разборе нераспознанных: **свой эталон → FantLab/Google/OpenLibrary →
  и только потом модель**. Если источники справились, запись не помечается как
  работа ИИ и в очередь модератора не попадает: это обычное дозаполнение.
- В результат разбора возвращается отчёт по каждому источнику («нашёл / молчит /
  ошибка»), он же показывается в интерфейсе — иначе «не нашлось» неотличимо от
  сломанного ключа.
- Список моделей ИИ спрашивается у провайдера: для Яндекса пробуются
  `llm.api.cloud.yandex.net/v1/models` и `foundationModels/v1/models`, ответы
  разных форм (`data[].id`, `models[].uri`) разбирает `parseModelList`.
- В тестах внешние клиенты (`fetchGoogleBooks`, `fetchFantlab`,
  `fetchOpenLibrary`, `searchFantlab`, `fetchWorkEditions`) наружу не ходят —
  иначе прогон зависит от чужих серверов.

## Поиск в интернете по ISBN (M26)

```
source_setting  web_enabled · web_mode ('extract' | 'generative')
                web_daily_limit · web_last_result · web_last_result_at
ai_usage        searches           -- поиски считаем отдельно от запросов модели
ai_isbn_guess   via · proof_url · proof_title
```

- `services/webSearch.ts`: `searchWeb` (Web Search API v2 — сначала синхронный
  `/v2/web/search`, при отказе `/v2/web/searchAsync` + опрос операции),
  `genSearch` (`/v2/gen/search`), `spendSearch` (лимит, счётчик, запись
  результата), `parseSearchXml`, `mentionsIsbn`.
- **Ответ Web Search — XML внутри base64** (`response.rawData`): декодируем и
  вытаскиваем `url`/`title`/`passage`/`headline` регулярками, снимая `<hlword>`.
- Ключ и каталог берутся из настроек ИИ (`aiCredentials()`), отдельных полей
  нет: это то же облако. Услугу нужно включить в консоли, сервисному аккаунту
  дать роль `search-api.webSearch.user`.
- **Правило приёмки**: номер должен встретиться в тексте найденной страницы
  (`mentionsIsbn` сравнивает только цифры — на страницах номер печатают с
  дефисами, тире и пробелами). Иначе результат не берётся вовсе.
- Ядро — `recognizeIsbn(userId, isbn13, opts)`: эталон → каталоги → Яндекс
  Поиск → Нейропоиск → модель по памяти; `recognizeBook` — обёртка с проверкой
  доступа. Каждый шаг только если предыдущий промолчал **или отвергнут**:
  `nextVariant` дописывает текущий `via` в `ai_isbn_guess.rejected_vias` и
  продолжает цепочку; отвергнутые пути пропускаются и из кэша не отдаются.
- Добор в конце цепочки (`enrichMissing`): Google по названию (название до
  двоеточия + одно слово фамилии, потом свободной строкой) → og-теги страницы-
  доказательства → Яндекс Картинки `/v2/image/search` (best-effort).
- Находка каталогов (`via='sources'`) при сохранении НЕ получает пометку
  «Заполнил ИИ» и не идёт в очередь модератора — это обычное дозаполнение.

## Модерация: копия, отмена, страницы (M29)

```
moderation_item  from_ai · draft_json · published_ref_id
```

- **Модерация не трогает карточку владельца.** Модератор правит черновик
  (`draft_json`) — копию, собранную из объекта; в эталон уходит копия, а не
  оригинал. `published_ref_id` помнит, что именно опубликовали.
- Решения обратимы: `undoDecision` возвращает запись в очередь, снимает
  блокировку (ссылка снова работает) и удаляет копию из эталона; отмена
  пишется в журнал наравне с решением.
- Находки ИИ попадают в общую очередь с `from_ai = 1` — отдельного раздела
  «Проверка находок» больше нет.
- Пагинация — keyset по паре «дата + id». Две ловушки, на которых легко
  обжечься: drizzle хранит `timestamp` **в секундах** (сравнение с
  миллисекундами всегда истинно), а при пакетной постановке десятки записей
  попадают в одну секунду — по одной дате страницы повторяются.
- Счётчики табов — отдельный `COUNT` тем же условием, что и список
  (`queueWhere`), иначе цифры расходятся с содержимым.

## Источники книг: список = цепочка (M30)

```
book_source  key (reference · fantlab · google · openlibrary · web · neuro · model)
             enabled · position
```

- `services/bookSources.ts` — единственное место, где записан порядок опроса.
  `lookupIsbn` берёт из него состав и очередь каталогов, `recognizeIsbn` —
  можно ли спрашивать веб-поиск, Нейропоиск и модель. Зашитого порядка нет.
- Эталон закреплён первым и не выключается: бесплатный, мгновенный и свой.
- По умолчанию включено всё, кроме Нейропоиска — он на порядок дороже
  прочего, включать осознанно.
- Настройки ИИ (ключ, каталог, модель) живут только в разделе «ИИ»; когда и в
  каком порядке спрашивать — только в «Источниках». Лимиты (модель и поиск)
  тоже там, рядом с расходом за день.

## Подводные камни, на которые уже наступили

Список не для истории, а чтобы не наступить снова:

1. **Миграции и внешние ключи.** Drizzle выполняет файл миграции в транзакции, а SQLite внутри транзакции игнорирует `PRAGMA foreign_keys=OFF` — тот самый, который Drizzle сам пишет в файл при пересоздании таблицы. Наш `foreign_keys=ON` при этом действует, и `DROP TABLE` уносит каскадом строки зависимых таблиц. Так при переезде на списки (M17) пропали `saved_share` и `borrow_request`. Ключи выключаются **вокруг** `migrate()` в `db/index.ts`, после прогона проверяется `pragma_foreign_key_check`; регрессию сторожит `src/db/migrations.test.ts`.
2. **Генератор миграций врёт при пересоздании таблицы.** Добавляя колонку через rebuild, drizzle-kit пишет её в `INSERT ... SELECT` из старой таблицы, где колонки ещё нет. SQL надо читать глазами перед выкаткой.
3. **Lightning CSS молча ест `@mixin`.** Это синтаксис Sass; тёмная тема, написанная через миксин, собиралась без ошибок и не появлялась. Блоки токенов дублируются намеренно.
4. **`PRAGMA foreign_keys` и SELinux при монтировании тома.** На Fedora хост-каталог без `:Z` даёт EACCES внутри контейнера; журнал из-за этого ронял приложение, пока файловый транспорт не сделали необязательным.
5. **FantLab: `lang_id` у произведения — язык оригинала**, а не издания. Фильтр по нему выкидывал библиографию переводных авторов (Несбё: 2 книги вместо 36). Русскоязычность отбирается на уровне изданий.
6. **У классики сотни изданий.** «Братья Карамазовы» — 230 русских; тянуть их обложки пачкой это полторы минуты ожидания и 230 файлов. Обложек качаем 12, остальные — при открытии карточки издания.
7. **Пайп маскирует код возврата.** `bun run typecheck | tail` возвращает статус `tail`, и красный тайпчек уезжает в прод. Проверки — строго через `&&`.
8. **Radix Dialog — не шторка.** Мобильные шторки на нём приходилось дописывать руками (свайп, грип ломал сетку). Взяли стоковый shadcn Drawer (vaul) и не трогаем его поведение.

## Тестирование

`bun test` — 105 тестов в 17 файлах. Чистые модули: `isbn` (чек-цифры, 10↔13, EAN→ISBN), `metadata/merge` (на записанных фикстурах), `shelfTint`, `search`, `spine`, `userAgent`. Сервисы гоняются на временной SQLite (`DATA_DIR` в `mkdtemp` до импорта `@/db`): каталог, обращение, шэринг, циклы, списки, нераспознанные, поиск по названию, модерация, почта (через фиктивный SMTP на localhost), миграции (апгрейд боевой базы с потерей данных).

Что проверяется руками: экраны на телефоне и сквозные сценарии по чек-листам этапов (см. roadmap.md). Перед выкаткой рискованных изменений — прогон продового образа в Docker на **копии** боевой базы: так нашлись и потеря данных при миграции, и 230 обложек.
