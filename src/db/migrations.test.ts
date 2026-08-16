import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { sql } from 'drizzle-orm'
import { describe, expect, test } from 'bun:test'

/**
 * Апгрейд боевой базы не должен терять данные.
 *
 * Драйвер миграций Drizzle гоняет файл в транзакции, а SQLite внутри
 * транзакции игнорирует PRAGMA foreign_keys — поэтому «OFF» в самом файле
 * не работает, и пересоздание таблицы (DROP TABLE + RENAME) уносит каскадом
 * строки зависимых таблиц. Так уже пропали сохранённые ссылки друзей и
 * заявки при переезде на списки (M17). Ключи выключаем вокруг migrate().
 */

const ALL = join(process.cwd(), 'drizzle')

/** Папка миграций, обрезанная по номер включительно. */
function migrationsUpTo(idx: number): string {
  const dir = mkdtempSync(join(tmpdir(), `polka-mig-${idx}-`))
  cpSync(ALL, dir, { recursive: true })
  const journalPath = join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ idx: number }>
  }
  journal.entries = journal.entries.filter((e) => e.idx <= idx)
  writeFileSync(journalPath, JSON.stringify(journal))
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.sql') && Number(name.slice(0, 4)) > idx) {
      rmSync(join(dir, name))
    }
  }
  return dir
}

describe('миграции', () => {
  test('пересоздание таблицы не уносит связанные данные', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'polka-upgrade-'))
    const sqlite = new Database(join(dataDir, 'polka.db'))
    sqlite.run('PRAGMA journal_mode = WAL;')
    const db = drizzle({ client: sqlite })

    // состояние «до переезда на списки»
    migrate(db, { migrationsFolder: migrationsUpTo(12) })

    const now = Math.floor(Date.now() / 1000)
    sqlite.run(
      `insert into user (id, name, email, email_verified, created_at, updated_at)
       values ('u1','Алексей','a@t.local',0,${now},${now})`,
    )
    sqlite.run(
      `insert into library (id, name, position, created_by, created_at)
       values ('lib1','Дом',0,'u1',${now})`,
    )
    sqlite.run(
      `insert into book (id, added_by, library_id, title, authors, status,
         title_norm, authors_norm, created_at, updated_at, hidden, gift_edition, language)
       values ('b1','u1','lib1','Пикник','Стругацкие','in_library','пикник','стругацкие',${now},${now},0,0,'ru')`,
    )
    sqlite.run(
      `insert into share (id, created_by, token, scope, library_id, allow_requests, created_at)
       values ('s1','u1','tok','library','lib1',1,${now})`,
    )
    sqlite.run(
      `insert into saved_share (user_id, share_id, saved_at) values ('u1','s1',${now})`,
    )
    sqlite.run(
      `insert into borrow_request (id, share_id, book_id, guest_name, status, created_at)
       values ('r1','s1','b1','Оля','pending',${now})`,
    )

    // так же, как на старте приложения: ключи выключены вокруг миграций
    sqlite.run('PRAGMA foreign_keys = OFF;')
    migrate(db, { migrationsFolder: ALL })
    sqlite.run('PRAGMA foreign_keys = ON;')

    const rows = (query: string) => db.all(sql.raw(query))
    expect(rows('select id from share')).toHaveLength(1)
    expect(rows('select share_id from saved_share')).toHaveLength(1)
    expect(rows('select id from borrow_request')).toHaveLength(1)
    // и связи не поехали
    expect(rows('select * from pragma_foreign_key_check')).toHaveLength(0)

    rmSync(dataDir, { recursive: true, force: true })
  })
})
