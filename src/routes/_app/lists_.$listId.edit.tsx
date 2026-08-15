import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { deleteListFn, getListFn, updateListFn } from '@/server/lists'

export const Route = createFileRoute('/_app/lists_/$listId/edit')({
  loader: ({ params }) => getListFn({ data: { listId: params.listId } }),
  component: EditListPage,
})

const FIELD = 'h-12 rounded-xl text-[16px]'

function EditListPage() {
  const list = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const [title, setTitle] = useState(list.title)
  const [description, setDescription] = useState(list.description ?? '')
  const [kind, setKind] = useState(list.kind)
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function save() {
    setBusy(true)
    try {
      await updateListFn({
        data: { listId: list.id, title, description, kind },
      })
      toast.success('Сохранено')
      void router.invalidate()
      await navigate({ to: '/lists/$listId', params: { listId: list.id } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    await deleteListFn({ data: { listId: list.id } })
    toast.success(`«${list.title}» удалён`)
    await navigate({ to: '/reading' })
  }

  return (
    <div className="mx-auto max-w-[640px] pb-28">
      <p className="mb-4 truncate text-[13px] text-muted-foreground">
        <Link to="/reading" className="hover:text-foreground">
          Чтение
        </Link>{' '}
        /{' '}
        <Link
          to="/lists/$listId"
          params={{ listId: list.id }}
          className="hover:text-foreground"
        >
          {list.title}
        </Link>{' '}
        / Правка
      </p>

      <h1 className="text-[22px] font-semibold">Настройки списка</h1>

      <div className="mt-5 grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="lt">Название</Label>
          <Input
            id="lt"
            className={FIELD}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Китайская классика"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="ld">Описание</Label>
          <Textarea
            id="ld"
            rows={4}
            className="rounded-xl text-[16px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Зачем этот список и с чего начать"
          />
        </div>

        <div className="grid gap-1.5">
          <Label>Вид</Label>
          {(
            [
              {
                value: 'wishlist' as const,
                title: 'Вишлист',
                sub: 'что хочу почитать; гости могут забронировать подарок',
              },
              {
                value: 'collection' as const,
                title: 'Подборка',
                sub: 'что почитать по теме; броней нет',
              },
            ] satisfies Array<{
              value: 'wishlist' | 'collection'
              title: string
              sub: string
            }>
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left ${
                kind === opt.value
                  ? 'border-primary/45 bg-accent/50'
                  : 'border-border'
              }`}
              onClick={() => setKind(opt.value)}
            >
              <span
                aria-hidden
                className={`grid size-5 flex-none place-items-center rounded-full border-[1.5px] ${
                  kind === opt.value ? 'border-primary' : 'border-border'
                }`}
              >
                {kind === opt.value && (
                  <span className="size-2.5 rounded-full bg-primary" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{opt.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {opt.sub}
                </span>
              </span>
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          className="justify-start text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 aria-hidden /> Удалить список
        </Button>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-[640px] gap-2">
          <Button className="h-12 flex-1" loading={busy} onClick={() => void save()}>
            Сохранить
          </Button>
          <Button variant="outline" className="h-12" asChild>
            <Link to="/lists/$listId" params={{ listId: list.id }}>
              Отмена
            </Link>
          </Button>
        </div>
      </div>

      <Drawer open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DrawerContent>
          <DrawerHeader className="pt-1">
            <DrawerTitle>Удалить «{list.title}»?</DrawerTitle>
            <DrawerDescription>
              Список исчезнет вместе с ссылкой на него. Книги останутся на
              местах — из каталога ничего не удаляется.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button variant="destructive" onClick={() => void remove()}>
              Удалить
            </Button>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Отмена
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
