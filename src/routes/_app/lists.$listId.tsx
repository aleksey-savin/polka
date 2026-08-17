import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Ellipsis, Gift, Link2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { ActionMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  createListShareFn,
  getListFn,
  listGiftHoldsFn,
  removeListItemFn,
} from '@/server/lists'
import { dateRu } from '@/lib/dates'
import { plural } from '@/lib/plural'
import type { GiftRow } from '@/services/listShares'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'

export const Route = createFileRoute('/_app/lists/$listId')({
  loader: ({ params }) => getListFn({ data: { listId: params.listId } }),
  component: ListPage,
})

function ListPage() {
  const list = Route.useLoaderData()
  const router = useRouter()
  const [gifts, setGifts] = useState<Array<GiftRow> | null>(null)
  const [giftsOpen, setGiftsOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = () => void router.invalidate()
  const isWishlist = list.kind === 'wishlist'

  async function share() {
    setBusy(true)
    try {
      const { token } = await createListShareFn({
        data: { listId: list.id },
      })
      const url = `${window.location.origin}/s/${token}`
      await navigator.clipboard.writeText(url).catch(() => undefined)
      toast.success('Ссылка скопирована')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  async function showGifts() {
    setGiftsOpen(true)
    setGifts(await listGiftHoldsFn({ data: { listId: list.id } }))
  }

  async function removeItem(itemId: string, title: string) {
    try {
      await removeListItemFn({ data: { itemId } })
      toast.success(`«${title}» убрана из списка`)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    }
  }

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <Breadcrumbs
        items={[
          { label: 'Чтение', to: '/reading' },
          { label: isWishlist ? 'Вишлисты' : 'Подборки' },
        ]}
      />

      <p className="font-mono text-[11px] tracking-[0.1em] text-stamp uppercase">
        {isWishlist ? 'Вишлист' : 'Подборка'}
      </p>
      <h1 className="text-[25px] leading-[1.16] font-semibold tracking-[-0.015em]">
        {list.title}
      </h1>
      {list.description && (
        <p className="mt-2 max-w-[58ch] text-[14.5px] leading-[1.6] text-muted-foreground">
          {list.description}
        </p>
      )}

      {list.removedReason && (
        <div className="mt-3 rounded-2xl border border-destructive/40 bg-destructive/5 px-3.5 py-3">
          <b className="block text-[14.5px]">Список снят с публикации</b>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Причина: {list.removedReason}. Ссылка не работает, книги остались у
            вас — поправьте и включите ссылку заново.{' '}
            <Link to="/rules" className="underline">
              Правила
            </Link>
            .
          </p>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2">
        <Button loading={busy} onClick={() => void share()}>
          <Link2 aria-hidden /> {list.shareToken ? 'Ссылка' : 'Поделиться'}
        </Button>
        <Button variant="outline" asChild>
          <Link to="/lists/$listId/edit" params={{ listId: list.id }}>
            <Pencil aria-hidden /> Редактировать
          </Link>
        </Button>
        <ActionMenu
          caption={list.title}
          trigger={
            <Button variant="ghost">
              <Ellipsis aria-hidden />
            </Button>
          }
          entries={[
            ...(isWishlist
              ? [
                  {
                    key: 'gifts',
                    label: 'Кто что дарит',
                    sub: 'спойлер: испортит сюрприз',
                    icon: <Gift />,
                    onSelect: () => void showGifts(),
                  },
                ]
              : []),
            {
              key: 'edit',
              label: 'Редактировать',
              icon: <Pencil />,
              to: '/lists/$listId/edit',
              params: { listId: list.id },
            },
          ]}
        />
      </div>

      <p className="mt-4 font-mono text-[11px] text-muted-foreground">
        {list.items.length}{' '}
        {plural(list.items.length, 'книга', 'книги', 'книг')}
      </p>

      <div className="mt-1">
        {list.items.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            Пока пусто. Кнопка «+» у книги в каталоге, у автора или в цикле
            кладёт её сюда.
          </p>
        ) : (
          list.items.map((item) => {
            const target = item.myBookId
              ? ({
                  to: '/books/$bookId',
                  params: { bookId: item.myBookId },
                } as const)
              : item.refWorkId
                ? ({
                    to: '/works/$workId',
                    params: { workId: item.refWorkId },
                  } as const)
                : item.refBookId
                  ? ({
                      to: '/editions/$refBookId',
                      params: { refBookId: item.refBookId },
                    } as const)
                  : null
            const body = (
              <>
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
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.form !== 'book' && (
                      <span className="mr-1.5 inline-block rounded-[3px] border-[1.5px] border-muted-foreground/55 px-1 align-[1px] font-mono text-[9.5px] tracking-[0.07em] uppercase">
                        {item.form === 'work' ? 'произведение' : 'издание'}
                      </span>
                    )}
                    {item.authors}
                    {item.year && (
                      <>
                        {item.authors && ' · '}
                        <span className="font-mono text-[11.5px]">
                          {item.year}
                        </span>
                      </>
                    )}
                    {item.place && ` · ${item.place}`}
                  </span>
                  {item.note && (
                    <span className="mt-1 block border-l-2 pl-2 text-[12.5px] leading-snug text-muted-foreground">
                      {item.note}
                    </span>
                  )}
                </span>
              </>
            )
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
              >
                {target ? (
                  <Link
                    {...target}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    {body}
                  </Link>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    {body}
                  </span>
                )}
                {item.myBookId && (
                  <span className="flex-none rounded-[3px] border-[1.5px] border-primary px-1.5 font-mono text-[10px] tracking-[0.08em] text-accent-foreground uppercase">
                    на полке
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Убрать «${item.title}» из списка`}
                  onClick={() => void removeItem(item.id, item.title)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            )
          })
        )}
      </div>

      <Drawer open={giftsOpen} onOpenChange={setGiftsOpen}>
        <DrawerContent className="max-h-[80dvh]">
          <DrawerHeader className="pt-1">
            <DrawerTitle>Кто что дарит</DrawerTitle>
            <DrawerDescription>
              Это спойлер: дальше видно, кто какую книгу уже забрал.
            </DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {gifts === null ? (
              <p className="py-3 text-sm text-muted-foreground">Смотрим…</p>
            ) : gifts.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                Пока никто ничего не забрал.
              </p>
            ) : (
              gifts.map((g) => (
                <div
                  key={g.itemId}
                  className="flex items-baseline gap-3 border-t py-2.5 first:border-t-0"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {g.title}
                  </span>
                  <span className="flex-none text-[13px]">{g.guestName}</span>
                  <span className="flex-none font-mono text-[11px] text-muted-foreground">
                    {dateRu(g.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
          <DrawerFooter>
            <Button variant="outline" onClick={() => setGiftsOpen(false)}>
              Закрыть
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
