import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { BookForm, toBookInput } from '@/components/book/BookForm'
import type { BookFormValue } from '@/components/book/BookForm'
import { getBookCardFn, updateBookFn } from '@/server/books'

export const Route = createFileRoute('/_app/books_/$bookId/edit')({
  loader: ({ params }) => getBookCardFn({ data: { bookId: params.bookId } }),
  component: EditBookPage,
})

function EditBookPage() {
  const book = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const [value, setValue] = useState<BookFormValue>({
    title: book.title,
    authors: book.authors,
    isbn13: book.isbn13 ?? '',
    isbn10: book.isbn10 ?? '',
    publisher: book.publisher ?? '',
    year: book.year?.toString() ?? '',
    pages: book.pages?.toString() ?? '',
    language: book.language,
    annotation: book.annotation ?? '',
    seriesName: book.seriesName ?? '',
    seriesNumber: book.seriesNumber ?? '',
    tags: book.tags,
    libraryId: book.libraryId ?? '',
    shelfId: book.shelfId ?? '',
    wishlist: book.status === 'wishlist',
    coverUrl: '',
    coverType: book.coverType ?? '',
    heightMm: book.heightMm?.toString() ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await updateBookFn({ data: { bookId: book.id, ...toBookInput(value) } })
      await navigate({ to: '/books/$bookId', params: { bookId: book.id } })
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не получилось сохранить изменения',
      )
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-5 text-3xl font-semibold">Правка: {book.title}</h1>
      <BookForm
        value={value}
        onChange={setValue}
        onSubmit={() => void submit()}
        submitLabel="Сохранить изменения"
        busy={busy}
        error={error}
      />
    </div>
  )
}
