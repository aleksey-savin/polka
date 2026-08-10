export type AppErrorCode = 'forbidden' | 'not_found' | 'invalid'

/** Ожидаемая доменная ошибка: сообщение показывается пользователю как есть. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: AppErrorCode = 'invalid',
  ) {
    super(message)
    this.name = 'AppError'
  }
}
