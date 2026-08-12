import { useEffect, useState } from 'react'

import { SeriesCombobox } from '@/components/book/SeriesCombobox'
import { TagsInput } from '@/components/book/TagsInput'
import { ActionMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getBookFormMetaFn } from '@/server/books'
import { getLibraryOverviewFn } from '@/server/libraries'

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
  coverType: '' | 'soft' | 'hard'
  /** Подарочное издание — тип издания, влияет на габариты корешка. */
  giftEdition: boolean
  /** Высота в мм: поля в форме нет, значение живёт из FantLab. */
  heightMm: string
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
  coverType: '',
  giftEdition: false,
  heightMm: '',
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
    coverType: v.coverType || null,
    giftEdition: v.giftEdition,
    heightMm: v.heightMm ? Number(v.heightMm) : null,
  }
}

export interface FormSecondaryAction {
  key: string
  label: string
  danger?: boolean
  onSelect: () => void
}

const BINDING_OPTIONS = [
  ['', 'Не знаю'],
  ['soft', 'Мягкая обложка'],
  ['hard', 'Твёрдый переплёт'],
] as const

/** Поля ≥48px со шрифтом 16px — iOS не зумит форму. */
const FIELD = 'h-12 rounded-xl text-[16px]'

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-[14.5px] select-none">
      {label}
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="relative ml-auto h-7 w-[46px] flex-none rounded-full bg-border transition-colors peer-checked:bg-primary after:absolute after:top-[3px] after:left-[3px] after:size-[22px] after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-[18px]"
      />
    </label>
  )
}

export function BookForm({
  value,
  onChange,
  onSubmit,
  submitLabel,
  secondaryActions = [],
  busy,
  error,
}: {
  value: BookFormValue
  onChange: (value: BookFormValue) => void
  onSubmit: () => void
  submitLabel: string
  secondaryActions?: Array<FormSecondaryAction>
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
    void getBookFormMetaFn().then((meta) => {
      setLibraries(meta.libraries)
      setTagSuggestions(meta.tags)
      if (!value.libraryId && meta.libraries.length > 0)
        set('libraryId', meta.libraries[0]?.id ?? '')
    })
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
      className="grid gap-4 pb-24 sm:pb-0"
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
          className={FIELD}
          value={value.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Анна Каренина"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="bf-authors">Авторы</Label>
        <Input
          id="bf-authors"
          className={FIELD}
          value={value.authors}
          onChange={(e) => set('authors', e.target.value)}
          placeholder="Фамилия Имя; Фамилия Имя"
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Переплёт</Label>
        <div className="flex flex-wrap gap-1.5">
          {BINDING_OPTIONS.map(([val, label]) => (
            <button
              key={val}
              type="button"
              aria-pressed={value.coverType === val}
              className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium ${
                value.coverType === val
                  ? 'border-primary/45 bg-accent text-accent-foreground'
                  : 'bg-card'
              }`}
              onClick={() => set('coverType', val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <SwitchRow
        label="Подарочное издание"
        checked={value.giftEdition}
        onChange={(v) => set('giftEdition', v)}
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="bf-publisher">Издательство</Label>
          <Input
            id="bf-publisher"
            className={FIELD}
            value={value.publisher}
            onChange={(e) => set('publisher', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bf-year">Год</Label>
          <Input
            id="bf-year"
            inputMode="numeric"
            className={`${FIELD} font-mono`}
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
            inputMode="numeric"
            className={`${FIELD} font-mono`}
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
            className={`${FIELD} font-mono`}
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
            inputMode="numeric"
            className={`${FIELD} font-mono`}
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
          className="rounded-xl text-[16px]"
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

      <SwitchRow
        label="«Хочу» — книги ещё нет, это виш-лист"
        checked={value.wishlist}
        onChange={(v) => set('wishlist', v)}
      />

      {!value.wishlist && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Библиотека</Label>
            <select
              className="h-12 rounded-xl border bg-card px-3 text-[16px]"
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
              className="h-12 rounded-xl border bg-card px-3 text-[16px]"
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

      {/* Липкая панель сохранения: на мобильном всегда под пальцем */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t bg-card px-4 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button
          type="submit"
          className="h-12 flex-1 sm:flex-none sm:px-6"
          loading={busy}
          disabled={!value.title.trim()}
        >
          {submitLabel}
        </Button>
        {secondaryActions.length > 0 && (
          <>
            <div className="hidden gap-2 sm:flex">
              {secondaryActions.map((a) => (
                <Button
                  key={a.key}
                  type="button"
                  variant={a.danger ? 'ghost' : 'outline'}
                  className={`h-12 ${a.danger ? 'text-destructive' : ''}`}
                  disabled={busy}
                  onClick={a.onSelect}
                >
                  {a.label}
                </Button>
              ))}
            </div>
            <span className="sm:hidden">
              <ActionMenu
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-12 w-12 rounded-xl"
                    aria-label="Ещё варианты"
                    disabled={busy}
                  >
                    ···
                  </Button>
                }
                entries={secondaryActions.map((a) => ({
                  key: a.key,
                  label: a.label,
                  danger: a.danger,
                  onSelect: a.onSelect,
                }))}
              />
            </span>
          </>
        )}
      </div>
    </form>
  )
}
