import { useEffect, useState } from 'react'

import { SeriesCombobox } from '@/components/book/SeriesCombobox'
import { TagsInput } from '@/components/book/TagsInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getLibraryOverviewFn, listMyLibrariesFn } from '@/server/libraries'
import { listMyTagsFn } from '@/server/tags'

export interface BookFormValue {
  title: string
  authors: string
  isbn13: string
  isbn10: string
  publisher: string
  year: string
  pages: string
  language: string
  annotation: string
  seriesName: string
  seriesNumber: string
  tags: Array<string>
  libraryId: string
  shelfId: string
  wishlist: boolean
  /** Обложка из найденных метаданных — скачается при сохранении. */
  coverUrl: string
}

export const EMPTY_BOOK_FORM: BookFormValue = {
  title: '',
  authors: '',
  isbn13: '',
  isbn10: '',
  publisher: '',
  year: '',
  pages: '',
  language: 'ru',
  annotation: '',
  seriesName: '',
  seriesNumber: '',
  tags: [],
  libraryId: '',
  shelfId: '',
  wishlist: false,
  coverUrl: '',
}

/** Перевод значения формы в input серверной функции. */
export function toBookInput(v: BookFormValue) {
  return {
    title: v.title,
    authors: v.authors,
    isbn13: v.isbn13 || undefined,
    isbn10: v.isbn10 || undefined,
    publisher: v.publisher || undefined,
    year: v.year ? Number(v.year) : null,
    pages: v.pages ? Number(v.pages) : null,
    language: v.language || 'ru',
    annotation: v.annotation || undefined,
    seriesName: v.seriesName || undefined,
    seriesNumber: v.seriesNumber || undefined,
    tags: v.tags,
    libraryId: v.wishlist ? null : v.libraryId || null,
    shelfId: v.wishlist ? null : v.shelfId || null,
    wishlist: v.wishlist,
    coverUrl: v.coverUrl || undefined,
  }
}

export function BookForm({
  value,
  onChange,
  onSubmit,
  submitLabel,
  extraActions,
  busy,
  error,
}: {
  value: BookFormValue
  onChange: (value: BookFormValue) => void
  onSubmit: () => void
  submitLabel: string
  extraActions?: React.ReactNode
  busy?: boolean
  error?: string | null
}) {
  const [libraries, setLibraries] = useState<
    Array<{ id: string; name: string }>
  >([])
  const [shelves, setShelves] = useState<Array<{ id: string; name: string }>>(
    [],
  )
  const [tagSuggestions, setTagSuggestions] = useState<Array<string>>([])

  const set = <TKey extends keyof BookFormValue>(
    key: TKey,
    val: BookFormValue[TKey],
  ) => onChange({ ...value, [key]: val })

  useEffect(() => {
    void listMyLibrariesFn().then((libs) => {
      setLibraries(libs)
      if (!value.libraryId && libs.length > 0)
        set('libraryId', libs[0]?.id ?? '')
    })
    void listMyTagsFn().then((tags) =>
      setTagSuggestions(tags.map((t) => t.name)),
    )
  }, [])

  useEffect(() => {
    if (!value.libraryId) {
      setShelves([])
      return
    }
    void getLibraryOverviewFn({ data: { libraryId: value.libraryId } }).then(
      (o) => {
        setShelves(o.shelves.map((s) => ({ id: s.id, name: s.name })))
      },
    )
  }, [value.libraryId])

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {value.coverUrl && (
        <div className="flex items-center gap-3.5">
          <img
            src={value.coverUrl}
            alt="Обложка из найденного источника"
            className="h-24 w-16 rounded-[4px] object-cover shadow-sm"
          />
          <button
            type="button"
            className="text-[13px] text-muted-foreground underline"
            onClick={() => set('coverUrl', '')}
          >
            Не сохранять эту обложку
          </button>
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="bf-title">Название *</Label>
        <Input
          id="bf-title"
          required
          value={value.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Анна Каренина"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="bf-authors">Авторы</Label>
        <Input
          id="bf-authors"
          value={value.authors}
          onChange={(e) => set('authors', e.target.value)}
          placeholder="Фамилия Имя; Фамилия Имя"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="bf-publisher">Издательство</Label>
          <Input
            id="bf-publisher"
            value={value.publisher}
            onChange={(e) => set('publisher', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bf-year">Год</Label>
          <Input
            id="bf-year"
            inputMode="numeric"
            value={value.year}
            onChange={(e) =>
              set('year', e.target.value.replace(/\D/g, '').slice(0, 4))
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Серия</Label>
          <SeriesCombobox
            value={value.seriesName}
            onChange={(v) => set('seriesName', v)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bf-vol">Том</Label>
          <Input
            id="bf-vol"
            value={value.seriesNumber}
            onChange={(e) => set('seriesNumber', e.target.value)}
            placeholder="3"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="bf-pages">Страниц</Label>
          <Input
            id="bf-pages"
            inputMode="numeric"
            value={value.pages}
            onChange={(e) =>
              set('pages', e.target.value.replace(/\D/g, '').slice(0, 5))
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bf-isbn">ISBN-13</Label>
          <Input
            id="bf-isbn"
            className="font-mono text-[13px]"
            value={value.isbn13}
            onChange={(e) => set('isbn13', e.target.value)}
            placeholder="978-5-…"
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="bf-annotation">Аннотация</Label>
        <Textarea
          id="bf-annotation"
          rows={3}
          value={value.annotation}
          onChange={(e) => set('annotation', e.target.value)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Тэги</Label>
        <TagsInput
          value={value.tags}
          onChange={(t) => set('tags', t)}
          suggestions={tagSuggestions}
        />
      </div>

      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={value.wishlist}
          onChange={(e) => set('wishlist', e.target.checked)}
        />
        «Хочу» — книги ещё нет, это виш-лист
      </label>

      {!value.wishlist && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Библиотека</Label>
            <select
              className="h-10 rounded-lg border bg-card px-3 text-sm"
              value={value.libraryId}
              onChange={(e) =>
                onChange({ ...value, libraryId: e.target.value, shelfId: '' })
              }
            >
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>Полка</Label>
            <select
              className="h-10 rounded-lg border bg-card px-3 text-sm"
              value={value.shelfId}
              onChange={(e) => set('shelfId', e.target.value)}
            >
              <option value="">Неразобранное</option>
              {shelves.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" size="lg" disabled={busy || !value.title.trim()}>
          {submitLabel}
        </Button>
        {extraActions}
      </div>
    </form>
  )
}
