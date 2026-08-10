import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { env } from '@/lib/env'
import { AppError } from './errors'
import { POLKA_USER_AGENT } from './userAgent'

const MAX_BYTES = 10 * 1024 * 1024

function coversDir(): string {
  const dir = join(env.DATA_DIR, 'covers')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Сохраняет обложку книги: ресайз до ~600px по ширине, webp. Возвращает относительный путь. */
export async function saveCover(
  bookId: string,
  bytes: ArrayBuffer,
): Promise<string> {
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
  return `covers/${bookId}.webp`
}

/** Скачивает обложку по URL из метаданных (best-effort, https-only). */
export async function saveCoverFromUrl(
  bookId: string,
  url: string,
): Promise<string> {
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
