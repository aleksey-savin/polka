import { and, eq, isNotNull, isNull } from 'drizzle-orm'

import { db } from '@/db'
import { book } from '@/db/schema/catalog'
import { coverAbsolutePath, extractCoverAccent } from './covers'

/** Одноразовый бэкфилл: цвета для обложек, сохранённых до появления coverColor. */
export async function backfillCoverColors(): Promise<void> {
  const rows = await db
    .select({ id: book.id, coverPath: book.coverPath })
    .from(book)
    .where(and(isNotNull(book.coverPath), isNull(book.coverColor)))
  for (const row of rows) {
    if (!row.coverPath) continue
    try {
      const color = await extractCoverAccent(coverAbsolutePath(row.coverPath))
      if (color) {
        await db
          .update(book)
          .set({ coverColor: color })
          .where(eq(book.id, row.id))
      }
    } catch {
      // обложка могла пропасть с диска — пропускаем
    }
  }
}
