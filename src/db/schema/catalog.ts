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

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

const createdAt = () =>
  integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())

export const library = sqliteTable('library', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  position: integer('position').notNull().default(0),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: createdAt(),
})

export const libraryMember = sqliteTable(
  'library_member',
  {
    libraryId: text('library_id')
      .notNull()
      .references(() => library.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] })
      .notNull()
      .default('member'),
    joinedAt: integer('joined_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.libraryId, t.userId] }),
    index('library_member_user_idx').on(t.userId),
  ],
)

export const libraryInvite = sqliteTable('library_invite', {
  id: id(),
  libraryId: text('library_id')
    .notNull()
    .references(() => library.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: createdAt(),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
})

export const shelf = sqliteTable(
  'shelf',
  {
    id: id(),
    libraryId: text('library_id')
      .notNull()
      .references(() => library.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    accentColor: text('accent_color'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('shelf_library_name_unique').on(t.libraryId, t.name)],
)

export const series = sqliteTable(
  'series',
  {
    id: id(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    description: text('description'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('series_owner_name_unique').on(t.ownerId, t.name)],
)

export const book = sqliteTable(
  'book',
  {
    id: id(),
    addedBy: text('added_by')
      .notNull()
      .references(() => user.id),
    libraryId: text('library_id').references(() => library.id, {
      onDelete: 'cascade',
    }),
    shelfId: text('shelf_id').references(() => shelf.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    authors: text('authors').notNull().default(''),
    isbn10: text('isbn10'),
    isbn13: text('isbn13'),
    publisher: text('publisher'),
    year: integer('year'),
    seriesId: text('series_id').references(() => series.id, {
      onDelete: 'set null',
    }),
    seriesNumber: text('series_number'),
    pages: integer('pages'),
    language: text('language').notNull().default('ru'),
    annotation: text('annotation'),
    coverPath: text('cover_path'),
    coverColor: text('cover_color'), // акцентный цвет обложки (hex), извлекается при сохранении
    /** Скрыта от гостей: не попадает на витрины, в поиск у друзей и заявки. */
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    /** Переплёт: мягкая обложка / твёрдый — влияет на вид корешка. */
    coverType: text('cover_type', { enum: ['soft', 'hard'] }),
    /** Подарочное издание (тип издания): по умолчанию крупнее габариты. */
    giftEdition: integer('gift_edition', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** Высота книги в мм (из FantLab format_mm или руками) — высота корешка. */
    heightMm: integer('height_mm'),
    /** Издание эталонного каталога, из которого создан экземпляр. */
    refBookId: text('ref_book_id').references(() => refBook.id, {
      onDelete: 'set null',
    }),
    status: text('status', {
      enum: ['in_library', 'wishlist', 'gifted', 'lost'],
    })
      .notNull()
      .default('in_library'),
    giftedTo: text('gifted_to'),
    giftedAt: integer('gifted_at', { mode: 'timestamp' }),
    titleNorm: text('title_norm').notNull(),
    authorsNorm: text('authors_norm').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('book_added_by_idx').on(t.addedBy),
    index('book_library_shelf_idx').on(t.libraryId, t.shelfId),
    index('book_isbn13_idx').on(t.isbn13),
    index('book_series_idx').on(t.seriesId),
    index('book_status_idx').on(t.status),
  ],
)

/** Автор — эталонная сущность: общая, дедуп по nameNorm, правок из UI нет.
    Био-поля заполняются фоновым обогащением (M15). */
export const author = sqliteTable('author', {
  id: id(),
  name: text('name').notNull(),
  nameNorm: text('name_norm').notNull().unique(),
  fantlabId: integer('fantlab_id'),
  openlibraryId: text('openlibrary_id'),
  bio: text('bio'),
  birthYear: integer('birth_year'),
  deathYear: integer('death_year'),
  country: text('country'),
  photoPath: text('photo_path'),
  createdAt: createdAt(),
})

export const bookAuthor = sqliteTable(
  'book_author',
  {
    bookId: text('book_id')
      .notNull()
      .references(() => book.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => author.id, { onDelete: 'cascade' }),
    /** Порядок соавторов как в строке book.authors. */
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.authorId] }),
    index('book_author_author_idx').on(t.authorId),
  ],
)

/* ── Эталонный каталог (M14): неизменяемые справочные данные ──
   ref_work — произведение, ref_book — издание; сборники связывают их M:N.
   Пользователь эталон не редактирует; правки живут в его book-копиях. */

export const refWork = sqliteTable(
  'ref_work',
  {
    id: id(),
    source: text('source', { enum: ['fantlab', 'openlibrary'] }).notNull(),
    sourceId: text('source_id').notNull(),
    title: text('title').notNull(),
    titleNorm: text('title_norm').notNull(),
    year: integer('year'),
    annotation: text('annotation'),
    fetchedAt: integer('fetched_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ref_work_source_unique').on(t.source, t.sourceId),
    index('ref_work_title_norm_idx').on(t.titleNorm),
  ],
)

export const refWorkAuthor = sqliteTable(
  'ref_work_author',
  {
    workId: text('work_id')
      .notNull()
      .references(() => refWork.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => author.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.authorId] }),
    index('ref_work_author_author_idx').on(t.authorId),
  ],
)

export const refBook = sqliteTable(
  'ref_book',
  {
    id: id(),
    source: text('source', {
      enum: ['fantlab', 'google', 'openlibrary'],
    }).notNull(),
    sourceRef: text('source_ref').notNull(),
    isbn13: text('isbn13'),
    isbn10: text('isbn10'),
    title: text('title').notNull(),
    titleNorm: text('title_norm').notNull(),
    authors: text('authors').notNull().default(''),
    publisher: text('publisher'),
    year: integer('year'),
    pages: integer('pages'),
    heightMm: integer('height_mm'),
    coverType: text('cover_type', { enum: ['soft', 'hard'] }),
    language: text('language').notNull().default('ru'),
    annotation: text('annotation'),
    seriesName: text('series_name'),
    coverUrl: text('cover_url'),
    coverPath: text('cover_path'),
    coverColor: text('cover_color'),
    rawJson: text('raw_json'),
    fetchedAt: integer('fetched_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ref_book_source_unique').on(t.source, t.sourceRef),
    index('ref_book_isbn13_idx').on(t.isbn13),
  ],
)

export const refBookWork = sqliteTable(
  'ref_book_work',
  {
    refBookId: text('ref_book_id')
      .notNull()
      .references(() => refBook.id, { onDelete: 'cascade' }),
    workId: text('work_id')
      .notNull()
      .references(() => refWork.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.refBookId, t.workId] }),
    index('ref_book_work_work_idx').on(t.workId),
  ],
)

