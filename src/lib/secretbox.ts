import { env } from '@/lib/env'

/**
 * Симметричное шифрование секретов, которые лежат в базе (M22).
 * Ключ выводится из BETTER_AUTH_SECRET: отдельный секрет заводить незачем,
 * а без него база и так бесполезна.
 */

async function keyFor(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
  )
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

export async function seal(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await keyFor(),
    new TextEncoder().encode(plain),
  )
  const packed = new Uint8Array(iv.length + cipher.byteLength)
  packed.set(iv)
  packed.set(new Uint8Array(cipher), iv.length)
  return Buffer.from(packed).toString('base64')
}

export async function open(packed: string): Promise<string | null> {
  try {
    const bytes = Buffer.from(packed, 'base64')
    const iv = bytes.subarray(0, 12)
    const cipher = bytes.subarray(12)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      await keyFor(),
      cipher,
    )
    return new TextDecoder().decode(plain)
  } catch {
    // сменили BETTER_AUTH_SECRET — старый пароль расшифровать нельзя
    return null
  }
}
