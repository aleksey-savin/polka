import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#FAFAF6' },
      { title: 'Полка' },
      {
        name: 'description',
        content: 'Домашняя библиотека: полки, книги, выдачи и виш-лист',
      },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icons/favicon-48.png', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
})

function NotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="grid justify-items-center gap-3">
        <p className="font-mono text-sm tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="text-2xl font-semibold">Такой страницы нет</h1>
        <p className="max-w-sm text-muted-foreground">
          Возможно, ссылка устарела. Начните с библиотеки — там всё на своих
          местах.
        </p>
        <a
          href="/libraries"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          В библиотеку
        </a>
      </div>
    </main>
  )
}

function ErrorPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="grid justify-items-center gap-3">
        <h1 className="text-2xl font-semibold">Что-то пошло не так</h1>
        <p className="max-w-sm text-muted-foreground">
          Обновите страницу — обычно этого достаточно. Если повторяется,
          загляните позже.
        </p>
        <a
          href="/libraries"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          В библиотеку
        </a>
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}
