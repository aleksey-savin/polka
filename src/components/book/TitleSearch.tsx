import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EMPTY_BOOK_FORM } from '@/components/book/BookForm'
import { adoptWorkFn, searchByTitleFn } from '@/server/titleSearch'
import { fetchWorkEditionsFn, getWorkViewFn } from '@/server/reference'
import type { BookFormValue } from '@/components/book/BookForm'
import type { WorkView } from '@/services/reference'
import type { TitleHitWork, TitleSearchResult } from '@/services/titleSearch'

/**
 * Поиск книги по названию (M20) — вход для изданий без ISBN.
 * Слои показываем отдельно, чтобы было видно, откуда строка: свои книги,
 * эталон Полки (без сети), источники.
 */

export function TitleSearch({
  dest,
  onDraft,
}: {
  dest: { libraryId: string; shelfId: string }
  onDraft: (value: BookFormValue) => void
}) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<TitleSearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  /** Выбранное произведение — показываем его издания. */
  const [work, setWork] = useState<WorkView | null>(null)
  const [loadingWork, setLoadingWork] = useState(false)

  async function search() {
    const q = query.trim()
    if (q.length < 3) return
    setBusy(true)
    setWork(null)
    try {
      setResult(await searchByTitleFn({ data: { query: q } }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось найти')
    } finally {
      setBusy(false)
    }
  }

  /** Тап по произведению: заводим его в эталоне и подтягиваем издания. */
  async function openWork(hit: TitleHitWork) {
    setLoadingWork(true)
    try {
      const workId =
        hit.workId ??
        (await adoptWorkFn({
          data: {
            sourceId: hit.sourceId!,
            title: hit.title,
            authors: hit.authors,
            year: hit.year,
            workType: hit.workType,
          },
        }))
      const view = await getWorkViewFn({ data: { workId } })
      setWork(view)
      if (!view.editionsFetched) {
        setWork(await fetchWorkEditionsFn({ data: { workId } }))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось открыть')
    } finally {
      setLoadingWork(false)
    }
  }

  /** Черновик из произведения — издательские поля заполнит человек. */
  function draftFromWork(view: WorkView) {
    onDraft({
      ...EMPTY_BOOK_FORM,
      title: view.title,
      authors: view.authorName,
      annotation: view.annotation ?? '',
      libraryId: dest.libraryId,
      shelfId: dest.shelfId,
      refWorkId: view.id,
    })
  }

  /** Черновик из издания — выходные данные уже известны. */
  function draftFromEdition(
    view: WorkView,
    edition: WorkView['editions'][number],
  ) {
    onDraft({
      ...EMPTY_BOOK_FORM,
      title: edition.title,
      authors: view.authorName,
      publisher: edition.publisher ?? '',
      year: edition.year?.toString() ?? '',
      pages: edition.pages?.toString() ?? '',
      isbn13: edition.isbn13 ?? '',
      annotation: view.annotation ?? '',
      libraryId: dest.libraryId,
      shelfId: dest.shelfId,
      refWorkId: view.id,
    })
  }

  if (work) {
    return (
      <div>
        <button
          type="button"
          className="text-[13px] font-semibold text-accent-foreground"
          onClick={() => setWork(null)}
        >
          ← к результатам
        </button>
        <h2 className="mt-2 text-[19px] font-semibold">{work.title}</h2>
        <p className="font-mono text-[11.5px] text-muted-foreground">
          {[work.authorName, work.year].filter(Boolean).join(' · ')}
        </p>

        <p className="mt-4 text-[13px] text-muted-foreground">
          Какое издание у вас в руках?
        </p>
        <div className="mt-1">
          {work.editions.map((e) => (
            <div
              key={e.refBookId}
              className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
            >
              <span
                aria-hidden
                className="h-[50px] w-[34px] flex-none rounded-[3px]"
                style={{
                  background: e.coverColor ?? '#D9CDB8',
                  boxShadow: 'inset 1.5px 0 0 rgba(255,255,255,.35)',
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{e.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {e.publisher && `${e.publisher} · `}
                  {e.year && (
                    <span className="font-mono text-[11.5px]">{e.year}</span>
                  )}
                  {e.pages && (
                    <>
                      {' · '}
                      <span className="font-mono text-[11.5px]">{e.pages}</span>{' '}
                      с.
                    </>
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="flex-none"
                onClick={() => draftFromEdition(work, e)}
              >
                Это моё
              </Button>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          className="mt-3 h-11 w-full"
          onClick={() => draftFromWork(work)}
        >
          {work.editions.length > 0
            ? 'Моего издания здесь нет — заполню сам'
            : 'Изданий не нашлось — заполню сам'}
        </Button>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Для книг без ISBN — у изданий до 90-х его нет вовсе. Введите название,
        можно вместе с автором.
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <Input
          className="h-12 rounded-xl text-[16px]"
          placeholder="карамазовы достоевский"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <Button
          type="submit"
          className="h-12 flex-none"
          loading={busy || loadingWork}
          disabled={query.trim().length < 3}
        >
          Найти
        </Button>
      </form>

      {result && (
        <div className="mt-4">
          {result.mine.length > 0 && (
            <>
              <p className="mt-3 mb-1 font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
                У меня на полках
              </p>
              {result.mine.map((hit) => (
                <Link
                  key={hit.bookId}
                  to="/books/$bookId"
                  params={{ bookId: hit.bookId }}
                  className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {hit.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {hit.authors}
                      {hit.year && (
                        <>
                          {' · '}
                          <span className="font-mono text-[11.5px]">
                            {hit.year}
                          </span>
                        </>
                      )}
                      {hit.place && ` · ${hit.place}`}
                    </span>
                  </span>
                  <span className="flex-none rounded-[3px] border-[1.5px] border-primary px-1.5 font-mono text-[10px] tracking-[0.08em] text-accent-foreground uppercase">
                    есть
                  </span>
                </Link>
              ))}
            </>
          )}

          {[
            { key: 'reference' as const, label: 'В каталоге Полки' },
            { key: 'external' as const, label: 'Нашлось в источниках' },
          ].map((group) =>
            result[group.key].length === 0 ? null : (
              <div key={group.key}>
                <p className="mt-3 mb-1 font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
                  {group.label}
                  {group.key === 'external' && (
                    <span className="text-stamp"> · FantLab</span>
                  )}
                </p>
                {result[group.key].map((hit, i) => (
                  <button
                    key={`${hit.sourceId ?? hit.workId}-${i}`}
                    type="button"
                    className="flex w-full items-center gap-3 border-t py-2.5 text-left first:border-t-0"
                    disabled={loadingWork}
                    onClick={() => void openWork(hit)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {hit.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {hit.authors}
                        {hit.year && (
                          <>
                            {' · '}
                            <span className="font-mono text-[11.5px]">
                              {hit.year}
                            </span>
                          </>
                        )}
                        {hit.workType && ` · ${hit.workType}`}
                      </span>
                    </span>
                    <span aria-hidden className="flex-none text-muted-foreground">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            ),
          )}

          {result.mine.length === 0 &&
            result.reference.length === 0 &&
            result.external.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                Ничего не нашлось. Попробуйте другое написание или заполните
                карточку на вкладке «Вручную».
              </p>
            )}
        </div>
      )}
    </div>
  )
}
