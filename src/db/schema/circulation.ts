import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth'
import { book, bookList, bookListItem, library, shelf } from './catalog'

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())

export const borrowRequest = sqliteTable('borrow_request', {
  id: id(),
  shareId: text('share_id')
    .notNull()
    .references(() => share.id, { onDelete: 'cascade' }),
  bookId: text('book_id')
    .notNull()
    .references(() => book.id, { onDelete: 'cascade' }),
  guestName: text('guest_name').notNull(),
  requesterUserId: text('requester_user_id').references(() => user.id, {
    onDelete: 'set null',
  }),
  note: text('note'),
  status: text('status', { enum: ['pending', 'approved', 'declined'] })
    .notNull()
    .default('pending'),
  createdAt: createdAt(),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
})

export const loan = sqliteTable(
  'loan',
  {
    id: id(),
    bookId: text('book_id')
      .notNull()
      .references(() => book.id, { onDelete: 'cascade' }),
    borrowerName: text('borrower_name').notNull(),
    note: text('note'),
    lentAt: integer('lent_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    dueAt: integer('due_at', { mode: 'timestamp' }),
    returnedAt: integer('returned_at', { mode: 'timestamp' }),
    requestId: text('request_id').references(() => borrowRequest.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    // одна активная выдача на книгу
    uniqueIndex('loan_active_unique')
      .on(t.bookId)
      .where(sql`${t.returnedAt} IS NULL`),
    index('loan_book_idx').on(t.bookId),
  ],
)

export const share = sqliteTable(
  'share',
  {
    id: id(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    token: text('token').notNull().unique(),
    scope: text('scope', { enum: ['library', 'shelf', 'list'] }).notNull(),
    libraryId: text('library_id').references(() => library.id, {
      onDelete: 'cascade',
    }),
    shelfId: text('shelf_id').references(() => shelf.id, {
      onDelete: 'cascade',
    }),
    listId: text('list_id').references(() => bookList.id, {
      onDelete: 'cascade',
    }),
    allowRequests: integer('allow_requests', { mode: 'boolean' })
      .notNull()
      .default(true),
    createdAt: createdAt(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (t) => [
    check(
      'share_scope_target',
      sql`(${t.scope} = 'library' AND ${t.libraryId} IS NOT NULL AND ${t.shelfId} IS NULL AND ${t.listId} IS NULL) OR (${t.scope} = 'shelf' AND ${t.shelfId} IS NOT NULL AND ${t.libraryId} IS NULL AND ${t.listId} IS NULL) OR (${t.scope} = 'list' AND ${t.listId} IS NOT NULL AND ${t.libraryId} IS NULL AND ${t.shelfId} IS NULL)`,
    ),
  ],
)

export const savedShare = sqliteTable(
  'saved_share',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    shareId: text('share_id')
      .notNull()
      .references(() => share.id, { onDelete: 'cascade' }),
    savedAt: integer('saved_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.shareId] })],
)

export const lookupCache = sqliteTable('lookup_cache', {
  isbn13: text('isbn13').primaryKey(),
  source: text('source').notNull(),
  /**
   * Отпечаток цепочки, при которой получен ответ (M32). Настройки изменились —
   * запись промахивается и перезаполняется: иначе выключенный Google
   * продолжал бы отдавать свои данные из кэша.
   */
  chain: text('chain'),
  rawJson: text('raw_json').notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** Одноразовое приглашение зарегистрироваться (при закрытой общей регистрации). */
export const signupInvite = sqliteTable('signup_invite', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  token: text('token').notNull().unique(),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  usedBy: text('used_by').references(() => user.id, { onDelete: 'set null' }),
})

/** Бронь подарка (M17): гость отмечает, что дарит книгу из вишлиста.
    Владельцу не показывается — сюрприз; гость снимает свою бронь по holderKey. */
export const giftHold = sqliteTable(
  'gift_hold',
  {
    id: id(),
    itemId: text('item_id')
      .notNull()
      .references(() => bookListItem.id, { onDelete: 'cascade' }),
    shareId: text('share_id')
      .notNull()
      .references(() => share.id, { onDelete: 'cascade' }),
    guestName: text('guest_name').notNull(),
    /** Случайный ключ гостя из localStorage — чтобы он мог снять свою бронь. */
    holderKey: text('holder_key').notNull(),
    createdAt: createdAt(),
    canceledAt: integer('canceled_at', { mode: 'timestamp' }),
  },
  (t) => [
    index('gift_hold_item_idx').on(t.itemId),
    uniqueIndex('gift_hold_active_unique')
      .on(t.itemId)
      .where(sql`${t.canceledAt} is null`),
  ],
)
