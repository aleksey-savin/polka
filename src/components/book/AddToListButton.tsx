import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import {
  addToListFn,
  createListFn,
  listsForTargetFn,
  removeFromListFn,
} from '@/server/lists'
import type { ItemTarget, ListPick } from '@/services/lists'

/**
 * «+» вместо «В Хочу»: одна шторка со всеми списками сразу — вишлисты и
 * подборки. Один тап добавляет, повторный убирает; новый список создаётся
 * тут же, не уходя с экрана.
 */

const KIND_LABEL = { wishlist: 'Вишлисты', collection: 'Подборки' } as const

export function AddToListButton({
  target,
  title,
  subtitle,
  variant = 'icon',
  active = false,
  onChanged,
}: {
  target: ItemTarget
  /** Название книги — в шапке шторки. */
  title: string
  subtitle?: string
  variant?: 'icon' | 'wide'
  /** Книга уже в каком-то списке — кнопка отмечена галочкой. */
  active?: boolean
  onChanged?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [picks, setPicks] = useState<Array<ListPick> | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ wishlist: '', collection: '' })

  async function load() {
    setPicks(await listsForTargetFn({ data: target }))
  }

  function openSheet() {
    setOpen(true)
    setPicks(null)
    void load()
  }

  async function toggle(pick: ListPick) {
    setBusyId(pick.id)
    try {
      if (pick.contains) {
        await removeFromListFn({ data: { listId: pick.id, ...target } })
        toast.success(`«${title}» убрана из «${pick.title}»`)
      } else {
        await addToListFn({ data: { listId: pick.id, ...target } })
        toast.success(`«${title}» → «${pick.title}»`)
      }
      await load()
      onChanged?.()
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  async function createAndAdd(kind: 'wishlist' | 'collection') {
    const name = draft[kind].trim()
    if (!name) return
    setBusyId(`new-${kind}`)
    try {
      const created = await createListFn({ data: { kind, title: name } })
      await addToListFn({ data: { listId: created.id, ...target } })
      setDraft((d) => ({ ...d, [kind]: '' }))
      toast.success(`«${title}» → «${name}»`)
      await load()
      onChanged?.()
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  const groups = (['wishlist', 'collection'] as const).map((kind) => ({
    kind,
    items: picks?.filter((p) => p.kind === kind) ?? [],
  }))

  return (
    <>
      {variant === 'wide' ? (
        <Button
          variant="outline"
          className={`h-11 w-full ${active ? 'border-primary bg-accent/60 text-accent-foreground' : ''}`}
          onClick={openSheet}
        >
          {active ? <Check aria-hidden /> : <Plus aria-hidden />}
          {active ? 'В списках' : 'В список'}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="icon"
          className={`flex-none text-accent-foreground ${active ? 'border-primary bg-accent/60' : ''}`}
          aria-label={
            active
              ? `«${title}» уже в списках — изменить`
              : `Добавить «${title}» в список`
          }
          onClick={openSheet}
        >
          {active ? <Check aria-hidden /> : <Plus aria-hidden />}
        </Button>
      )}

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[86dvh]">
          <DrawerHeader className="pt-1">
            <DrawerTitle className="text-[17px] font-semibold">
              Куда добавить
            </DrawerTitle>
            <DrawerDescription className="truncate">
              «{title}»{subtitle && ` · ${subtitle}`}
            </DrawerDescription>
          </DrawerHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {picks === null ? (
              <p className="flex items-center gap-2.5 py-4 text-sm text-muted-foreground">
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
                />
                Загружаем списки…
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.kind} className="mb-3">
                  <p className="mt-2 mb-1 font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
                    {KIND_LABEL[group.kind]}
                  </p>
                  {group.items.map((pick) => (
                    <button
                      key={pick.id}
                      type="button"
                      className="flex min-h-12 w-full items-center gap-2.5 border-t text-left text-[14.5px] first:border-t-0 disabled:opacity-60"
                      disabled={busyId !== null}
                      onClick={() => void toggle(pick)}
                    >
                      <span
                        aria-hidden
                        className={`grid size-[22px] flex-none place-items-center rounded-md border-[1.5px] text-[13px] ${
                          pick.contains
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {pick.title}
                      </span>
                      <span className="flex-none font-mono text-[11px] text-muted-foreground">
                        {pick.itemCount}
                      </span>
                    </button>
                  ))}
                  <div className="mt-2 flex gap-2">
                    <Input
                      className="h-12 rounded-xl text-[16px]"
                      placeholder={
                        group.kind === 'wishlist'
                          ? 'Новый вишлист…'
                          : 'Новая подборка…'
                      }
                      value={draft[group.kind]}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [group.kind]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void createAndAdd(group.kind)
                      }}
                    />
                    <Button
                      className="h-12 flex-none"
                      loading={busyId === `new-${group.kind}`}
                      disabled={!draft[group.kind].trim()}
                      onClick={() => void createAndAdd(group.kind)}
                    >
                      Создать
                    </Button>
                  </div>
                </section>
              ))
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
