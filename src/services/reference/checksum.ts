import { createHash } from 'node:crypto'

/**
 * Контрольная сумма записи эталона (M34).
 *
 * У книги хранится сумма той версии эталона, которую в неё применили.
 * Разошлись — значит запись дополнили, и владельцу есть что подтянуть.
 * Это одно сравнение вместо разбора десятка полей на каждой карточке.
 */

/** Поля издания, которые едут из эталона в карточку. */
export const SYNCED_FIELDS = [
  'title',
  'authors',
  'publisher',
  'year',
  'pages',
  'language',
  'seriesName',
  'annotation',
  'coverUrl',
] as const

export type SyncedField = (typeof SYNCED_FIELDS)[number]

export type RefLike = Partial<
  Record<SyncedField, string | number | null | undefined>
>

/** Пустое, отсутствующее и «одни пробелы» — для суммы одно и то же. */
const norm = (value: string | number | null | undefined): string =>
  value === null || value === undefined
    ? ''
    : String(value).replace(/\s+/g, ' ').trim()

export function refChecksum(row: RefLike): string {
  const payload = SYNCED_FIELDS.map((f) => `${f}=${norm(row[f])}`).join(' ')
  // sha1 достаточно: это не защита от подделки, а признак «данные изменились»
  return createHash('sha1').update(payload).digest('hex').slice(0, 16)
}
