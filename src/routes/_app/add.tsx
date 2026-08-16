import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import {
  BookForm,
  EMPTY_BOOK_FORM,
  toBookInput,
} from '@/components/book/BookForm'
import type { BookFormValue } from '@/components/book/BookForm'
import { BarcodeScanner } from '@/components/scanner/BarcodeScanner'
import { TitleSearch } from '@/components/book/TitleSearch'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { createBookFn } from '@/server/books'
import { getLibraryOverviewFn, listMyLibrariesFn } from '@/server/libraries'
import { lookupIsbnFn } from '@/server/lookup'
import { countUnrecognizedFn } from '@/server/unrecognized'
import { SOURCE_LABEL } from '@/services/metadata/types'
import type { LookupResult } from '@/services/metadata/lookup'

export const Route = createFileRoute('/_app/add')({
  loader: () => listMyLibrariesFn(),
  component: AddPage,
})

type Mode = 'scan' | 'isbn' | 'title' | 'manual'
const DEST_KEY = 'polka.add.dest'

function AddPage() {
  const libraries = Route.useLoaderData()
  const [mode, setMode] = useState<Mode>('scan')
  const [dest, setDest] = useState<{ libraryId: string; shelfId: string }>({
    libraryId: '',
    shelfId: '',
  })
  const [shelves, setShelves] = useState<Array<{ id: string; name: string }>>(
    [],
  )
  const [isbnInput, setIsbnInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [lookup, setLookup] = useState<LookupResult | null>(null)
  const [draft, setDraft] = useState<BookFormValue | null>(null)
  const [unrecognized, setUnrecognized] = useState(0)
  // сколько болванок уже накопилось всего — не только за этот заход
  useEffect(() => {
    void countUnrecognizedFn().then(setUnrecognized)
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const [lastSaved, setLastSaved] = useState<{
    id: string
    title: string
  } | null>(null)

  // Липкий выбор «Складываю в…» переживает перезагрузки
  useEffect(() => {
    const stored = localStorage.getItem(DEST_KEY)
    const parsed = stored ? (JSON.parse(stored) as typeof dest) : null
    const libraryId =
      parsed && libraries.some((l) => l.id === parsed.libraryId)
        ? parsed.libraryId
        : (libraries[0]?.id ?? '')
    setDest({
      libraryId,
      shelfId: parsed?.libraryId === libraryId ? parsed.shelfId : '',
    })
  }, [libraries])

  useEffect(() => {
    if (!dest.libraryId) return
    localStorage.setItem(DEST_KEY, JSON.stringify(dest))
    void getLibraryOverviewFn({ data: { libraryId: dest.libraryId } }).then(
      (o) => setShelves(o.shelves.map((s) => ({ id: s.id, name: s.name }))),
    )
  }, [dest.libraryId])

  const runLookup = useCallback(
    async (isbn: string) => {
      setBusy(true)
      setError(null)
      try {
        const result = await lookupIsbnFn({ data: { isbn } })
        setLookup(result)
        setDraft({
          ...EMPTY_BOOK_FORM,
          title: result.draft.title ?? '',
          authors: result.draft.authors ?? '',
          publisher: result.draft.publisher ?? '',
          year: result.draft.year?.toString() ?? '',
          pages: result.draft.pages?.toString() ?? '',
          language: result.draft.language ?? 'ru',
          annotation: result.draft.annotation ?? '',
          seriesName: result.draft.seriesName ?? '',
          coverUrl: result.draft.coverUrl ?? '',
          coverType: result.draft.coverType ?? '',
          giftEdition: false,
          heightMm: result.draft.heightMm?.toString() ?? '',
          fantlabAuthors: result.draft.fantlabAuthors ?? [],
          isbn13: result.isbn13,
          isbn10: result.isbn10 ?? '',
          libraryId: dest.libraryId,
          shelfId: dest.shelfId,
        })
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : 'Не получилось найти — попробуйте ещё раз',
        )
      } finally {
        setBusy(false)
      }
    },
    [dest],
  )

  /** «Пропустить»: просто закрываем черновик и возвращаемся к сканеру. */
  function skip() {
    setDraft(null)
    setLookup(null)
    setIsbnInput('')
    setMode('scan')
  }

  async function save(openCard: boolean) {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const { id } = await createBookFn({ data: toBookInput(draft) })
      if (openCard) {
        window.location.href = `/books/${id}`
        return
      }
      setSavedCount((n) => n + 1)
      setLastSaved({ id, title: draft.title })
      setDraft(null)
      setLookup(null)
      setIsbnInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось сохранить книгу')
    } finally {
      setBusy(false)
    }
  }

  // Черновик открыт — показываем форму
  if (draft) {
    return (
      <div className="mx-auto max-w-xl">
        <h1 className="mb-2 text-3xl font-semibold">Новая книга</h1>
        {lookup && (
          <p className="mb-4 rounded-lg bg-accent px-3.5 py-2 text-[13.5px] text-accent-foreground">
            {lookup.sources.length > 0 ? (
              <>
                Найдено:{' '}
                <b>{lookup.sources.map((s) => SOURCE_LABEL[s]).join(' + ')}</b>{' '}
                — проверьте и поправьте.
              </>
            ) : (
              <>
                По этому ISBN ничего не нашлось — заполните карточку руками,
                номер уже подставлен.{' '}
                <a
                  className="underline"
                  href={`https://www.google.com/search?q=%22${lookup.isbn13}%22+книга`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Поискать в интернете
                </a>{' '}
                — оттуда удобно скопировать название.
              </>
            )}
          </p>
        )}
        {lookup && lookup.duplicates.length > 0 && (
          <p className="mb-4 rounded-lg border border-stamp/40 px-3.5 py-2 text-[13.5px] text-stamp">
            Такой ISBN уже есть в каталоге:{' '}
            {lookup.duplicates.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ', '}
                <Link
                  to="/books/$bookId"
                  params={{ bookId: d.id }}
                  className="underline"
                >
                  {d.title}
                </Link>
              </span>
            ))}
            . Второй экземпляр сохранить можно.
          </p>
        )}
        <BookForm
          value={draft}
          onChange={setDraft}
          onSubmit={() => void save(false)}
          submitLabel="Сохранить и добавить ещё"
          onSave={() => void save(true)}
          busy={busy}
          error={error}
          secondaryActions={[
            {
              key: 'skip',
              label: 'Пропустить',
              onSelect: skip,
            },
            {
              key: 'cancel',
              label: 'Отмена',
              onSelect: () => {
                setDraft(null)
                setLookup(null)
              },
            },
          ]}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold">Добавить книгу</h1>
        {savedCount > 0 && lastSaved && (
          <span className="text-[13px] text-muted-foreground">
            Сохранено: {savedCount} ·{' '}
            <Link
              to="/books/$bookId"
              params={{ bookId: lastSaved.id }}
              className="underline"
            >
              {lastSaved.title}
            </Link>
          </span>
        )}
      </div>

      {/* Способы добавления */}
      <div className="mb-4 flex rounded-full border bg-card p-1">
        {(
          [
            ['scan', 'Сканер'],
            ['isbn', 'ISBN'],
            ['title', 'По названию'],
            // ручной ввод — последним: честный запасной вариант
            ['manual', 'Вручную'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            className={
              mode === m
                ? 'flex-1 rounded-full bg-foreground py-2 text-[12.5px] font-semibold whitespace-nowrap text-white'
                : 'flex-1 rounded-full py-2 text-[12.5px] font-semibold whitespace-nowrap text-muted-foreground'
            }
            onClick={() => {
              setMode(m)
              if (m === 'manual') {
                setLookup(null)
                setDraft({
                  ...EMPTY_BOOK_FORM,
                  libraryId: dest.libraryId,
                  shelfId: dest.shelfId,
                })
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {unrecognized > 0 && (
        <Link
          to="/unrecognized"
          className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-[12.5px] font-semibold text-destructive"
        >
          Не распознано{' '}
          <span className="font-mono text-[12px]">· {unrecognized}</span>
        </Link>
      )}

      {/* Куда складываем */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13.5px] text-muted-foreground">
        Складываю в:
        <select
          className="h-9 rounded-lg border bg-card px-2.5 text-[13px]"
          value={dest.libraryId}
          onChange={(e) => setDest({ libraryId: e.target.value, shelfId: '' })}
          aria-label="Библиотека"
        >
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-lg border bg-card px-2.5 text-[13px]"
          value={dest.shelfId}
          onChange={(e) => setDest((d) => ({ ...d, shelfId: e.target.value }))}
          aria-label="Полка"
        >
          <option value="">Неразобранное</option>
          {shelves.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {libraries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Сначала создайте библиотеку на вкладке{' '}
            <Link to="/libraries" className="underline">
              «Библиотека»
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <>
          {mode === 'scan' && (
            <BarcodeScanner onDetected={(isbn) => void runLookup(isbn)} />
          )}
          {mode === 'isbn' && (
            <p className="text-sm text-muted-foreground">
              Введите 13 или 10 цифр с задней обложки — карточка заполнится
              сама.
            </p>
          )}
          {mode === 'title' && (
            <TitleSearch
              dest={dest}
              onDraft={(value) => {
                setLookup(null)
                setDraft(value)
              }}
            />
          )}
          {mode !== 'title' && (
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (isbnInput.trim()) void runLookup(isbnInput)
              }}
            >
              <Input
                className="font-mono"
                placeholder={
                  mode === 'scan' ? '…или введите ISBN цифрами' : '978-5-…'
                }
                value={isbnInput}
                onChange={(e) => setIsbnInput(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
              />
              <Button type="submit" loading={busy} disabled={!isbnInput.trim()}>
                {busy ? 'Ищем…' : 'Найти'}
              </Button>
            </form>
          )}
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          {busy && mode === 'scan' && (
            <p className="mt-3 text-sm text-muted-foreground">
              Ищем метаданные…
            </p>
          )}
        </>
      )}
    </div>
  )
}
