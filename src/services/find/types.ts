import type { MetadataDraft } from '@/services/metadata/types'
import type { Trace } from './trace'

/**
 * Единый поиск издания (M32).
 *
 * Одна цепочка на все входы: добавление по ISBN, «Не распознано», карточка
 * книги, фоновая доигровка. Состав и порядок ступеней приходят из настроек
 * источников — зашитого порядка в коде нет.
 */

/** Ключ ступени. Совпадает со значением `book_source.key`. */
export type SourceKey =
  | 'reference'
  | 'fantlab'
  | 'google'
  | 'openlibrary'
  | 'web'
  | 'neuro'

/** Что ответила ступень: показывается человеку и ложится в журнал. */
export interface SourceProbe {
  key: SourceKey
  outcome: 'нашёл' | 'молчит' | 'ошибка' | 'выключен' | 'не успели'
  /** Подробность для человека: адрес страницы, текст отказа сервиса. */
  detail: string | null
  ms: number
}

/** Находка одной ступени. Их листают стрелками, поэтому храним раздельно. */
export interface Finding {
  key: SourceKey
  /**
   * Ключ варианта: `fantlab` у каталогов, `web#1`…`web#3` у Яндекс Поиска —
   * одна ступень может дать несколько находок с разных страниц.
   */
  variantKey: string
  draft: MetadataDraft
  /** Страница, на которой встретился номер (веб-ступени). */
  proof: { url: string; title: string } | null
  /** Издание эталона, если ступень его подтвердила. */
  refBookId: string | null
  workId: string | null
  /** Кандидаты обложек: первым — самый надёжный. */
  covers: Array<string>
  /**
   * Ответ формально есть, но негодный — держим про запас.
   *
   * Обычный случай: Google хранит русское издание латиницей («Deti-bilingvy»),
   * без издательства и аннотации. Карточка получается нечитаемой, поэтому
   * такая находка уступает любой нормальной, но лучше пустоты.
   */
  weak: boolean
}

export interface FindResult {
  isbn13: string
  isbn10: string | null
  /** Слитый черновик: каждое поле от старшей ступени, которая его дала. */
  draft: MetadataDraft
  /** Кто ответил, в порядке цепочки. */
  found: Array<SourceKey>
  /** Отчёт по каждой ступени — иначе «не нашлось» неотличимо от поломки. */
  probes: Array<SourceProbe>
  /** Находки по отдельности. */
  findings: Array<Finding>
  proof: { url: string; title: string } | null
  refBookId: string | null
  workId: string | null
  /** Кандидаты обложек по всем ступеням, без повторов. */
  covers: Array<string>
  /** Отдано из кэша — сеть не трогали. */
  cached: boolean
  /** Бюджет кончился раньше цепочки: есть что доиграть фоном. */
  truncated: boolean
  /** Идти больше некуда: все ступени опрошены или отвергнуты. */
  exhausted: boolean
}

export interface FindOptions {
  /**
   * Бюджет на всю цепочку в миллисекундах. Ступень не начинается, если
   * времени на неё заведомо не хватит. По умолчанию — `FULL_BUDGET_MS`.
   */
  budgetMs?: number
  /** Забыть кэш и список отвергнутых путей. */
  force?: boolean
  /** Ступени, которые человек уже отверг кнопкой «Искать дальше». */
  rejected?: Array<SourceKey>
  /** Подмена источников в тестах. В бою не передаётся. */
  adapters?: Partial<Record<SourceKey, SourceAdapter>>
}

/** Быстрый режим сканирования: успевают только бесплатные каталоги. */
export const QUICK_BUDGET_MS = 5_000
/** Полный режим: цепочка целиком, включая веб-поиск и чтение страниц. */
export const FULL_BUDGET_MS = 45_000
/** Сколько вариантов берём с одной ступени: больше человек не пролистает. */
export const MAX_VARIANTS_PER_STEP = 3

export interface FindContext {
  userId: string
  isbn13: string
  /** Что нашли предыдущие ступени: веб-ступени этим пользуются. */
  soFar: Array<Finding>
  trace: Trace
  /** Сколько миллисекунд осталось у всей цепочки. */
  leftMs: () => number
}

/**
 * Источник как функция. Сеть живёт только здесь: ядро получает список
 * адаптеров и не знает, куда они ходят, — поэтому в тестах подставляются
 * поддельные, и поведение при отказе источника наконец проверяемо.
 */
export interface SourceAdapter {
  key: SourceKey
  /** Платный — считается по суточному лимиту. */
  paid: boolean
  /** Сколько эта ступень может занять: ядро не начнёт её без запаса. */
  timeoutMs: number
  /**
   * Спросить издание по номеру. Пустой список — источник промолчал.
   *
   * Список, а не одна находка: Яндекс Поиск возвращает до десяти страниц с
   * разными изданиями, и запирать их в один вариант — терять работу, за
   * которую уже заплачено. Каталоги отдают ровно одну находку.
   */
  probe: (ctx: FindContext) => Promise<Array<Finding>>
  /**
   * Добор недостающего (обложка, аннотация, объём) по названию и автору.
   * Есть не у каждой ступени.
   */
  enrich?: (
    ctx: FindContext,
    draft: MetadataDraft,
  ) => Promise<{ draft: Partial<MetadataDraft>; covers: Array<string> }>
}
