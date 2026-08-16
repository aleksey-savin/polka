import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createListFn } from '@/server/lists'

/** Создание списка на месте: кнопка превращается в поле, экран не меняется. */
export function NewListButton({ kind }: { kind: 'wishlist' | 'collection' }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    const name = title.trim()
    if (!name) return
    setBusy(true)
    try {
      const created = await createListFn({ data: { kind, title: name } })
      setTitle('')
      setEditing(false)
      await router.navigate({
        to: '/lists/$listId',
        params: { listId: created.id },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="flex min-h-[46px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-primary/45 text-sm font-semibold text-accent-foreground"
        onClick={() => setEditing(true)}
      >
        <Plus aria-hidden className="size-4" />
        {kind === 'wishlist' ? 'Новый вишлист' : 'Новая подборка'}
      </button>
    )
  }

  return (
    <div className="flex gap-2">
      <Input
        autoFocus
        className="h-12 rounded-xl text-[16px]"
        placeholder={
          kind === 'wishlist' ? 'Название вишлиста' : 'Название подборки'
        }
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void create()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <Button
        className="h-12 flex-none"
        loading={busy}
        onClick={() => void create()}
      >
        Создать
      </Button>
    </div>
  )
}
