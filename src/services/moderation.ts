import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { db } from '@/db'
import { user } from '@/db/schema/auth'
import {
  book,
  bookList,
  shelf,
  library,
  refBook,
  refWork,
} from '@/db/schema/catalog'
import { share } from '@/db/schema/circulation'
import {
  moderationItem,
  moderationLog,
  moderationReport,
  userAccount,
} from '@/db/schema/moderation'
import { AppError } from './errors'
import { log } from '@/lib/logger'
import type { ModerationKind } from '@/db/schema/moderation'

/**
 * Роли и пост-модерация (M21).
 *
 * Публикация не задерживается: ссылка работает сразу, объект попадает в
 * очередь. Модерируем общий слой — загруженные обложки, эталон, публичные
 * витрины; личные рецензии и заметки сюда не попадают.
 */

export type Role = 'user' | 'moderator' | 'admin'

export interface Account {
  role: Role
  publishBanned: boolean
  publishBanReason: string | null
  blocked: boolean
  blockedReason: string | null
}

const DEFAULT: Account = {
  role: 'user',
  publishBanned: false,
  publishBanReason: null,
  blocked: false,
  blockedReason: null,
}

/**
 * Первый зарегистрированный — админ.
 * Иначе после выкатки некому назначить модераторов и разобрать очередь.
 */
export async function ensureFirstAdmin(): Promise<void> {
  const [admin] = await db
    .select({ userId: userAccount.userId })
    .from(userAccount)
    .where(eq(userAccount.role, 'admin'))
    .limit(1)
  if (admin) return

  const [first] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1)
  if (!first) return

  await db
    .insert(userAccount)
    .values({ userId: first.id, role: 'admin' })
    .onConflictDoUpdate({
      target: userAccount.userId,
      set: { role: 'admin', updatedAt: new Date() },
    })
  log.info('moderation', 'первый пользователь назначен админом', {
    user: first.name,
  })
}

export async function accountOf(userId: string): Promise<Account> {
  const [row] = await db
    .select()
    .from(userAccount)
    .where(eq(userAccount.userId, userId))
  if (!row) return DEFAULT
  return {
    role: row.role,
    publishBanned: row.publishBannedAt !== null,
    publishBanReason: row.publishBanReason,
    blocked: row.blockedAt !== null,
    blockedReason: row.blockedReason,
  }
}

export async function requireModerator(userId: string): Promise<Role> {
  const { role } = await accountOf(userId)
  if (role === 'user') throw new AppError('Нужны права модератора', 'forbidden')
  return role
}

export async function requireAdmin(userId: string): Promise<void> {
  const { role } = await accountOf(userId)
  if (role !== 'admin') throw new AppError('Нужны права админа', 'forbidden')
}

/** Публиковать нельзя забаненным — проверяем перед созданием ссылки. */
export async function assertCanPublish(userId: string): Promise<void> {
  const account = await accountOf(userId)
  if (account.blocked) throw new AppError('Аккаунт заблокирован', 'forbidden')
  if (account.publishBanned) {
    throw new AppError(
      account.publishBanReason
        ? `Публикация запрещена: ${account.publishBanReason}`
        : 'Публикация запрещена модератором',
      'forbidden',
    )
  }
}

/** Постановка в очередь — идемпотентная: повторная публикация не плодит строк. */
export async function enqueue(
  kind: ModerationKind,
  targetId: string,
  ownerId: string | null,
  fromAi = false,
  /** Зачем поставили: у проверки актуальности причина не «жалоба». */
  reason?: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: moderationItem.id, status: moderationItem.status })
    .from(moderationItem)
    .where(
      and(eq(moderationItem.kind, kind), eq(moderationItem.targetId, targetId)),
    )
  if (existing) {
    // разобранное снова на проверку не поднимаем: решение уже принято
    return
  }
  await db
    .insert(moderationItem)
    .values({ kind, targetId, ownerId, fromAi, reason: reason ?? null })
}

export interface QueueRow {
  id: string
  kind: ModerationKind
  targetId: string
  status: 'pending' | 'ok' | 'removed'
  reportCount: number
  reason: string | null
  createdAt: Date
  ownerName: string | null
  /** Находка ИИ — метка на карточке вместо отдельного раздела. */
  fromAi: boolean
  /** Копия уже в эталоне. */
  inReference: boolean
  /** Что показать модератору: заголовок, подпись, картинка. */
  title: string
  subtitle: string
  coverUrl: string | null
  reports: Array<{ reason: string; note: string | null; createdAt: Date }>
}

