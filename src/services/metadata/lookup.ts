import { and, eq, inArray, or } from 'drizzle-orm'

import { db } from '@/db'
import { book } from '@/db/schema/catalog'
import { findEdition } from '@/services/find/core'
import { memberLibraryIds } from '@/services/members'
import type { FindOptions } from '@/services/find/types'
import type { MetadataDraft } from './types'

/**
 * Поиск метаданных по ISBN для экрана «Добавить».
 *
 * Тонкая обёртка над единым ядром (M32): своей цепочки у неё больше нет.
 * Раньше здесь жил отдельный порядок опроса без веб-поиска — из-за чего одна
 * и та же книга в «Добавить» и на «Не распознано» искалась по-разному.
 */
export interface LookupResult {
  isbn13: string
  isbn10: string | null
  draft: MetadataDraft
  sources: Array<string>
  /** Отчёт по каждой ступени: «не нашлось» не должно быть загадкой. */
  probes: Array<{ name: string; outcome: string; detail: string | null }>
  found: boolean
  /** Цепочка оборвана по бюджету — остаток доигрывает воркер. */
  truncated: boolean
  /** Уже есть в доступных книгах — предупреждение о дубле (дубль допустим). */
  duplicates: Array<{ id: string; title: string }>
}

/** Имена ступеней такие же, как в «Сервис → Источники». */
export const SOURCE_NAME: Record<string, string> = {
  reference: 'Свой эталон',
  fantlab: 'FantLab',
  google: 'Google Books',
  openlibrary: 'OpenLibrary',
  web: 'Яндекс Поиск',
  neuro: 'Нейропоиск',
}

async function findDuplicates(userId: string, isbn13: string) {
  const libIds = await memberLibraryIds(userId)
  return db
    .select({ id: book.id, title: book.title })
    .from(book)
    .where(
      and(
        eq(book.isbn13, isbn13),
        or(
          libIds.length > 0 ? inArray(book.libraryId, libIds) : undefined,
          eq(book.addedBy, userId),
        ),
      ),
    )
    .limit(5)
}

export async function lookupIsbn(
  userId: string,
  rawIsbn: string,
  options: FindOptions = {},
): Promise<LookupResult> {
  const found = await findEdition(userId, rawIsbn, options)
  const duplicates = await findDuplicates(userId, found.isbn13)
  return {
    isbn13: found.isbn13,
    isbn10: found.isbn10,
    draft: found.draft,
    sources: found.found,
    probes: found.probes.map((p) => ({
      name: SOURCE_NAME[p.key] ?? p.key,
      outcome: p.outcome,
      detail: p.detail,
    })),
    found: Boolean(found.draft.title),
    truncated: found.truncated,
    duplicates,
  }
}
