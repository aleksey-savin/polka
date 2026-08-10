# Polka (Полка)

Домашняя библиотека бумажных книг: библиотеки → полки → книги, серии, тэги, «дал почитать», виш-лист, шэринг по ссылке с заявками «хочу взять почитать», добавление сканером штрихкода с автозаполнением карточки по ISBN.

Стек: Bun · TanStack Start · SQLite (Drizzle) · better-auth · shadcn/ui · Tailwind 4.

## Документация

- [Продукт: функционал и сценарии](docs/product.md)
- [Архитектура: стек, схема БД, деплой](docs/architecture.md)
- [Роадмап и статусы этапов](docs/roadmap.md)
- [UX/UI гайдлайн](docs/ux-ui-guideline.md)
- [TypeScript гайдлайн](docs/ts-guideline.md)

## Разработка

Нужен [Bun](https://bun.sh) ≥ 1.3.14.

```bash
bun install
bun run dev          # http://localhost:3000
bun run typecheck && bun run lint && bun test
```

БД (SQLite) и обложки живут в `./data` (создаётся сама, миграции применяются на старте). Переменные окружения — см. `.env.example`; в dev можно ничего не задавать.

## Прод (VPS + Docker за Nginx Proxy Manager)

```bash
bun run build && bun run start        # локальная проверка прод-сборки
```

На VPS: каталог `/opt/polka` с `compose.yaml` и `.env` (по образцу `.env.example`), `docker compose up -d`; NPM проксирует поддомен на порт 3000 контейнера (HTTPS обязателен — иначе не работает камера-сканер). Каждый пуш в `main` собирает образ в GHCR и деплоит через GitHub Actions — нужны секреты репозитория `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (без них деплой-шаг просто пропускается).

Бэкап: остановить контейнер и скопировать volume `/data` целиком (в нём `polka.db` с WAL-файлами и обложки).
