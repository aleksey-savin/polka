import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import {
  BookForm,
  EMPTY_BOOK_FORM,
  toBookInput,
} from '@/components/book/BookForm'
import type { BookFormValue } from '@/components/book/BookForm'
import { createBookFn } from '@/server/books'

export const Route = createFileRoute('/_app/books/new')({
  validateSearch: z.object({
    library: z.string().optional(),
    shelf: z.string().optional(),
  }),
  component: NewBookPage,
})

function NewBookPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [value, setValue] = useState<BookFormValue>({
    ...EMPTY_BOOK_FORM,
    libraryId: search.library ?? '',
    shelfId: search.shelf ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const { id } = await createBookFn({ data: toBookInput(value) })
      await navigate({ to: '/books/$bookId', params: { bookId: id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось сохранить книгу')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-5 text-3xl font-semibold">Новая книга</h1>
      <BookForm
        value={value}
        onChange={setValue}
        onSubmit={() => void submit()}
        submitLabel="Сохранить книгу"
        busy={busy}
        error={error}
      />
    </div>
  )
}
