/**
 * Переход из открытой шторки.
 *
 * Radix (под vaul) держит на body pointer-events: none, пока идёт закрытие;
 * навигация, отправленная тем же обработчиком, проглатывается, а оверлей
 * остаётся висеть. Поэтому уходим после того, как закрытие доиграло.
 * См. radix-ui/primitives#1241.
 */
export function afterClose(run: () => void): void {
  if (typeof window === 'undefined') {
    run()
    return
  }
  window.setTimeout(run, 220)
}
