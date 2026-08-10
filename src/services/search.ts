/**
 * Нормализация текста для поиска: SQLite LOWER()/LIKE не сворачивают регистр
 * кириллицы, поэтому нормализованные копии полей (`titleNorm` и т.п.)
 * готовятся здесь и пишутся рядом с оригиналом при каждом сохранении.
 */
export function normalizeForSearch(value: string): string {
  return value.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim()
}