const KIND_TITLE: Record<ModerationKind, string> = {
  book_cover: 'Обложка книги',
  share: 'Публичная ссылка',
  ref_work: 'Эталон · произведение',
  ref_book: 'Эталон · издание',
  ai_book: 'Книга · заполнил ИИ',
}

/** Очередь модератора: жалобы вперёд, дальше — по свежести. */
export type QueueFilter = 'reported' | 'pending' | 'resolved'

const PAGE = 20

/** Условие фильтра — одно на список и на счётчик, чтобы не разъезжались. */
function queueWhere(filter: QueueFilter) {
  return filter === 'reported'
    ? and(
        eq(moderationItem.status, 'pending'),
        sql`${moderationItem.reportCount} > 0`,
      )
    : filter === 'pending'
      ? and(
          eq(moderationItem.status, 'pending'),
          eq(moderationItem.reportCount, 0),
        )
      : sql`${moderationItem.status} != 'pending'`
}

/** Счётчики табов: дешёвый COUNT вместо длины загруженного списка. */
export async function queueCounts(
  userId: string,
): Promise<Record<QueueFilter, number>> {
  await requireModerator(userId)
  const one = async (filter: QueueFilter) => {
    const [row] = await db
      .select({ n: count() })
      .from(moderationItem)
      .where(queueWhere(filter))
    return row?.n ?? 0
  }
  const [reported, pending, resolved] = await Promise.all([
    one('reported'),
    one('pending'),
    one('resolved'),
  ])
  return { reported, pending, resolved }
}

export interface QueuePage {
  rows: Array<QueueRow>
  /** Метка последней записи; передать обратно, чтобы получить следующие. */
  cursor: string | null
}

/**
 * Курсор — пара «дата + id».
 *
 * Дата в секундах: drizzle хранит `timestamp` секундами, и сравнение с
 * миллисекундами всегда истинно — страницы повторялись бы. Пара нужна потому,
 * что при пакетной постановке (скан стопки, бэкфилл) десятки записей попадают
 * в одну секунду.
 */
const seconds = (date: Date) => Math.floor(date.getTime() / 1000)

const encodeCursor = (createdAt: Date, id: string) =>
  `${seconds(createdAt)}:${id}`

function decodeCursor(raw: string): { time: number; id: string } | null {
  const at = raw.indexOf(':')
  if (at <= 0) return null
  const time = Number(raw.slice(0, at))
  const id = raw.slice(at + 1)
  return Number.isFinite(time) && id ? { time, id } : null
}

/**
 * Страница очереди. Курсор по дате, а не offset: пока модератор смотрит,
 * приходят новые жалобы — offset сдвинулся бы и записи стали дублироваться.
 */
export async function listQueue(
  userId: string,
  filter: QueueFilter,
  cursor?: string | null,
): Promise<QueuePage> {
  await requireModerator(userId)
  const rows = await db
    .select({
      id: moderationItem.id,
      kind: moderationItem.kind,
      targetId: moderationItem.targetId,
      status: moderationItem.status,
      reportCount: moderationItem.reportCount,
      reason: moderationItem.reason,
      createdAt: moderationItem.createdAt,
      ownerName: user.name,
      fromAi: moderationItem.fromAi,
      publishedRefId: moderationItem.publishedRefId,
    })
    .from(moderationItem)
    .leftJoin(user, eq(user.id, moderationItem.ownerId))
    .where(
      (() => {
        const after = cursor ? decodeCursor(cursor) : null
        if (!after) return queueWhere(filter)
        return and(
          queueWhere(filter),
          sql`(${moderationItem.createdAt} < ${after.time} or (${moderationItem.createdAt} = ${after.time} and ${moderationItem.id} < ${after.id}))`,
        )
      })(),
    )
    .orderBy(desc(moderationItem.createdAt), desc(moderationItem.id))
    .limit(PAGE + 1)
  if (rows.length === 0) return { rows: [], cursor: null }

  const hasMore = rows.length > PAGE
  const page = hasMore ? rows.slice(0, PAGE) : rows

  const reports = await db
    .select()
    .from(moderationReport)
    .where(
      inArray(
        moderationReport.itemId,
        page.map((r) => r.id),
      ),
    )
    .orderBy(desc(moderationReport.createdAt))

  const out: Array<QueueRow> = []
  for (const row of page) {
    const view = await describeTarget(row.kind, row.targetId)
    out.push({
      ...row,
      inReference: row.publishedRefId !== null,
      ...view,
      reports: reports
        .filter((rep) => rep.itemId === row.id)
        .map((rep) => ({
          reason: rep.reason,
          note: rep.note,
          createdAt: rep.createdAt,
        })),
    })
  }
  const last = page[page.length - 1]
  return {
    rows: out,
    cursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  }
}

