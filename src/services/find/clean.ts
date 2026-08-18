import { isCyrillicRegion } from '@/services/isbnPrefix'

/**
 * Чистка текста, пришедшего из каталогов и со страниц магазинов.
 *
 * Живёт в подсистеме поиска, а не в `aiRecognize`: этим пользуются адаптеры
 * источников, и импорт из `aiRecognize` замкнул бы кольцо
 * `adapters → aiRecognize → core → chain → adapters`.
 */

/** Магазинный мусор в названиях: точка в конце, «(тв. переплёт)», ISBN. */
export function cleanFoundTitle(raw: string): string {
  return raw
    .replace(
      /\s*\((?=[^)]*(?:переплёт|переплет|обложк|isbn|97[89][\d -]{10,}))[^)]*\)/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?<!\.)\.$/, '')
    .trim()
}

/** Издатель в источниках часто закавычен: «"Манн, Иванов и Фербер"». */
export function cleanPublisher(raw: string | null): string | null {
  if (!raw) return raw
  const cleaned = raw
    .trim()
    .replace(/^["'«„]+/, '')
    .replace(/["'»“]+$/, '')
    .replace(/\s*(?:ООО|ЗАО|ОАО|АО|ИП)\s+(?=\S)/i, '')
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

/** Мусор магазинов: «Купить книгу … доставка … отзывы» — это не аннотация. */
const SHOP_NOISE =
  /(купить|заказать|интернет-магазин|доставка|цена|скидк|отзывы покупателей|наличии)/i

export function cleanAnnotation(raw: string | null): string | null {
  const text = raw?.replace(/\s+/g, ' ').trim() ?? ''
  if (text.length < 60) return null
  // страничные описания часто начинаются с карточки товара — такое не берём
  if (SHOP_NOISE.test(text.slice(0, 120))) return null
  return text.slice(0, 2000)
}

const CYRILLIC = /[\u0400-\u04FF]/

/**
 * Транслит вместо названия — обычная беда каталогов: Google Books хранит
 * русские издания латиницей («Deti-bilingvy»), без издательства и аннотации.
 * Формально ответ есть, а карточка получается нечитаемой, поэтому цепочку на
 * такой находке не останавливаем: она остаётся запасным вариантом, а поиск
 * идёт дальше — за живой страницей на русском.
 */
export function looksTransliterated(
  isbn13: string,
  title: string | null | undefined,
  authors: string | null | undefined,
): boolean {
  if (!title?.trim()) return false
  if (CYRILLIC.test(title) || CYRILLIC.test(authors ?? '')) return false
  return isCyrillicRegion(isbn13)
}
