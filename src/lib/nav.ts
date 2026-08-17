/**
 * Переход из открытой шторки.
 *
 * vaul закрывается с анимацией и на это время гасит клики на странице: если
 * навигация уходит тем же обработчиком, что закрывает шторку, на тяжёлых
 * страницах переход теряется. Поэтому сначала закрываем, потом — следующим
 * кадром — уходим.
 */
export function afterClose(run: () => void): void {
  if (typeof requestAnimationFrame === 'undefined') {
    run()
    return
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(run)
  })
}
