/**
 * Внешность корешка на полке: цвет детерминирован названием,
 * толщина — от страниц (непрерывно), высота — от формата в мм
 * (фолбэк: переплёт, затем вариация от хэша). Гайдлайн: «Живые полки».
 */
const LIGHT = ['#E8E2D4', '#D9CDB8', '#C9D2C5', '#CBD3DD', '#D8CBD4', '#E3D3C0']
const DARK = ['#4A5A6E', '#6E5A4A']
const PALETTE = [...LIGHT, ...DARK]

export type CoverType = 'soft' | 'hard'

function hashString(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

const clamp = (min: number, v: number, max: number) =>
  Math.min(max, Math.max(min, v))

export interface SpineAppearance {
  color: string
  dark: boolean
  width: number
  height: number
}

const FALLBACK_HEIGHT: Record<CoverType, number> = {
  soft: 118,
  hard: 138,
}
/** Подарочные издания обычно крупнее — фолбэк без известных мм. */
const GIFT_FALLBACK_HEIGHT = 152

export function spineFor(
  title: string,
  pages?: number | null,
  physical?: {
    heightMm?: number | null
    coverType?: CoverType | null
    giftEdition?: boolean
  },
): SpineAppearance {
  const hash = hashString(title)
  const color = PALETTE[hash % PALETTE.length] ?? '#E8E2D4'
  const p = pages ?? 300
  // подарочные — на плотной бумаге, блок толще при тех же страницах
  const width = clamp(
    18,
    Math.round((14 + p / 14) * (physical?.giftEdition ? 1.12 : 1)),
    56,
  )

  let height: number
  if (physical?.heightMm) {
    height = clamp(96, Math.round(physical.heightMm * 0.62), 168)
  } else if (physical?.giftEdition) {
    height = GIFT_FALLBACK_HEIGHT
  } else if (physical?.coverType) {
    height = FALLBACK_HEIGHT[physical.coverType]
  } else {
    const heights = [124, 132, 138, 148]
    height = heights[(hash >> 3) % heights.length] ?? 138
  }

  return { color, dark: DARK.includes(color), width, height }
}

/** Тон текста поверх произвольного hex-фона. */
export function textToneFor(hex: string): 'dark' | 'light' {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.62 ? 'dark' : 'light'
}

/** Средняя ширина кириллического глифа Piazzolla, в em. */
const GLYPH_EM = 0.6

/**
 * Вписывает текст в отведённую длину корешка: сначала ужимает шрифт
 * (maxFont → minFont), затем — честная обрезка с многоточием
 * (CSS text-overflow в вертикальном письме Safari не рисует).
 */
export function fitSpineText(
  text: string,
  availablePx: number,
  maxFont = 12,
  minFont = 9,
): { text: string; fontSize: number } {
  for (let f = maxFont; f >= minFont; f--) {
    if (text.length * f * GLYPH_EM <= availablePx) {
      return { text, fontSize: f }
    }
  }
  const maxChars = Math.max(
    3,
    Math.floor(availablePx / (minFont * GLYPH_EM)) - 1,
  )
  return { text: text.slice(0, maxChars).trimEnd() + '…', fontSize: minFont }
}
