// Конфиг ТОЛЬКО для генерации drizzle-схемы better-auth:
//   bun run auth:schema
// Не импортирует боевой код, чтобы генерация не зависела от ещё не созданных файлов.
import { Database } from 'bun:sqlite'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/bun-sqlite'

const db = drizzle({ client: new Database(':memory:') })

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'sqlite' }),
  emailAndPassword: { enabled: true },
})