/** Человеческое описание объекта: что именно смотрит модератор. */
async function describeTarget(
  kind: ModerationKind,
  targetId: string,
): Promise<{ title: string; subtitle: string; coverUrl: string | null }> {
  if (kind === 'ai_book' || kind === 'book_cover') {
    const [row] = await db
      .select({
        title: book.title,
        authors: book.authors,
        coverPath: book.coverPath,
      })
      .from(book)
      .where(eq(book.id, targetId))
    return {
      title: row?.title ?? 'Книга удалена',
      subtitle: row?.authors ?? '',
      coverUrl: row?.coverPath ? `/api/covers/${targetId}` : null,
    }
  }
  if (kind === 'share') {
    const [row] = await db
      .select({
        scope: share.scope,
        token: share.token,
        listTitle: bookList.title,
        shelfName: shelf.name,
        libraryName: library.name,
        revokedAt: share.revokedAt,
      })
      .from(share)
      .leftJoin(bookList, eq(bookList.id, share.listId))
      .leftJoin(shelf, eq(shelf.id, share.shelfId))
      .leftJoin(library, eq(library.id, share.libraryId))
      .where(eq(share.id, targetId))
    const name =
      row?.listTitle ?? row?.shelfName ?? row?.libraryName ?? 'Ссылка удалена'
    return {
      title: name,
      subtitle: [
        row?.scope === 'list'
          ? 'список'
          : row?.scope === 'shelf'
            ? 'полка'
            : 'библиотека',
        row?.revokedAt ? 'ссылка отозвана' : `/s/${row?.token ?? ''}`,
      ]
        .filter(Boolean)
        .join(' · '),
      coverUrl: null,
    }
  }
  if (kind === 'ref_book') {
    const [row] = await db
      .select({
        title: refBook.title,
        publisher: refBook.publisher,
        year: refBook.year,
        coverPath: refBook.coverPath,
      })
      .from(refBook)
      .where(eq(refBook.id, targetId))
    return {
      title: row?.title ?? 'Издание удалено',
      subtitle: [row?.publisher, row?.year].filter(Boolean).join(' · '),
      coverUrl: row?.coverPath ? `/api/ref-covers/${targetId}` : null,
    }
  }
  const [row] = await db
    .select({ title: refWork.title, year: refWork.year })
    .from(refWork)
    .where(eq(refWork.id, targetId))
  return {
    title: row?.title ?? 'Произведение удалено',
    subtitle: row?.year ? String(row.year) : '',
    coverUrl: null,
  }
}

export { KIND_TITLE }

/** Жалоба — в том числе от гостя без аккаунта. */
export async function report(
  kind: ModerationKind,
  targetId: string,
  reason: string,
  note: string | null,
  reporterId: string | null,
): Promise<void> {
  let [item] = await db
    .select({ id: moderationItem.id })
    .from(moderationItem)
    .where(
      and(eq(moderationItem.kind, kind), eq(moderationItem.targetId, targetId)),
    )
  if (!item) {
    const [created] = await db
      .insert(moderationItem)
      .values({ kind, targetId, ownerId: null })
      .returning({ id: moderationItem.id })
    item = created
  }
  if (!item) throw new AppError('Не удалось принять жалобу', 'invalid')

  await db
    .insert(moderationReport)
    .values({ itemId: item.id, reason, note, reporterId })
  await db
    .update(moderationItem)
    .set({
      reportCount: sql`${moderationItem.reportCount} + 1`,
      // разобранное с новой жалобой снова попадает к модератору
      status: 'pending',
    })
    .where(eq(moderationItem.id, item.id))
  log.info('moderation', 'жалоба принята', { kind, targetId, reason })
}

