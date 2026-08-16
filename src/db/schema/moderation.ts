import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { user } from './auth'

/**
 * Роли и пост-модерация (M21).
 * Модерируем общий слой — загруженные обложки, эталон, публичные витрины;
 * личные рецензии и заметки сюда не попадают.
 */

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())

/** Глобальная роль и санкции. Роль в библиотеке — отдельная история. */
export const userAccount = sqliteTable('user_account', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'moderator', 'admin'] })
    .notNull()
    .default('user'),
  /** Аккаунт живёт, но новые ссылки создавать нельзя. */
  publishBannedAt: integer('publish_banned_at', { mode: 'timestamp' }),
  publishBanReason: text('publish_ban_reason'),
  blockedAt: integer('blocked_at', { mode: 'timestamp' }),
  blockedReason: text('blocked_reason'),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export type ModerationKind = 'book_cover' | 'share' | 'ref_work' | 'ref_book'

/** Очередь: объект публикуется сразу, проверяется потом. */
export const moderationItem = sqliteTable(
  'moderation_item',
  {
    id: id(),
    kind: text('kind', {
      enum: ['book_cover', 'share', 'ref_work', 'ref_book'],
    }).notNull(),
    /** id книги / ссылки / записи эталона — своей таблицы у объекта нет. */
    targetId: text('target_id').notNull(),
    status: text('status', { enum: ['pending', 'ok', 'removed'] })
      .notNull()
      .default('pending'),
    /** Кто выложил — чтобы считать нарушения по человеку. */
    ownerId: text('owner_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reportCount: integer('report_count').notNull().default(0),
    reason: text('reason'),
    reviewedBy: text('reviewed_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('moderation_item_status_idx').on(t.status, t.reportCount),
    index('moderation_item_target_idx').on(t.kind, t.targetId),
  ],
)

/** Жалобы — в том числе от гостей без аккаунта. */
export const moderationReport = sqliteTable(
  'moderation_report',
  {
    id: id(),
    itemId: text('item_id')
      .notNull()
      .references(() => moderationItem.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    note: text('note'),
    reporterId: text('reporter_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('moderation_report_item_idx').on(t.itemId)],
)

/** Журнал: без него разбор спорных случаев невозможен. */
export const moderationLog = sqliteTable(
  'moderation_log',
  {
    id: id(),
    actorId: text('actor_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    kind: text('kind'),
    targetId: text('target_id'),
    subjectId: text('subject_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('moderation_log_created_idx').on(sql`${t.createdAt} desc`)],
)
