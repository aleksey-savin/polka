import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth'
import { book } from './catalog'

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

export type ModerationKind =
  | 'book_cover'
  | 'share'
  | 'ref_work'
  | 'ref_book'
  /** Карточка книги, заполненная ИИ: модератор проверяет данные (M29). */
  | 'ai_book'

/** Очередь: объект публикуется сразу, проверяется потом. */
export const moderationItem = sqliteTable(
  'moderation_item',
  {
    id: id(),
    kind: text('kind', {
      // ai_book — карточка книги, заполненная ИИ: проверяем данные, а не файл
      enum: ['book_cover', 'share', 'ref_work', 'ref_book', 'ai_book'],
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
    /** Запись пришла от ИИ — метка на карточке вместо отдельного раздела. */
    fromAi: integer('from_ai', { mode: 'boolean' }).notNull().default(false),
    /**
     * Черновик для эталона (M29): модератор правит копию, карточка владельца
     * не меняется никогда. JSON с полями title/authors/publisher/year.
     */
    draftJson: text('draft_json'),
    /** Копия ушла в эталон — при отмене решения её оттуда убираем. */
    publishedRefId: text('published_ref_id'),
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
    /**
     * Название объекта на момент решения (M29.1). Храним снимком: объект
     * могут удалить или переименовать, а журнал должен остаться понятным.
     */
    targetTitle: text('target_title'),
    /** Что именно изменилось: «было → стало» для правок копии. */
    details: text('details'),
    createdAt: createdAt(),
  },
  (t) => [index('moderation_log_created_idx').on(sql`${t.createdAt} desc`)],
)

/** Настройки SMTP (M22): одна строка, пароль хранится зашифрованным. */
export const mailSetting = sqliteTable('mail_setting', {
  id: text('id').primaryKey().default('default'),
  host: text('host'),
  port: integer('port'),
  secure: text('secure', { enum: ['none', 'starttls', 'tls'] })
    .notNull()
    .default('tls'),
  username: text('username'),
  /** AES-GCM, ключ выводится из BETTER_AUTH_SECRET; наружу не отдаём. */
  passwordEnc: text('password_enc'),
  fromName: text('from_name'),
  fromEmail: text('from_email'),
  sendReset: integer('send_reset', { mode: 'boolean' }).notNull().default(true),
  sendInvites: integer('send_invites', { mode: 'boolean' })
    .notNull()
    .default(true),
  sendEmailChange: integer('send_email_change', { mode: 'boolean' })
    .notNull()
    .default(true),
  sendNotifications: integer('send_notifications', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** Итог последней отправки — показываем прямо в настройках. */
  lastResult: text('last_result'),
  lastResultAt: integer('last_result_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** Подключение ИИ (M24): ключ шифруется, как SMTP-пароль. */
export const aiSetting = sqliteTable('ai_setting', {
  id: text('id').primaryKey().default('default'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  provider: text('provider', { enum: ['yandex', 'openai'] })
    .notNull()
    .default('yandex'),
  apiKeyEnc: text('api_key_enc'),
  folderId: text('folder_id'),
  model: text('model'),
  /** Для OpenAI-совместимых — свой адрес; у Яндекса подставляется сам. */
  endpoint: text('endpoint'),
  dailyLimit: integer('daily_limit').notNull().default(30),
  lastResult: text('last_result'),
  lastResultAt: integer('last_result_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** Счётчик суточного лимита: ключ и счёт владельца, тратят все. */
export const aiUsage = sqliteTable(
  'ai_usage',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** YYYY-MM-DD в UTC — сутки считаем по серверу. */
    day: text('day').notNull(),
    calls: integer('calls').notNull().default(0),
    tokens: integer('tokens').notNull().default(0),
    /** Поиски в интернете считаем отдельно: это другие деньги. */
    searches: integer('searches').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
)

/**
 * Ответы модели по ISBN (M25). Кэш общий: второй раз тот же номер модели не
 * уходит — ни у этого человека, ни у другого. Храним и «не знаю».
 */
export const aiIsbnGuess = sqliteTable('ai_isbn_guess', {
  isbn13: text('isbn13').primaryKey(),
  /** confirmed — каталог нашёл издание с этим ISBN; work-only — нашлось только
      произведение; unconfirmed — слова модели; unknown — модель не знает. */
  verdict: text('verdict', {
    enum: ['confirmed', 'work-only', 'unconfirmed', 'unknown'],
  }).notNull(),
  title: text('title'),
  authors: text('authors'),
  publisher: text('publisher'),
  year: integer('year'),
  seriesName: text('series_name'),
  /** Добрано по названию и автору: аннотация, объём, обложка (M26.1). */
  pages: integer('pages'),
  annotation: text('annotation'),
  coverUrl: text('cover_url'),
  /** Кандидаты обложек для свайпа (JSON-массив ссылок, до 5). */
  coverOptions: text('cover_options'),
  /** Что подтвердилось: издание в эталоне и/или произведение. */
  refBookId: text('ref_book_id'),
  workId: text('work_id'),
  model: text('model'),
  /** Каким путём получено: sources · web-extract · web-generative · model. */
  via: text('via'),
  /** Пути, которые человек отверг кнопкой «Искать дальше» (JSON-массив). */
  rejectedVias: text('rejected_vias'),
  /** Все найденные варианты (JSON-массив) — листаются без новых запросов. */
  variants: text('variants'),
  /**
   * Страницы, найденные поиском, но ещё не прочитанные (M32). Читаем по одной:
   * за страницу платим запросом к модели. «Искать дальше» берёт следующую
   * отсюда — без нового платного поиска.
   */
  pendingPages: text('pending_pages'),
  /** Страница, на которой встретился сам номер. */
  proofUrl: text('proof_url'),
  proofTitle: text('proof_title'),
  rawJson: text('raw_json'),
  askedAt: integer('asked_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Применение разбора к книге: хранит прежние значения (для отката) и живёт до
 * решения модератора. В эталон запись уходит только после проверки человеком.
 */
export const aiSuggestion = sqliteTable(
  'ai_suggestion',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    bookId: text('book_id')
      .notNull()
      .references(() => book.id, { onDelete: 'cascade' }),
    isbn13: text('isbn13').notNull(),
    verdict: text('verdict', {
      enum: ['confirmed', 'work-only', 'unconfirmed', 'unknown'],
    }).notNull(),
    /** applied — стоит в карточке и ждёт модератора; approved — ушло в эталон. */
    status: text('status', {
      // proposed — найдено и ждёт решения человека (M26.2)
      enum: ['proposed', 'applied', 'reverted', 'approved', 'rejected'],
    })
      .notNull()
      .default('applied'),
    /** Каким путём получены данные: sources · web-extract · web-generative. */
    via: text('via'),
    /** Снимок карточки до применения — им и откатываем. */
    beforeJson: text('before_json').notNull(),
    afterJson: text('after_json').notNull(),
    appliedBy: text('applied_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    appliedAt: integer('applied_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    reviewedBy: text('reviewed_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
    reviewNote: text('review_note'),
  },
  (t) => [
    index('ai_suggestion_book_idx').on(t.bookId),
    index('ai_suggestion_status_idx').on(t.status),
  ],
)

/** Ключи внешних источников (M25.1): Google Books и прочее — шифрованно. */
export const sourceSetting = sqliteTable('source_setting', {
  id: text('id').primaryKey().default('default'),
  googleKeyEnc: text('google_key_enc'),
  /** Поиск в интернете по ISBN (M26): ключ и каталог берём из настроек ИИ. */
  webEnabled: integer('web_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** extract — выдача + извлечение моделью; generative — ответ с поиском. */
  webMode: text('web_mode', { enum: ['extract', 'generative'] })
    .notNull()
    .default('extract'),
  webDailyLimit: integer('web_daily_limit').notNull().default(100),
  /** Платный генеративный поиск — только если бесплатный путь не справился. */
  webPaidFallback: integer('web_paid_fallback', { mode: 'boolean' })
    .notNull()
    .default(false),
  webLastResult: text('web_last_result'),
  webLastResultAt: integer('web_last_result_at', { mode: 'timestamp' }),
  lastCheck: text('last_check'),
  lastCheckAt: integer('last_check_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/**
 * Источники книг и порядок их опроса (M30).
 *
 * Раньше порядок был зашит в код, а FantLab и OpenLibrary нельзя было даже
 * выключить. Теперь строка на источник: включён ли и на каком месте стоит.
 */
export const bookSource = sqliteTable('book_source', {
  /** reference · fantlab · google · openlibrary · web · neuro · model */
  key: text('key').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  position: integer('position').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
})