/** Решение модератора. Снятие — всегда с причиной. */
export async function resolve(
  userId: string,
  itemId: string,
  decision: 'ok' | 'removed',
  reason: string | null,
  deleteFile = false,
): Promise<void> {
  await requireModerator(userId)
  if (decision === 'removed' && !reason?.trim()) {
    throw new AppError('Укажите причину — она уйдёт владельцу', 'invalid')
  }
  const [item] = await db
    .select()
    .from(moderationItem)
    .where(eq(moderationItem.id, itemId))
  if (!item) throw new AppError('Объект не найден', 'not_found')

  await db
    .update(moderationItem)
    .set({
      status: decision,
      reason: reason?.trim() || null,
      reviewedBy: userId,
      reviewedAt: new Date(),
    })
    .where(eq(moderationItem.id, itemId))

  if (decision === 'removed') {
    // ссылка перестаёт работать, книги владельца остаются на месте
    if (item.kind === 'share') {
      await db
        .update(share)
        .set({ revokedAt: new Date() })
        .where(eq(share.id, item.targetId))
    }
    if (item.kind === 'book_cover' && deleteFile) {
      const { deleteCover } = await import('./covers')
      await deleteCover(item.targetId)
      await db
        .update(book)
        .set({ coverPath: null, coverColor: null })
        .where(eq(book.id, item.targetId))
    }
  }

  const decided = await describeTarget(item.kind, item.targetId)
  await writeLog(userId, decision === 'ok' ? 'approve' : 'remove', {
    kind: item.kind,
    targetId: item.targetId,
    subjectId: item.ownerId,
    reason: reason?.trim() || null,
    targetTitle: decided.title,
    details: decision === 'removed' && deleteFile ? 'файл удалён' : null,
  })
}

async function writeLog(
  actorId: string,
  action: string,
  fields: {
    kind?: string | null
    targetId?: string | null
    subjectId?: string | null
    reason?: string | null
    /** Снимок названия: объект переименуют или удалят, журнал останется. */
    targetTitle?: string | null
    /** Что изменилось: «было → стало». */
    details?: string | null
  },
): Promise<void> {
  await db.insert(moderationLog).values({ actorId, action, ...fields })
}

export interface UserRow {
  id: string
  name: string
  email: string
  role: Role
  publishBanned: boolean
  blocked: boolean
  bookCount: number
  removedCount: number
}

export async function listUsers(userId: string): Promise<Array<UserRow>> {
  await requireAdmin(userId)
  const users = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .orderBy(asc(user.createdAt))
  const accounts = await db.select().from(userAccount)
  const books = await db
    .select({ addedBy: book.addedBy, n: count() })
    .from(book)
    .groupBy(book.addedBy)
  const removed = await db
    .select({ ownerId: moderationItem.ownerId, n: count() })
    .from(moderationItem)
    .where(eq(moderationItem.status, 'removed'))
    .groupBy(moderationItem.ownerId)

  return users.map((u) => {
    const acc = accounts.find((a) => a.userId === u.id)
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: acc?.role ?? 'user',
      publishBanned: acc?.publishBannedAt !== null && acc !== undefined,
      blocked: acc?.blockedAt !== null && acc !== undefined,
      bookCount: books.find((b) => b.addedBy === u.id)?.n ?? 0,
      removedCount: removed.find((r) => r.ownerId === u.id)?.n ?? 0,
    }
  })
}

async function upsertAccount(
  targetId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(userAccount)
    .values({ userId: targetId, ...patch })
    .onConflictDoUpdate({
      target: userAccount.userId,
      set: { ...patch, updatedAt: new Date() },
    })
}

export async function setRole(
  userId: string,
  targetId: string,
  role: Role,
): Promise<void> {
  await requireAdmin(userId)
  if (targetId === userId && role !== 'admin') {
    // иначе можно случайно снять с себя права и потерять доступ
    throw new AppError('Нельзя снять админку с самого себя', 'invalid')
  }
  await upsertAccount(targetId, { role })
  await writeLog(userId, `role:${role}`, { subjectId: targetId })
}

