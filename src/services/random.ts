/** URL-безопасный случайный токен (инвайты, share-ссылки). */
export function randomToken(bytes = 18): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  let binary = ''
  for (const b of buf) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
