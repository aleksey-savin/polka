import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), 'polka-test-'))

const { coverAbsolutePath, saveCover } = await import('./covers')
const { AppError } = await import('./errors')

/** Маленький валидный PNG 4×6, одноцветный. */
function tinyPng(): ArrayBuffer {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAGCAIAAABrW6giAAAAEElEQVR4nGPQz/aHIwZKOQBRYxXZuBDa7wAAAABJRU5ErkJggg=='
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer
}

describe('covers', () => {
  test('saveCover: png → webp на диске, относительный путь', async () => {
    const rel = await saveCover('test-book-id', tinyPng())
    expect(rel).toBe('covers/test-book-id.webp')
    const abs = coverAbsolutePath(rel)
    expect(await Bun.file(abs).exists()).toBe(true)
    expect(Bun.file(abs).size).toBeGreaterThan(0)
  })

  test('битые данные — понятная ошибка', () => {
    expect(
      saveCover('bad', new TextEncoder().encode('не картинка').buffer),
    ).rejects.toThrow('JPEG, PNG и WebP')
  })

  test('coverAbsolutePath принимает только пути из БД', () => {
    expect(() => coverAbsolutePath('../etc/passwd')).toThrow(AppError)
    expect(() => coverAbsolutePath('covers/../../x.webp')).toThrow(AppError)
  })
})
