import { join } from 'node:path'
import winston from 'winston'
import 'winston-daily-rotate-file'

/**
 * Журнал приложения на Winston.
 *
 * Пишем в два места: stdout (docker logs) и файлы в томе /data — контейнер
 * пересоздаётся при каждой выкатке и уносит свои логи с собой, том остаётся.
 *
 * Ловим всё подряд, а не отобранные места: любой вывод через console,
 * необработанные исключения и отказы промисов, сигналы остановки,
 * каждый HTTP-запрос.
 */

const DATA_DIR = process.env.DATA_DIR ?? './data'
const LOG_DIR = join(DATA_DIR, 'logs')
const LEVEL = process.env.LOG_LEVEL ?? 'info'
/** В тестах журнал молчит: он бы забивал вывод bun test. */
const SILENT = process.env.NODE_ENV === 'test'

const errorText = (value: Error): string =>
  value.stack ?? `${value.name}: ${value.message}`

/** `09:45:23.241 ERROR crawl fantlab: пустой ответ authorId=abc` + стек ниже. */
const humanLine = winston.format.printf((info) => {
  const { timestamp, level, scope, message, stack, ...rest } = info as {
    timestamp: string
    level: string
    scope?: string
    message: unknown
    stack?: string
    [key: string]: unknown
  }
  const fields: Array<string> = []
  const traces: Array<string> = []
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) continue
    if (value instanceof Error) {
      fields.push(`${key}=${value.name}: ${value.message}`)
      traces.push(errorText(value))
      continue
    }
    const text =
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    fields.push(`${key}=${/\s/.test(text) ? `"${text}"` : text}`)
  }
  if (stack) traces.push(stack)

  const head = `${timestamp} ${level.toUpperCase().padEnd(5)} ${scope ?? 'app'} ${String(message)}`
  const line = fields.length > 0 ? `${head} ${fields.join(' ')}` : head
  return traces.length > 0
    ? `${line}\n${traces.map((t) => t.replace(/^/gm, '    ')).join('\n')}`
    : line
})

/** Журнал не имеет права ронять приложение: если каталог недоступен
    (права, SELinux, нет тома) — остаёмся с одним stdout. */
function makeFileTransport(): winston.transport | null {
  if (SILENT) return null
  try {
    const transport = new winston.transports.DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'polka-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '32m',
      maxFiles: '14d',
      createSymlink: true,
      symlinkName: 'polka.log',
    })
    transport.on('error', (error: Error) => {
      process.stderr.write(
        `журнал: запись в файл не удалась — ${error.message}\n`,
      )
    })
    return transport
  } catch (error) {
    process.stderr.write(
      `журнал: файловый транспорт отключён (${LOG_DIR}) — ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    )
    return null
  }
}

const fileRotate = makeFileTransport()

declare global {
  var __polkaLogger: winston.Logger | undefined
  var __polkaLoggingInstalled: boolean | undefined
}

/** Серверная точка входа и бандл приложения — разные модульные графы;
    без общего экземпляра в файл писали бы два логера сразу. */
export const logger = (globalThis.__polkaLogger ??= winston.createLogger({
  level: LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    humanLine,
  ),
  silent: SILENT,
  transports: [
    new winston.transports.Console(),
    ...(fileRotate ? [fileRotate] : []),
  ],
}))

type Fields = Record<string, unknown>

export const log = {
  debug: (scope: string, message: string, fields?: Fields) =>
    logger.debug(message, { scope, ...fields }),
  info: (scope: string, message: string, fields?: Fields) =>
    logger.info(message, { scope, ...fields }),
  warn: (scope: string, message: string, fields?: Fields) =>
    logger.warn(message, { scope, ...fields }),
  error: (scope: string, message: string, fields?: Fields) =>
    logger.error(message, { scope, ...fields }),
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value))

/** Ставится первым делом при старте процесса — до импорта приложения. */
export function installLogging(): void {
  if (globalThis.__polkaLoggingInstalled) return
  globalThis.__polkaLoggingInstalled = true

  // весь вывод через console уезжает в журнал: и наш, и библиотечный
  const route = [
    ['log', 'info'],
    ['info', 'info'],
    ['debug', 'debug'],
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const
  for (const [method, level] of route) {
    console[method] = (...args: Array<unknown>) => {
      const first = args[0]
      if (first instanceof Error) {
        logger.log(level, first.message, { scope: 'console', error: first })
        return
      }
      const message = args
        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ')
      logger.log(level, message, { scope: 'console' })
    }
  }

  // падения ловим сами: у Winston обработчики дублируют запись и тащат
  // простыню из os/process/trace — читать невозможно
  process.on('uncaughtException', (error: Error) => {
    log.error('crash', 'неперехваченное исключение — процесс завершается', {
      error,
      uptimeSec: Math.round(process.uptime()),
    })
    setTimeout(() => process.exit(1), 200)
  })

  process.on('unhandledRejection', (reason: unknown) => {
    log.error('crash', 'необработанный отказ промиса', {
      error: asError(reason),
      uptimeSec: Math.round(process.uptime()),
    })
  })

  process.on('warning', (warning: Error) => {
    log.warn('runtime', warning.message, { name: warning.name })
  })

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log.info('lifecycle', `получен ${signal} — останов`, {
        uptimeSec: Math.round(process.uptime()),
      })
      setTimeout(() => process.exit(0), 150)
    })
  }

  process.on('exit', (code) =>
    log.info('lifecycle', 'процесс завершён', {
      code,
      uptimeSec: Math.round(process.uptime()),
    }),
  )
}

/** Раз в пять минут — память и аптайм: видно утечки и перезапуски по OOM. */
export function startHeartbeat(): void {
  const tick = () => {
    const mem = process.memoryUsage()
    log.info('heartbeat', 'жив', {
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapMb: Math.round(mem.heapUsed / 1024 / 1024),
    })
  }
  const timer = setInterval(tick, 5 * 60 * 1000)
  timer.unref()
  tick()
}

export const logDir = LOG_DIR
