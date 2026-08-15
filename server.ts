// Прод-сервер: статика из dist/client + SSR-обработчик TanStack Start.
// Запуск: bun run build && bun server.ts
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'

// журнал ставим первым делом — до импорта приложения, чтобы поймать
// в том числе ошибки инициализации (миграции, бэкфиллы, воркер)
import { installLogging, log, startHeartbeat } from './src/lib/logger'

installLogging()
const bootStarted = performance.now()

// Появляется после `bun run build`; в типах проекта его нет.
// @ts-ignore build artifact
const { default: handler } = await import('./dist/server/server.js')


const clientDir = join(import.meta.dir, 'dist', 'client')
const port = Number(process.env.PORT ?? 3000)

// Кэш gzip для текстовой статики (JS/CSS и т.п.) — мобильной загрузке заметно легче
const GZIP_TYPES = /\.(js|css|html|svg|json|webmanifest|txt|xml)$/
const gzipCache = new Map<string, Uint8Array>()

/** Ошибки статики и SSR не должны молча превращаться в белый экран. */
async function handleRequest(request: Request): Promise<Response> {
  {
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
  }
  return handler.fetch(request)
}

Bun.serve({
  port,
  async fetch(request) {
    const started = performance.now()
    const { pathname, search } = new URL(request.url)
    const isAsset = pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')
    try {
      const response = await handleRequest(request)
      const ms = Math.round(performance.now() - started)
      // статику пишем только в debug, остальное — всегда
      const level =
        response.status >= 500
          ? 'error'
          : response.status >= 400 || ms > 2000
            ? 'warn'
            : isAsset
              ? 'debug'
              : 'info'
      log[level]('http', `${request.method} ${pathname}${search}`, {
        status: response.status,
        ms,
      })
      return response
    } catch (error) {
      log.error('http', `${request.method} ${pathname}${search} упал`, {
        error: error instanceof Error ? error : new Error(String(error)),
        ms: Math.round(performance.now() - started),
      })
      return new Response('Внутренняя ошибка', { status: 500 })
    }
  },
})

log.info('lifecycle', 'сервер запущен', {
  port,
  version: process.env.GIT_SHA?.slice(0, 7) ?? 'dev',
  bootMs: Math.round(performance.now() - bootStarted),
  bun: Bun.version,
})
startHeartbeat()
