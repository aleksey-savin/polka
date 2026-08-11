// Прод-сервер: статика из dist/client + SSR-обработчик TanStack Start.
// Запуск: bun run build && bun server.ts
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'

// Появляется после `bun run build`; в типах проекта его нет.
// @ts-ignore build artifact
import handler from './dist/server/server.js'

const clientDir = join(import.meta.dir, 'dist', 'client')
const port = Number(process.env.PORT ?? 3000)

// Кэш gzip для текстовой статики (JS/CSS и т.п.) — мобильной загрузке заметно легче
const GZIP_TYPES = /\.(js|css|html|svg|json|webmanifest|txt|xml)$/
const gzipCache = new Map<string, Uint8Array>()

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
          const cacheControl = immutable
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600'
          const acceptsGzip = request.headers
            .get('accept-encoding')
            ?.includes('gzip')
          if (acceptsGzip && GZIP_TYPES.test(pathname)) {
            let gz = gzipCache.get(filePath)
            if (!gz) {
              gz = Bun.gzipSync(new Uint8Array(await file.arrayBuffer()))
              gzipCache.set(filePath, gz)
            }
            return new Response(gz as unknown as BodyInit, {
              headers: {
                'content-type': file.type || 'application/octet-stream',
                'cache-control': cacheControl,
                'content-encoding': 'gzip',
                vary: 'Accept-Encoding',
              },
            })
          }
          return new Response(file, {
            headers: { 'cache-control': cacheControl },
          })
        }
      }
    }
    return handler.fetch(request)
  },
})

console.log(`Polka слушает на http://0.0.0.0:${port}`)