export async function setPublishBan(
  userId: string,
  targetId: string,
  banned: boolean,
  reason: string | null,
): Promise<void> {
  await requireAdmin(userId)
  await upsertAccount(targetId, {
    publishBannedAt: banned ? new Date() : null,
    publishBanReason: banned ? (reason?.trim() ?? null) : null,
  })
  await writeLog(userId, banned ? 'publish-ban' : 'publish-unban', {
    subjectId: targetId,
    reason: reason?.trim() || null,
  })
}

export async function setBlocked(
  userId: string,
  targetId: string,
  blocked: boolean,
  reason: string | null,
): Promise<void> {
  await requireAdmin(userId)
  if (targetId === userId) {
    throw new AppError('Нельзя заблокировать самого себя', 'invalid')
  }
  await upsertAccount(targetId, {
    blockedAt: blocked ? new Date() : null,
    blockedReason: blocked ? (reason?.trim() ?? null) : null,
  })
  await writeLog(userId, blocked ? 'block' : 'unblock', {
    subjectId: targetId,
    reason: reason?.trim() || null,
  })
}

export interface LogRow {
  id: string
  action: string
  kind: string | null
  targetId: string | null
  targetTitle: string | null
  details: string | null
  reason: string | null
  createdAt: Date
  actorName: string | null
  subjectName: string | null
}

export interface LogPage {
  rows: Array<LogRow>
  cursor: string | null
}

/** Журнал страницами: он растёт вечно, тянуть его целиком нельзя. */
export async function listLog(
  userId: string,
  cursor?: string | null,
): Promise<LogPage> {
  await requireModerator(userId)
  const actor = db.select().from(user).as('actor')
  const rows = await db
    .select({
      id: moderationLog.id,
      action: moderationLog.action,
      kind: moderationLog.kind,
      targetId: moderationLog.targetId,
      targetTitle: moderationLog.targetTitle,
      details: moderationLog.details,
      reason: moderationLog.reason,
      createdAt: moderationLog.createdAt,
      actorName: actor.name,
      subjectId: moderationLog.subjectId,
    })
    .from(moderationLog)
    .leftJoin(actor, eq(actor.id, moderationLog.actorId))
    .where(
      (() => {
        const after = cursor ? decodeCursor(cursor) : null
        if (!after) return undefined
        return sql`(${moderationLog.createdAt} < ${after.time} or (${moderationLog.createdAt} = ${after.time} and ${moderationLog.id} < ${after.id}))`
      })(),
    )
    .orderBy(desc(moderationLog.createdAt), desc(moderationLog.id))
    .limit(PAGE + 1)
  const hasMore = rows.length > PAGE
  const page = hasMore ? rows.slice(0, PAGE) : rows
  const subjects = await db.select({ id: user.id, name: user.name }).from(user)
  const out = page.map((r) => ({
    id: r.id,
    action: r.action,
    kind: r.kind,
    targetId: r.targetId,
    targetTitle: r.targetTitle,
    details: r.details,
    reason: r.reason,
    createdAt: r.createdAt,
    actorName: r.actorName,
    subjectName: subjects.find((s) => s.id === r.subjectId)?.name ?? null,
  }))
  const lastLog = page[page.length - 1]
  return {
    rows: out,
    cursor:
      hasMore && lastLog ? encodeCursor(lastLog.createdAt, lastLog.id) : null,
  }
}

/** Решения по объектам владельца — плашки «снято модератором». */
export async function removalsFor(
  kind: ModerationKind,
  targetIds: Array<string>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (targetIds.length === 0) return out
  const rows = await db
    .select({
      targetId: moderationItem.targetId,
      reason: moderationItem.reason,
    })
    .from(moderationItem)
    .where(
      and(
        eq(moderationItem.kind, kind),
        eq(moderationItem.status, 'removed'),
        inArray(moderationItem.targetId, targetIds),
      ),
    )
  for (const row of rows) {
    out.set(row.targetId, row.reason ?? 'без указания причины')
  }
  return out
}

/** Сколько объектов ждёт разбора — бейдж в меню. */
export async function pendingCount(userId: string): Promise<number> {
  const { role } = await accountOf(userId)
  if (role === 'user') return 0
  const [row] = await db
    .select({ n: count() })
    .from(moderationItem)
    .where(
      and(
        eq(moderationItem.status, 'pending'),
        isNull(moderationItem.reviewedAt),
      ),
    )
  return row?.n ?? 0
}

