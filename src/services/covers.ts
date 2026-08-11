import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

import { env } from '@/lib/env'
import { AppError } from './errors'
import { POLKA_USER_AGENT } from './userAgent'

const MAX_BYTES = 10 * 1024 * 1024

function coversDir(): string {
  const dir = join(env.DATA_DIR, 'covers')
  mkdirSync(dir, { recursive: true })
  return dir
}

export interface SavedCover {
  path: string
  color: string | null
}

/** Сохраняет обложку книги: ресайз до ~600px, webp + акцентный цвет. */
export async function saveCover(
  bookId: string,
  bytes: ArrayBuffer,
): Promise<SavedCover> {
  if (bytes.byteLength === 0) throw new AppError('Файл пустой')
  if (bytes.byteLength > MAX_BYTES)
    throw new AppError('Файл больше 10 МБ — выберите картинку поменьше')

  const dir = coversDir()
  const tmpPath = join(dir, `${bookId}.orig`)
  const outPath = join(dir, `${bookId}.webp`)
  await Bun.write(tmpPath, bytes)
  try {
    await Bun.file(tmpPath)
      .image()
      .resize(600, 900, { fit: 'inside' })
      .webp({ quality: 82 })
      .write(outPath)
  } catch {
    throw new AppError(
      'Не удалось прочитать картинку — поддерживаются JPEG, PNG и WebP',
    )
  } finally {
    await Bun.file(tmpPath)
      .delete()
      .catch(() => {})
  }
  const color = await extractCoverAccent(outPath)
  return { path: `covers/${bookId}.webp`, color }
}

/** Скачивает обложку по URL из метаданных (best-effort, https-only). */
export async function saveCoverFromUrl(
  bookId: string,
  url: string,
): Promise<SavedCover> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:')
    throw new AppError('Обложка скачивается только по https')
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': POLKA_USER_AGENT },
  })
  if (!res.ok) throw new AppError(`Источник обложки ответил ${res.status}`)
  return saveCover(bookId, await res.arrayBuffer())
}

/** Абсолютный путь к файлу обложки; принимает только пути из БД. */
export function coverAbsolutePath(relativePath: string): string {
  if (!/^covers\/[\w-]+\.webp$/.test(relativePath)) {
    throw new AppError('Некорректный путь обложки', 'invalid')
  }
  return join(env.DATA_DIR, relativePath)
}

export async function deleteCover(relativePath: string): Promise<void> {
  await Bun.file(coverAbsolutePath(relativePath))
    .delete()
    .catch(() => {})
}

// ── Акцентный цвет обложки ─────────────────────────────────────────────

function pngPixel(
  bytes: Uint8Array,
): { r: number; g: number; b: number } | null {
  if (bytes.length < 33) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const colorType = bytes[25] // IHDR: bit depth в 24, color type в 25
  let off = 8
  let idat: Uint8Array | null = null
  while (off + 12 <= bytes.length) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(...bytes.slice(off + 4, off + 8))
    if (type === 'IDAT') idat = bytes.slice(off + 8, off + 8 + len)
    off += 12 + len
  }
  if (!idat) return null
  const raw = inflateSync(idat)
  // 1×1: [фильтр, каналы…]; все PNG-фильтры при нулевых соседях дают сырое значение
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : null
  if (channels === null || raw.length < 1 + channels) return null
  const r = raw[1] ?? 0
  const g = channels >= 3 ? (raw[2] ?? 0) : r
  const b = channels >= 3 ? (raw[3] ?? 0) : r
  return { r, g, b }
}

function boostToAccent(r: number, g: number, b: number): string {
  // rgb → hsl
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  // акцент: чуть сочнее, светлота — в диапазон, где плашка выглядит «книжно»
  const s2 = Math.min(0.85, s * 1.15 + 0.05)
  const l2 = Math.min(0.82, Math.max(0.5, l))
  // hsl → rgb
  const c = (1 - Math.abs(2 * l2 - 1)) * s2
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l2 - c / 2
  const [r2, g2, b2] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`.toUpperCase()
}

/** Средний цвет обложки, подкрученный до «книжного» акцента. Best-effort. */
export async function extractCoverAccent(
  absolutePath: string,
): Promise<string | null> {
  try {
    const tmp = `${absolutePath}.px.png`
    await Bun.file(absolutePath).image().resize(1, 1).png().write(tmp)
    const bytes = new Uint8Array(await Bun.file(tmp).arrayBuffer())
    await Bun.file(tmp)
      .delete()
      .catch(() => {})
    const px = pngPixel(bytes)
    return px ? boostToAccent(px.r, px.g, px.b) : null
  } catch {
    return null
  }
}
