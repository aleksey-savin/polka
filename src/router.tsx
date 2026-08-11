import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // Данные лоадеров живы 30 секунд: повторные переходы мгновенные.
    // Мутации всюду зовут router.invalidate() — свежесть не страдает.
    defaultStaleTime: 30_000,
    defaultPreloadStaleTime: 30_000,
    // Мягкий кроссфейд между экранами (браузеры без поддержки просто игнорируют)
    defaultViewTransition: true,
    defaultPendingMs: 400,
    defaultPendingMinMs: 300,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