export interface Draft {
  title: string
  authors: string
  publisher: string | null
  year: number | null
  /**
   * Полные данные издания (M34). Без них эталон остаётся куцым: модератору
   * нечем занести аннотацию и серию, а именно за ними и приходит следующий
   * владелец этой книги.
   */
  pages: number | null
  language: string
  seriesName: string | null
  annotation: string | null
  coverUrl: string | null
}

/**
 * Черновик записи для эталона (M29).
 *
 * Модератор правит копию, а не карточку владельца: спор «это моя книга»
 * невозможен в принципе, а в эталон уходит именно проверенная копия.
 */
export async function getDraft(
  userId: string,
  itemId: string,
): Promise<Draft | null> {
  await requireModerator(userId)
  const [item] = await db
    .select()
    .from(moderationItem)
    .where(eq(moderationItem.id, itemId))
  if (!item) throw new AppError('Объект не найден', 'not_found')
  if (item.draftJson) return JSON.parse(item.draftJson) as Draft

  // копию делаем из того, что видно модератору
  const view = await describeTarget(item.kind, item.targetId)
  if (item.kind === 'ai_book') {
    const [row] = await db.select().from(book).where(eq(book.id, item.targetId))
    if (row) {
      return {
        title: row.title,
        authors: row.authors,
        publisher: row.publisher,
        year: row.year,
        pages: row.pages,
        language: row.language,
        seriesName: null,
        annotation: row.annotation,
        coverUrl: null,
      }
    }
  }
  if (item.kind === 'ref_book') {
    const [row] = await db
      .select()
      .from(refBook)
      .where(eq(refBook.id, item.targetId))
    if (row) {
      return {
        title: row.title,
        authors: row.authors,
        publisher: row.publisher,
        year: row.year,
        pages: row.pages,
        language: row.language,
        seriesName: row.seriesName,
        annotation: row.annotation,
        coverUrl: row.coverUrl,
      }
    }
  }
  if (item.kind === 'ref_work') {
    const [row] = await db
      .select()
      .from(refWork)
      .where(eq(refWork.id, item.targetId))
    if (row) {
      return {
        title: row.title,
        authors: '',
        publisher: null,
        year: row.year,
        pages: null,
        language: 'ru',
        seriesName: null,
        annotation: row.annotation,
        coverUrl: null,
      }
    }
  }
  return {
    title: view.title,
    authors: view.subtitle,
    publisher: null,
    year: null,
    pages: null,
    language: 'ru',
    seriesName: null,
    annotation: null,
    coverUrl: null,
  }
}

export async function saveDraft(
  userId: string,
  itemId: string,
  draft: Draft,
): Promise<void> {
  await requireModerator(userId)
  if (!draft.title.trim()) throw new AppError('Без названия нельзя', 'invalid')
  const before = await getDraft(userId, itemId)
  const [item] = await db
    .select()
    .from(moderationItem)
    .where(eq(moderationItem.id, itemId))
  await db
    .update(moderationItem)
    .set({ draftJson: JSON.stringify(draft) })
    .where(eq(moderationItem.id, itemId))

  // «поправил» без подробностей бесполезно: пишем, что именно изменилось
  const changes: Array<string> = []
  if (before && before.title !== draft.title) {
    changes.push(`название: «${before.title}» → «${draft.title}»`)
  }
  if (before && before.authors !== draft.authors) {
    changes.push(`авторы: «${before.authors}» → «${draft.authors}»`)
  }
  if (before && before.publisher !== draft.publisher) {
    changes.push(
      `издательство: «${before.publisher ?? '—'}» → «${draft.publisher ?? '—'}»`,
    )
  }
  if (before && before.year !== draft.year) {
    changes.push(`год: ${before.year ?? '—'} → ${draft.year ?? '—'}`)
  }
  await writeLog(userId, 'draft-edit', {
    kind: item?.kind ?? null,
    targetId: item?.targetId ?? itemId,
    subjectId: item?.ownerId ?? null,
    targetTitle: before?.title ?? draft.title,
    details: changes.join(' · ') || null,
  })
}

/**
 * Одобрение. Публикация в эталон — отдельный шаг: одобрить можно и без неё.
 * В эталон уходит копия (черновик), оригинал владельца не трогаем.
 */
