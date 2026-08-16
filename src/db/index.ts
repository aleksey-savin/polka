import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import * as authSchema from './schema/auth'
import * as catalog from './schema/catalog'
import * as circulation from './schema/circulation'
import * as moderation from './schema/moderation'

export const schema = {
  ...authSchema,
  ...catalog,
  ...circulation,
  ...moderation,
}

mkdirSync(env.DATA_DIR, { recursive: true })

const sqlite = new Database(join(env.DATA_DIR, 'polka.db'))
sqlite.run('PRAGMA journal_mode = WAL;')
sqlite.run('PRAGMA busy_timeout = 5000;')

export const db = drizzle({ client: sqlite, schema })

// Миграции применяются на старте процесса (dev-сервер или прод-контейнер).
const migrationsFolder = join(process.cwd(), 'drizzle')
if (existsSync(migrationsFolder)) {
  const started = performance.now()
  try {
    // ВАЖНО: внешние ключи выключаем ДО миграций и включаем после.
    // Drizzle гоняет файл миграции в транзакции, а внутри транзакции SQLite
    // игнорирует PRAGMA foreign_keys — поэтому «OFF» в самом файле не
    // срабатывает, и пересоздание таблицы (DROP TABLE + RENAME) уносит
    // каскадом строки зависимых таблиц. Так уже потерялись сохранённые
    // ссылки друзей и заявки при переезде на списки (M17).
    sqlite.run('PRAGMA foreign_keys = OFF;')
    migrate(db, { migrationsFolder })
    const [broken] = sqlite
      .query<{ n: number }, []>('SELECT count(*) AS n FROM pragma_foreign_key_check')
      .all()
    if (broken && broken.n > 0) {
      log.error('db', 'после миграций битые внешние ключи', { rows: broken.n })
    }
    log.info('db', 'миграции применены', {
      ms: Math.round(performance.now() - started),
      file: join(env.DATA_DIR, 'polka.db'),
    })
  } catch (error) {
    log.error('db', 'МИГРАЦИИ НЕ ПРИМЕНИЛИСЬ — приложение не поднимется', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    throw error
  } finally {
    sqlite.run('PRAGMA foreign_keys = ON;')
  }

  /** Фоновые задачи старта: падение одной не должно ронять процесс молча. */
  const background = (
    name: string,
    run: () => Promise<unknown>,
  ): void => {
    const from = performance.now()
    void run()
      .then(() =>
        log.info('startup', `${name}: готово`, {
          ms: Math.round(performance.now() - from),
        }),
      )
      .catch((error: unknown) =>
        log.error('startup', `${name}: не выполнилось`, {
          error: error instanceof Error ? error : new Error(String(error)),
          ms: Math.round(performance.now() - from),
        }),
      )
  }

  // акцентные цвета старых обложек (динамический импорт — от цикла)
  background('бэкфилл цветов обложек', () =>
    import('@/services/coverColors').then((m) => m.backfillCoverColors()),
  )
  // авторы из денормализованных строк (M13)
  background('бэкфилл авторов', () =>
    import('@/services/authors').then((m) => m.backfillAuthors()),
  )
  // первый зарегистрированный — админ, иначе некому разбирать очередь (M21)
  background('назначение первого админа', () =>
    import('@/services/moderation').then((m) => m.ensureFirstAdmin()),
  )
  // переезд старого виш-листа в список «Хочу почитать» (M17)
  background('переезд виш-листа', () =>
    import('@/services/lists').then((m) => m.backfillWishlists()),
  )
  // фоновое наполнение эталона (M15) — медленный воркер, CRAWL_ENABLED=0 выключает;
  // в тестах не поднимаем: он ходит в сеть
  if (process.env.NODE_ENV !== 'test') {
    background('запуск краулера', () =>
      import('@/services/crawl').then((m) => m.startCrawlWorker()),
    )
  }
}
