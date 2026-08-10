// Прод-сервер: статика из dist/client + SSR-обработчик TanStack Start.
// Запуск: bun run build && bun server.ts
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'

// Появляется после `bun run build`; в типах проекта его нет.
// @ts-ignore build artifact
import handler from './dist/server/server.js'

const clientDir = join(import.meta.dir, 'dist', 'client')
const port = Number(process.env.PORT ?? 3000)

Bun.serve({
  port,
  async fetch(request) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const filePath = normalize(join(clientDir, pathname))
      if (
        pathname !== '/' &&
        filePath.startsWith(clientDir) &&
        existsSync(filePath)
      ) {
        const file = Bun.file(filePath)
        if (await file.exists()) {
          const immutable = pathname.startsWith('/assets/')
          return new Response(file, {
            headers: immutable
              ? { 'cache-control': 'public, max-age=31536000, immutable' }
              : { 'cache-control': 'public, max-age=3600' },
          })
        }
      }
    }
    return handler.fetch(request)
  },
})

console.log(`Polka слушает на http://0.0.0.0:${port}`)