export async function approveItem(
  userId: string,
  itemId: string,
  toReference = false,
): Promise<void> {
  await requireModerator(userId)
  const [item] = await db
    .select()
    .from(moderationItem)
    .where(eq(moderationItem.id, itemId))
  if (!item) throw new AppError('Объект не найден', 'not_found')

  let publishedRefId: string | null = null
  if (
    toReference &&
    (item.kind === 'ref_book' ||
      item.kind === 'ref_work' ||
      item.kind === 'ai_book')
  ) {
    const draft = await getDraft(userId, itemId)
    if (draft) {
      const { normalizeForSearch } = await import('./search')
      const { refChecksum } = await import('./reference/checksum')
      const isbn13 =
        item.kind === 'ref_book'
          ? ((
              await db
                .select({ isbn13: refBook.isbn13 })
                .from(refBook)
                .where(eq(refBook.id, item.targetId))
            )[0]?.isbn13 ?? null)
          : item.kind === 'ai_book'
            ? ((
                await db
                  .select({ isbn13: book.isbn13 })
                  .from(book)
                  .where(eq(book.id, item.targetId))
              )[0]?.isbn13 ?? null)
            : null
      const [created] = await db
        .insert(refBook)
        .values({
          source: 'manual',
          sourceRef: `moderated:${item.id}`,
          isbn13,
          title: draft.title.trim(),
          titleNorm: normalizeForSearch(draft.title),
          authors: draft.authors.trim(),
          publisher: draft.publisher,
          year: draft.year,
          // полное издание (M34): за этим и приходит следующий владелец
          pages: draft.pages,
          language: draft.language,
          seriesName: draft.seriesName,
          annotation: draft.annotation,
          coverUrl: draft.coverUrl,
          checksum: refChecksum(draft),
        })
        .onConflictDoNothing()
        .returning({ id: refBook.id })
      publishedRefId = created?.id ?? null

      // Ссылка на эталон обязательна: книга, сохранённая до модерации, иначе
      // осталась бы без связи, и обновление до неё не дошло бы никогда.
      if (publishedRefId) {
        const { linkBooksToReference } = await import('./reference')
        await linkBooksToReference(publishedRefId, isbn13)
      }
    }
  }

  await db
    .update(moderationItem)
    .set({
      status: 'ok',
      reason: null,
      reviewedBy: userId,
      reviewedAt: new Date(),
      publishedRefId,
    })
    .where(eq(moderationItem.id, itemId))
  const approved = await describeTarget(item.kind, item.targetId)
  await writeLog(userId, publishedRefId ? 'approve-ref' : 'approve', {
    kind: item.kind,
    targetId: item.targetId,
    subjectId: item.ownerId,
    targetTitle: approved.title,
    details: item.fromAi ? 'нашёл ИИ' : null,
  })
}

/**
 * Отмена решения: запись возвращается в очередь, последствия снимаются —
 * ссылка снова работает, копия убирается из эталона.
 */
export async function undoDecision(
  userId: string,
  itemId: string,
): Promise<void> {
  await requireModerator(userId)
  const [item] = await db
    .select()
    .from(moderationItem)
    .where(eq(moderationItem.id, itemId))
  if (!item) throw new AppError('Объект не найден', 'not_found')
  if (item.status === 'pending') return

  if (item.status === 'removed' && item.kind === 'share') {
    await db
      .update(share)
      .set({ revokedAt: null })
      .where(eq(share.id, item.targetId))
  }
  if (item.publishedRefId) {
    await db.delete(refBook).where(eq(refBook.id, item.publishedRefId))
  }

  await db
    .update(moderationItem)
    .set({
      status: 'pending',
      reason: null,
      reviewedBy: null,
      reviewedAt: null,
      publishedRefId: null,
    })
    .where(eq(moderationItem.id, itemId))
  const undone = await describeTarget(item.kind, item.targetId)
  await writeLog(userId, 'undo', {
    kind: item.kind,
    targetId: item.targetId,
    subjectId: item.ownerId,
    reason: item.reason,
    targetTitle: undone.title,
    details:
      item.status === 'removed'
        ? item.kind === 'share'
          ? 'ссылка снова работает'
          : 'снятие отменено'
        : item.publishedRefId
          ? 'копия убрана из эталона'
          : null,
  })
}
