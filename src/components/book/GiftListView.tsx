import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Logo } from '@/components/layout/Logo'
import { ReportButton } from '@/components/book/ReportButton'
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
import { plural } from '@/lib/plural'
import type { ListShareView, PublicListItem } from '@/services/listShares'

/**
 * Гостевая витрина списка. Для вишлиста — бронь подарка: гость отмечает,
 * что дарит книгу, другие видят «уже дарят» без имени, владелец не видит
 * ничего. Ключ гостя живёт в localStorage — по нему снимается своя бронь.
 */

const KEY_STORAGE = 'polka-guest-key'
const NAME_STORAGE = 'polka-guest-name'

function guestKey(): string {
  const existing = localStorage.getItem(KEY_STORAGE)
  if (existing) return existing
  const key = crypto.randomUUID()
  localStorage.setItem(KEY_STORAGE, key)
  return key
}

export function GiftListView({
  initial,
  canSave,
  onSave,
  onHold,
  onRelease,
  onReload,
}: {
  initial: ListShareView
  /** Вошедший гость может забрать список к себе в «Друзей». */
  canSave: boolean
  onSave: () => Promise<unknown>
  onHold: (
    itemId: string,
    guestName: string,
    holderKey: string,
  ) => Promise<unknown>
  onRelease: (itemId: string, holderKey: string) => Promise<unknown>
  onReload: (holderKey: string) => Promise<ListShareView>
}) {
  const [saved, setSaved] = useState(false)
  const [view, setView] = useState(initial)
  const [asking, setAsking] = useState<PublicListItem | null>(null)
  const [name, setName] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  // свои брони видны только после гидрации: ключ гостя лежит в браузере
  useEffect(() => {
    setName(localStorage.getItem(NAME_STORAGE) ?? '')
    void onReload(guestKey()).then(setView)
  }, [onReload])

  async function hold() {
    if (!asking) return
    const guestName = name.trim()
    if (!guestName) return
    setBusyId(asking.id)
    try {
      await onHold(asking.id, guestName, guestKey())
      localStorage.setItem(NAME_STORAGE, guestName)
      setView(await onReload(guestKey()))
      setAsking(null)
      toast.success(`«${asking.title}» за вами`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  async function release(item: PublicListItem) {
    setBusyId(item.id)
    try {
      await onRelease(item.id, guestKey())
      setView(await onReload(guestKey()))
      toast.success('Бронь снята')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main className="mx-auto max-w-[640px] px-4 py-6 pb-16">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Logo />
        <span className="font-mono text-[11px] tracking-[0.1em] text-muted-foreground uppercase">
          {view.kind === 'wishlist' ? 'Вишлист' : 'Подборка'} · {view.ownerName}
        </span>
      </div>

      <h1 className="text-[25px] leading-[1.16] font-semibold tracking-[-0.015em]">
        {view.title}
      </h1>
      {view.description && (
        <p className="mt-2 max-w-[58ch] text-[14.5px] leading-[1.6] text-muted-foreground">
          {view.description}
        </p>
      )}
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        {view.items.length}{' '}
        {plural(view.items.length, 'книга', 'книги', 'книг')}
      </p>

      {canSave && (
        <Button
          variant="outline"
          className="mt-3"
          disabled={saved}
          onClick={() =>
            void onSave()
              .then(() => {
                setSaved(true)
                toast.success('Список сохранён — он в «Друзьях»')
              })
              .catch((e: unknown) =>
                toast.error(e instanceof Error ? e.message : 'Не получилось'),
              )
          }
        >
          {saved ? 'Сохранён в «Друзьях»' : 'Сохранить себе'}
        </Button>
      )}

      <div className="mt-3">
        {view.items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
          >
            {item.coverUrl ? (
              <img
                src={item.coverUrl}
                alt=""
                loading="lazy"
                className="h-14 w-[38px] flex-none rounded-[3px] object-cover shadow-sm"
              />
            ) : (
              <span
                aria-hidden
                className="h-14 w-[38px] flex-none rounded-[3px]"
                style={{
                  background: item.coverColor ?? '#D9CDB8',
                  boxShadow: 'inset 1.5px 0 0 rgba(255,255,255,.35)',
                }}
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {item.authors}
                {item.year && (
                  <>
                    {item.authors && ' · '}
                    <span className="font-mono text-[11.5px]">{item.year}</span>
                  </>
                )}
              </p>
              {item.note && (
                <p className="mt-1 border-l-2 pl-2 text-[12.5px] leading-snug text-muted-foreground">
                  {item.note}
                </p>
              )}
            </div>
            {view.gifts &&
              (item.heldByMe ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-none border-primary bg-accent/60 text-accent-foreground"
                  loading={busyId === item.id}
                  onClick={() => void release(item)}
                >
                  Дарю я · отменить
                </Button>
              ) : item.held ? (
                <span className="flex-none text-xs text-muted-foreground">
                  уже дарят
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-none text-accent-foreground"
                  onClick={() => setAsking(item)}
                >
                  Дарю эту
                </Button>
              ))}
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <a
          href="/rules"
          className="text-[12.5px] text-muted-foreground underline"
        >
          Правила
        </a>
        <ReportButton
          kind="share"
          targetId={view.shareId}
          subject={view.title}
        />
      </div>

      {view.gifts && (
        <p className="mt-5 text-[12.5px] text-muted-foreground">
          {view.ownerName} не видит, кто что дарит — сюрприз останется
          сюрпризом.
        </p>
      )}

      <Drawer
        open={asking !== null}
        onOpenChange={(o) => !o && setAsking(null)}
      >
        <DrawerContent>
          <DrawerHeader className="pt-1">
            <DrawerTitle>Дарю «{asking?.title}»</DrawerTitle>
            <DrawerDescription>
              Имя нужно, чтобы вы могли снять бронь, и чтобы не дарить одно и то
              же вдвоём. {view.ownerName} его не увидит.
            </DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="guest-name">Как вас зовут</Label>
            <Input
              id="guest-name"
              className="h-12 rounded-xl text-[16px]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Оля"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void hold()
              }}
            />
          </div>
          <DrawerFooter>
            <Button
              loading={busyId === asking?.id}
              disabled={!name.trim()}
              onClick={() => void hold()}
            >
              Беру на себя
            </Button>
            <Button variant="outline" onClick={() => setAsking(null)}>
              Отмена
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </main>
  )
}