export const refBookAuthor = sqliteTable(
  'ref_book_author',
  {
    refBookId: text('ref_book_id')
      .notNull()
      .references(() => refBook.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => author.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.refBookId, t.authorId] }),
    index('ref_book_author_author_idx').on(t.authorId),
  ],
)

export const bookPersonal = sqliteTable(
  'book_personal',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    bookId: text('book_id')
      .notNull()
      .references(() => book.id, { onDelete: 'cascade' }),
    readingStatus: text('reading_status', {
      enum: ['unread', 'reading', 'read', 'abandoned'],
    })
      .notNull()
      .default('unread'),
    /** Когда отметили «читаю» — для «Читаю сейчас» на странице «Чтение». */
    readingStartedAt: integer('reading_started_at', { mode: 'timestamp' }),
    readAt: integer('read_at', { mode: 'timestamp' }),
    rating: integer('rating'),
    review: text('review'),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
    notes: text('notes'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bookId] }),
    check(
      'book_personal_rating_range',
      sql`${t.rating} IS NULL OR (${t.rating} >= 1 AND ${t.rating} <= 5)`,
    ),
  ],
)

export const tag = sqliteTable(
  'tag',
  {
    id: id(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('tag_owner_name_unique').on(t.ownerId, t.name)],
)

export const bookTag = sqliteTable(
  'book_tag',
  {
    bookId: text('book_id')
      .notNull()
      .references(() => book.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.tagId] })],
)
