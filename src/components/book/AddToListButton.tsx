import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Link, useRouter } from '@tanstack/react-router'

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
  removeListItemFn,
} from '@/server/lists'
import type { ItemTarget, ListPick } from '@/services/lists'

/**
 * «+» вместо «В Хочу»: одна шторка со всеми списками сразу.
 * Членство сквозное — галочка горит, в какой бы форме книга ни лежала
 * (моя книга / произведение / издание), подпись говорит в какой.
 * Конфликт форм — мягкая подсказка, не запрет.
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
  /** Раскрытая панель конфликта форм — под строкой этого списка. */
  const [conflictId, setConflictId] = useState<string | null>(null)

  async function load() {
    setPicks(await listsForTargetFn({ data: target }))
  }

  function openSheet() {
    setOpen(true)
    setPicks(null)
    setConflictId(null)
    void load()
  }

  function done() {
    onChanged?.()
    void router.invalidate()
  }

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id)
    try {
      await action()
      await load()
      done()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  async function tap(pick: ListPick) {
    // книга уже здесь в другой форме — сначала мягкий вопрос
    if (pick.conflict && conflictId !== pick.id) {
      setConflictId(pick.id)
      return
    }
    setConflictId(null)
    if (pick.match && !pick.conflict) {
      // лежит в той же (или несвязанно-другой) форме — тап убирает её
      const itemId = pick.match.itemId
      await run(pick.id, async () => {
        await removeListItemFn({ data: { itemId } })
        toast.success(`«${title}» убрана из «${pick.title}»`)
      })
      return
    }
    await run(pick.id, async () => {
      await addToListFn({ data: { listId: pick.id, ...target } })
      toast.success(`«${title}» → «${pick.title}»`)
    })
  }

  /** «Заменить»: убрать произведение, положить это издание. */
  async function replaceWork(pick: ListPick) {
    const itemId = pick.match?.itemId
    setConflictId(null)
    await run(pick.id, async () => {
      if (itemId) await removeListItemFn({ data: { itemId } })
      await addToListFn({ data: { listId: pick.id, ...target } })
      toast.success(`«${title}» → «${pick.title}» (изданием)`)
    })
  }

  /** «Оставить оба» / «Всё равно добавить»: просто кладём цель рядом. */
  async function addAnyway(pick: ListPick) {
    setConflictId(null)
    await run(pick.id, async () => {
      await addToListFn({ data: { listId: pick.id, ...target } })
      toast.success(`«${title}» → «${pick.title}»`)
    })
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
      done()
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
                    <div key={pick.id} className="border-t first:border-t-0">
                      <button
                        type="button"
                        className="flex min-h-12 w-full items-center gap-2.5 text-left text-[14.5px] disabled:opacity-60"
                        disabled={busyId !== null}
                        onClick={() => void tap(pick)}
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
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{pick.title}</span>
                          {pick.match && (
                            <span className="block truncate text-[11.5px] text-muted-foreground">
                              уже здесь — {pick.match.formLabel}
                            </span>
                          )}
                        </span>
                        <span className="flex-none font-mono text-[11px] text-muted-foreground">
                          {pick.itemCount}
                        </span>
                      </button>

                      {conflictId === pick.id && pick.conflict && (
                        <div className="mb-2.5 ml-8 rounded-xl border border-stamp/30 bg-stamp/5 px-3 py-2.5">
                          {pick.conflict === 'work-behind' ? (
                            <>
                              <p className="mb-2 text-[13px] leading-snug">
                                «{title}» уже в этом списке как произведение.
                                Заменить его конкретным изданием?
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  loading={busyId === pick.id}
                                  onClick={() => void replaceWork(pick)}
                                >
                                  Заменить
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busyId !== null}
                                  onClick={() => void addAnyway(pick)}
                                >
                                  Оставить оба
                                </Button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="mb-2 text-[13px] leading-snug">
                                В списке уже есть издание этой книги —
                                произведение можно не добавлять.
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  disabled={busyId !== null}
                                  onClick={() => setConflictId(null)}
                                >
                                  Не добавлять
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  loading={busyId === pick.id}
                                  onClick={() => void addAnyway(pick)}
                                >
                                  Всё равно добавить
                                </Button>
                                {pick.match?.refBookId && (
                                  <Link
                                    to="/editions/$refBookId"
                                    params={{ refBookId: pick.match.refBookId }}
                                    className="text-[13px] font-semibold text-accent-foreground"
                                    onClick={() => setOpen(false)}
                                  >
                                    к изданию →
                                  </Link>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
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
