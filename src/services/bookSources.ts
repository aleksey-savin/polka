import { asc } from 'drizzle-orm'

import { db } from '@/db'
import { bookSource } from '@/db/schema/moderation'
import { log } from '@/lib/logger'
import { requireAdmin } from './moderation'

/**
 * Источники книг и порядок их опроса (M30).
 *
 * Один список — он же цепочка поиска: код читает порядок отсюда, а не знает
 * его «зашитым». Выключенный источник пропускается.
 */

export type SourceKey =
  'reference' | 'fantlab' | 'google' | 'openlibrary' | 'web' | 'neuro' | 'model'

export interface SourceInfo {
  key: SourceKey
  name: string
  hint: string
  /** Платный — влияет на решение «двигать ли вверх». */
  paid: boolean
  /** Свой эталон не выключается: бесплатный, мгновенный и наш. */
  locked?: boolean
  /** Куда ведёт настройка источника, если она есть. */
  settings?: 'google' | 'ai'
}

export const SOURCES: Array<SourceInfo> = [
  {
    key: 'reference',
    name: 'Свой эталон',
    hint: 'проверено модератором',
    paid: false,
    locked: true,
  },
  {
    key: 'fantlab',
    name: 'FantLab',
    hint: 'русские издания, фантастика, циклы',
    paid: false,
  },
  {
    key: 'google',
    name: 'Google Books',
    hint: 'широкий охват',
    paid: false,
    settings: 'google',
  },
  {
    key: 'openlibrary',
    name: 'OpenLibrary',
    hint: 'из российских сетей отвечает через раз',
    paid: false,
  },
  {
    key: 'web',
    name: 'Яндекс Поиск',
    hint: 'страницы магазинов и библиотек',
    paid: true,
    settings: 'ai',
  },
  {
    key: 'neuro',
    name: 'Нейропоиск',
    hint: 'ответ со ссылками на источники',
    paid: true,
    settings: 'ai',
  },
  {
    key: 'model',
    name: 'Модель по памяти',
    hint: 'последняя попытка, номеров не знает',
    paid: true,
    settings: 'ai',
  },
]

const DEFAULT_ORDER: Array<SourceKey> = SOURCES.map((s) => s.key)

export interface SourceState {
  key: SourceKey
  enabled: boolean
  position: number
}

/** Состояние источников: чего нет в базе — берём по умолчанию. */
export async function sourceStates(): Promise<Array<SourceState>> {
  const rows = await db
    .select()
    .from(bookSource)
    .orderBy(asc(bookSource.position))
  const saved = new Map(rows.map((r) => [r.key as SourceKey, r]))
  return DEFAULT_ORDER.map((key, index) => {
    const row = saved.get(key)
    return {
      key,
      // по умолчанию включено всё, кроме Нейропоиска: он дороже прочих на
      // порядок, пусть владелец включает его осознанно
      enabled: row?.enabled ?? key !== 'neuro',
      position: row?.position ?? index,
    }
  }).sort((a, b) => a.position - b.position)
}

/** Порядок включённых — им и пользуется поиск. */
export async function activeOrder(): Promise<Array<SourceKey>> {
  const states = await sourceStates()
  return states
    .filter((s) => s.enabled || s.key === 'reference')
    .map((s) => s.key)
}

export async function isEnabled(key: SourceKey): Promise<boolean> {
  if (key === 'reference') return true
  const states = await sourceStates()
  return states.find((s) => s.key === key)?.enabled ?? false
}

export async function setEnabled(
  userId: string,
  key: SourceKey,
  enabled: boolean,
): Promise<void> {
  await requireAdmin(userId)
  if (key === 'reference') return
  const states = await sourceStates()
  const position = states.find((s) => s.key === key)?.position ?? 0
  await db
    .insert(bookSource)
    .values({ key, enabled, position })
    .onConflictDoUpdate({
      target: bookSource.key,
      set: { enabled, updatedAt: new Date() },
    })
  log.info('lookup', 'источник переключён', { key, enabled })
}

/** Перестановка: двигаем строку и переписываем позиции всего списка. */
export async function moveSource(
  userId: string,
  key: SourceKey,
  direction: 'up' | 'down',
): Promise<void> {
  await requireAdmin(userId)
  const states = await sourceStates()
  const index = states.findIndex((s) => s.key === key)
  const target = direction === 'up' ? index - 1 : index + 1
  // эталон всегда первый: ниже него никто не поднимается
  if (index < 1 || target < 1 || target >= states.length) return

  const reordered = [...states]
  const moved = reordered[index]!
  reordered[index] = reordered[target]!
  reordered[target] = moved

  for (const [position, state] of reordered.entries()) {
    await db
      .insert(bookSource)
      .values({ key: state.key, enabled: state.enabled, position })
      .onConflictDoUpdate({
        target: bookSource.key,
        set: { position, updatedAt: new Date() },
      })
  }
  log.info('lookup', 'порядок источников изменён', {
    order: reordered.map((s) => s.key).join(','),
  })
}
