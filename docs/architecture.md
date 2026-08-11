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

Инварианты, которые следит сервисный слой:

- `book.status='wishlist'` ⇔ `libraryId IS NULL` (личный виш, доступ по `addedBy`); при остальных статусах `libraryId NOT NULL`.
- `shelfId` принадлежит той же `libraryId` (проверка при записи).
- «На руках» — вычислимо: существует loan с `returnedAt IS NULL`.

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

## Тестирование

`bun test` для чистых модулей: `services/isbn.ts` (чек-цифры, 10↔13, EAN→ISBN), `services/metadata/merge.ts` (на записанных фикстурах реальных ответов), `services/shelfTint.ts`, `services/search.ts` (нормализация «Ё»). Серверные функции и роуты в MVP проверяются сквозными сценариями по чек-листам этапов (см. roadmap.md).
