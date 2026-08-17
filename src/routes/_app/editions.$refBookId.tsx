import { Link, createFileRoute } from '@tanstack/react-router'

import { AddToListButton } from '@/components/book/AddToListButton'
import { AddToShelfButton } from '@/components/book/AddToShelfButton'
import { ListBadges } from '@/components/book/ListBadges'
import { Button } from '@/components/ui/button'
import { getRefBookViewFn } from '@/server/reference'
import { spineFor } from '@/services/spine'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { originCrumb } from '@/lib/origin'

/** Страница издания эталона: обложка, выходные данные, состав, действие. */
export const Route = createFileRoute('/_app/editions/$refBookId')({
  loader: ({ params }) =>
    getRefBookViewFn({ data: { refBookId: params.refBookId } }),
  component: EditionPage,
})

function EditionPage() {
  const view = Route.useLoaderData()

  const authorName = view.authors

  const look = spineFor(view.title, view.pages)

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <Breadcrumbs
        items={[
          originCrumb('/editions/$refBookId') ?? {
            label: 'Каталог',
            to: '/books',
            search: {},
          },
          { label: 'Издание' },
        ]}
      />

      <div className="flex items-start gap-4">
        {view.coverPath ? (
          <img
            src={`/api/ref-covers/${view.id}`}
            alt=""
            className="w-[106px] flex-none rounded-[4px] shadow-md"
          />
        ) : (
          <span
            aria-hidden
            className="grid aspect-[7/10] w-[106px] flex-none content-end rounded-[4px] p-2"
            style={{
              background: view.coverColor ?? look.color,
              boxShadow: 'inset 3px 0 0 rgba(255,255,255,.3)',
            }}
          >
            <span className="font-display text-[11px] leading-tight font-bold text-white/90">
              {view.title}
            </span>
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] leading-snug font-semibold">
            {view.title}
          </h1>
          {view.seriesName && (
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Изд. серия: {view.seriesName}
            </p>
          )}
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {view.publisher && (
              <>
                {view.publisher}
                <br />
              </>
            )}
            {view.year && (
              <span className="font-mono text-xs">{view.year}</span>
            )}
            {view.pages && (
              <>
                {' · '}
                <span className="font-mono text-xs">{view.pages}</span> с.
              </>
            )}
            {view.coverType && (
              <> · {view.coverType === 'hard' ? 'твёрдый' : 'мягкая'}</>
            )}
          </p>
          {view.isbn13 && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {view.isbn13}
            </p>
          )}
        </div>
      </div>

      {view.annotation && (
        <p className="mt-4 max-w-[60ch] text-[14.5px] leading-[1.65] whitespace-pre-line text-muted-foreground">
          {view.annotation}
        </p>
      )}

      {view.works.length > 1 && (
        <p className="mt-4 text-[13.5px] text-muted-foreground">
          <b className="font-medium text-foreground">Содержит:</b>{' '}
          {view.works.map((w, i) => (
            <span key={w.id}>
              {i > 0 && ' · '}
              <Link
                to="/works/$workId"
                params={{ workId: w.id }}
                className="hover:text-foreground hover:underline"
              >
                {w.title}
              </Link>
            </span>
          ))}
        </p>
      )}

      <ListBadges lists={view.lists} className="mt-4" />

      <div className="mt-5">
        {view.myBookId ? (
          <Button asChild className="h-12 w-full" variant="outline">
            <Link to="/books/$bookId" params={{ bookId: view.myBookId }}>
              Эта книга у вас есть — открыть
            </Link>
          </Button>
        ) : (
          <div className="grid gap-2">
            <AddToShelfButton
              className="h-12 w-full"
              title={view.title}
              authors={authorName}
              publisher={view.publisher}
              year={view.year}
              pages={view.pages}
              isbn13={view.isbn13}
              refWorkId={view.works[0]?.id ?? null}
            />
            <AddToListButton
              target={{ refBookId: view.id }}
              title={view.title}
              subtitle={authorName}
              variant="wide"
              active={view.lists.length > 0}
            />
          </div>
        )}
      </div>
    </div>
  )
}
