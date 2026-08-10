import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

import { env } from '@/lib/env'
import * as authSchema from './schema/auth'
import * as catalog from './schema/catalog'
import * as circulation from './schema/circulation'

export const schema = { ...authSchema, ...catalog, ...circulation }

mkdirSync(env.DATA_DIR, { recursive: true })

const sqlite = new Database(join(env.DATA_DIR, 'polka.db'))
sqlite.run('PRAGMA journal_mode = WAL;')
sqlite.run('PRAGMA foreign_keys = ON;')
sqlite.run('PRAGMA busy_timeout = 5000;')

export const db = drizzle({ client: sqlite, schema })

// Миграции применяются на старте процесса (dev-сервер или прод-контейнер).
const migrationsFolder = join(process.cwd(), 'drizzle')
if (existsSync(migrationsFolder)) {
  migrate(db, { migrationsFolder })
}
