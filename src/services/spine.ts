/**
 * Внешность корешка на полке: цвет детерминирован названием,
 * ширина — толщиной книги, высота — небольшая вариация от хэша.
 */
const LIGHT = ['#E8E2D4', '#D9CDB8', '#C9D2C5', '#CBD3DD', '#D8CBD4', '#E3D3C0']
const DARK = ['#4A5A6E', '#6E5A4A']
const PALETTE = [...LIGHT, ...DARK]

function hashString(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export interface SpineAppearance {
  color: string
  dark: boolean
  width: number
  height: number
}

export function spineFor(
  title: string,
  pages?: number | null,
): SpineAppearance {
  const hash = hashString(title)
  const color = PALETTE[hash % PALETTE.length] ?? '#E8E2D4'
  const heights = [124, 132, 138, 148]
  const p = pages ?? 300
  const width = p < 150 ? 22 : p < 250 ? 28 : p < 350 ? 34 : p < 450 ? 42 : 52
  return {
    color,
    dark: DARK.includes(color),
    width,
    height: heights[(hash >> 3) % heights.length] ?? 138,
  }
}

/** Тон текста поверх произвольного hex-фона. */
export function textToneFor(hex: string): 'dark' | 'light' {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.62 ? 'dark' : 'light'
}
