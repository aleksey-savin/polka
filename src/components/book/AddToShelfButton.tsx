import { useState } from 'react'
import { Library } from 'lucide-react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { createBookFn, getBookFormMetaFn } from '@/server/books'

/**
 * «Добавить на полку» со страниц эталона (M20): книга в руках — это книга
 * дома. Кладём в «Неразобранное» той же библиотеки, что и сканер (липкий
 * выбор из потока добавления), разложить можно потом.
 */

const DEST_KEY = 'polka.add.dest'

export function AddToShelfButton({
  title,
  authors,
  publisher,
  year,
  pages,
  isbn13,
  refWorkId,
  className,
}: {
  title: string
  authors: string
  publisher?: string | null
  year?: number | null
  pages?: number | null
  isbn13?: string | null
  refWorkId?: string | null
  className?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    try {
      let libraryId = ''
      let shelfId = ''
      try {
        const stored = localStorage.getItem(DEST_KEY)
        if (stored) {
          const dest = JSON.parse(stored) as {
            libraryId?: string
            shelfId?: string
          }
          libraryId = dest.libraryId ?? ''
          shelfId = dest.shelfId ?? ''
        }
      } catch {
        // липкий выбор недоступен — возьмём первую библиотеку
      }
      if (!libraryId) {
        const meta = await getBookFormMetaFn()
        libraryId = meta.libraries[0]?.id ?? ''
        shelfId = ''
      }
      if (!libraryId) {
        toast.error('Сначала создайте библиотеку')
        return
      }

      const { id } = await createBookFn({
        data: {
          title,
          authors,
          publisher: publisher ?? undefined,
          year: year ?? null,
          pages: pages ?? null,
          isbn13: isbn13 ?? undefined,
          refWorkId: refWorkId ?? null,
          libraryId,
          shelfId: shelfId || null,
        },
      })
      toast.success(`«${title}» — на полке`, {
        action: {
          label: 'Открыть',
          onClick: () =>
            void router.navigate({
              to: '/books/$bookId',
              params: { bookId: id },
            }),
        },
      })
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button className={className} loading={busy} onClick={() => void add()}>
      <Library aria-hidden /> Добавить на полку
    </Button>
  )
}
