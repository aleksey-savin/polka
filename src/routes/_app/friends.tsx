import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { Link2Off, Mail, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { ActionMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { dateRu } from '@/lib/dates'
import { plural } from '@/lib/plural'
import { listMyLibrariesFn } from '@/server/libraries'
import { listMyShelvesFn } from '@/server/shelves'
import {
  createShareFn,
  createSignupInviteFn,
  listMySharesFn,
  listPendingRequestsFn,
  listSavedSharesFn,
  removeSavedShareFn,
  revokeShareFn,
  saveShareFn,
} from '@/server/shares'
import { spineFor } from '@/services/spine'

export const Route = createFileRoute('/_app/friends')({
  validateSearch: z.object({ tab: z.enum(['saved', 'mine']).optional() }),
  loader: async () => {
    const [saved, mine, pending] = await Promise.all([
      listSavedSharesFn(),
      listMySharesFn(),
      listPendingRequestsFn(),
    ])
    return { saved, mine, pending }
  },
  component: FriendsPage,
})

function FriendsPage() {
  const { saved, mine, pending } = Route.useLoaderData()
  const { tab = 'saved' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refresh = () => void router.invalidate()
  const [linkInput, setLinkInput] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(
    null,
  )

  async function saveByLink() {
    const token =
      linkInput.trim().split('/s/')[1]?.split(/[/?#]/)[0] ?? linkInput.trim()
    if (!token) return
    setSaveBusy(true)
    try {
      await saveShareFn({ data: { token } })
      setLinkInput('')
      toast.success('Полка друга сохранена')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось сохранить')
    } finally {
      setSaveBusy(false)
    }
  }

  async function copyShare(token: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/s/${token}`)
    toast.success('Ссылка скопирована')
  }

  return (
    <div className="mx-auto max-w-[640px]">
      <div className="flex items-baseline gap-4">
        <h1 className="text-3xl font-semibold">Друзья</h1>
        <span className="ml-auto">
          <InvitePolkaDialog />
        </span>
      </div>

      {/* Заявки: мобильный вход в /requests */}
      {pending.length > 0 && (
        <Link
          to="/requests"
          className="mt-3.5 flex items-center gap-3 rounded-xl border border-stamp/25 bg-stamp/5 p-3"
        >
          <Mail aria-hidden className="size-[22px] flex-none text-stamp" />
          <span className="min-w-0 flex-1 text-[14.5px]">
            <b className="font-semibold">
              {pending.length}{' '}
              {plural(pending.length, 'заявка', 'заявки', 'заявок')}
            </b>{' '}
            на книги
            <span className="block truncate text-[12.5px] text-muted-foreground">
              {pending
                .slice(0, 2)
                .map((r) => `${r.guestName} просит «${r.bookTitle}»`)
                .join(', ')}
              {pending.length > 2 && ` …и ещё ${pending.length - 2}`}
            </span>
          </span>
          <span className="flex-none text-[13px] font-semibold whitespace-nowrap text-stamp">
            Разобрать →
          </span>
        </Link>
      )}

      <div className="mt-3.5 flex w-fit rounded-full border bg-card p-1">
        {(
          [
            ['saved', 'Полки друзей', saved.length],
            ['mine', 'Мои ссылки', mine.length],
          ] as const
        ).map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            className={
              tab === key
                ? 'rounded-full bg-foreground px-3.5 py-2 text-[13px] font-semibold text-white'
                : 'rounded-full px-3.5 py-2 text-[13px] font-semibold text-muted-foreground'
            }
            onClick={() => void navigate({ search: { tab: key } })}
          >
            {label}{' '}
            <span className="font-mono text-[11px] opacity-75">{n}</span>
          </button>
        ))}
      </div>

      {tab === 'saved' ? (
        <>
          <div className="mt-3.5 flex gap-2">
            <Input
              className="h-11 flex-1 rounded-xl text-[16px]"
              placeholder="Вставьте ссылку от друга…"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
            />
            <Button
              className="h-11 rounded-xl"
              loading={saveBusy}
              disabled={!linkInput.trim()}
              onClick={() => void saveByLink()}
            >
              Сохранить
            </Button>
          </div>

          <div className="mt-3.5 grid gap-2.5">
            {saved.map((s) => (
              <div
                key={s.shareId}
                className="rounded-[14px] border bg-card p-3.5"
              >
                <div className="flex items-baseline gap-2.5">
                  <b className="min-w-0 truncate text-base">
                    {s.title} — у {s.ownerNames}
                  </b>
                  <span className="flex-none font-mono text-[11.5px] text-muted-foreground">
                    {s.bookCount}{' '}
                    {plural(s.bookCount, 'книга', 'книги', 'книг')}
                  </span>
                  <span className="ml-auto">
                    <ActionMenu
                      caption={`${s.title} — у ${s.ownerNames}`}
                      trigger={
                        <button
                          type="button"
                          aria-label="Ещё"
                          className="px-1.5 text-base text-muted-foreground"
                        >
                          ···
                        </button>
                      }
                      entries={[
                        {
                          key: 'remove',
                          label: 'Убрать из сохранённых',
                          icon: <Trash2 />,
                          onSelect: () =>
                            void removeSavedShareFn({
                              data: { shareId: s.shareId },
                            }).then(refresh),
                        },
                      ]}
                    />
                  </span>
                </div>
                {s.preview.length > 0 && (
                  <>
                    <div className="mt-1 flex items-end gap-[2px] px-2 pt-2.5">
                      {s.preview.map((b, i) => {
                        const look = spineFor(b.title, b.pages)
                        return (
                          <span
                            key={i}
                            aria-hidden
                            className="rounded-t-[1.5px]"
                            style={{
                              width: Math.round(look.width * 0.28),
                              height: Math.round(look.height * 0.22),
                              background: b.coverColor ?? look.color,
                              boxShadow: 'inset 0.5px 0 0 rgba(255,255,255,.4)',
                            }}
                          />
                        )
                      })}
                    </div>
                    <div
                      aria-hidden
                      className="h-1.5 rounded-[2px]"
                      style={{
                        background: `linear-gradient(to bottom, color-mix(in oklab, ${s.boardColor} 88%, #fff), color-mix(in oklab, ${s.boardColor} 80%, #232B38))`,
                      }}
                    />
                  </>
                )}
                <a
                  href={`/s/${s.token}`}
                  className="mt-2.5 inline-block text-[13px] font-semibold text-accent-foreground"
                >
                  Открыть витрину →
                </a>
              </div>
            ))}
          </div>
          {saved.length === 0 && (
            <Card className="mt-3.5">
              <CardContent className="py-10 text-center text-muted-foreground">
                Пока пусто. Когда друг пришлёт ссылку на свою полку — вставьте
                её выше или нажмите «Сохранить себе» прямо на витрине.
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
          <div className="mt-3.5 grid gap-2.5">
            {mine.map((s) => (
              <div key={s.id} className="rounded-[14px] border bg-card p-3.5">
                <div className="flex items-baseline gap-2.5">
                  <b className="min-w-0 truncate text-base">{s.targetName}</b>
                  <span className="flex-none rounded-[3px] border-[1.5px] border-stamp px-1.5 font-mono text-[10px] tracking-[0.08em] text-stamp uppercase">
                    {s.scope === 'library' ? 'библиотека' : 'полка'}
                  </span>
                  <span className="ml-auto">
                    <ActionMenu
                      caption={`Ссылка на «${s.targetName}»`}
                      trigger={
                        <button
                          type="button"
                          aria-label="Ещё"
                          className="px-1.5 text-base text-muted-foreground"
                        >
                          ···
                        </button>
                      }
                      entries={[
                        {
                          key: 'revoke',
                          label: 'Отозвать ссылку',
                          icon: <Link2Off />,
                          danger: true,
                          onSelect: () =>
                            setRevoke({ id: s.id, name: s.targetName }),
                        },
                      ]}
                    />
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {s.scope === 'shelf' && `${s.libraryName} · `}
                  {s.pendingRequests > 0 && (
                    <span className="font-semibold text-stamp">
                      {s.pendingRequests}{' '}
                      {plural(s.pendingRequests, 'заявка', 'заявки', 'заявок')}{' '}
                      ·{' '}
                    </span>
                  )}
                  создана{' '}
                  <span className="font-mono text-xs">
                    {dateRu(s.createdAt)}
                  </span>
                </p>
                <Button
                  variant="outline"
                  className="mt-2.5 h-[42px] w-full"
                  onClick={() => void copyShare(s.token)}
                >
                  Скопировать ссылку
                </Button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="mt-3.5 flex min-h-14 w-full items-center justify-center gap-2.5 rounded-[14px] border-[1.5px] border-dashed border-primary/45 text-[14.5px] font-semibold text-accent-foreground"
            onClick={() => setShareOpen(true)}
          >
            <span
              aria-hidden
              className="grid size-[22px] place-items-center rounded-full border-[1.5px] border-dashed border-primary text-sm leading-none"
            >
              +
            </span>
            Поделиться полкой или библиотекой
          </button>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Отзыв ссылки сразу закрывает витрину и убирает её из «Друзей» у
            всех, кто сохранил.
          </p>
        </>
      )}

      <ShareSheet
        open={shareOpen}
        onOpenChange={setShareOpen}
        onCreated={refresh}
      />
      <Drawer
        open={revoke !== null}
        onOpenChange={(o) => !o && setRevoke(null)}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Отозвать ссылку на «{revoke?.name}»?</DrawerTitle>
          </DrawerHeader>
          <p className="text-sm text-muted-foreground">
            Витрина сразу закроется и пропадёт из «Друзей» у всех, кто её
            сохранил. Новую ссылку можно создать в любой момент.
          </p>
          <DrawerFooter>
            <Button
              variant="destructive"
              onClick={() => {
                if (!revoke) return
                void revokeShareFn({ data: { shareId: revoke.id } }).then(
                  () => {
                    setRevoke(null)
                    refresh()
                  },
                )
              }}
            >
              Отозвать
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

interface ShareTarget {
  key: string
  label: string
  kind: 'библиотека' | 'полка'
  payload:
    | { scope: 'library'; libraryId: string }
    | { scope: 'shelf'; shelfId: string }
}

/** Шторка «Чем поделиться?»: цели радио-строками, ссылка сразу в буфер. */
function ShareSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [targets, setTargets] = useState<Array<ShareTarget>>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const [libs, shelves] = await Promise.all([
      listMyLibrariesFn(),
      listMyShelvesFn(),
    ])
    const list: Array<ShareTarget> = []
    for (const lib of libs) {
      list.push({
        key: `lib:${lib.id}`,
        label: lib.name,
        kind: 'библиотека',
        payload: { scope: 'library', libraryId: lib.id },
      })
      for (const s of shelves.filter((x) => x.libraryId === lib.id)) {
        list.push({
          key: `shelf:${s.id}`,
          label: `${lib.name} · ${s.name}`,
          kind: 'полка',
          payload: { scope: 'shelf', shelfId: s.id },
        })
      }
    }
    setTargets(list)
    setSelectedKey(list[0]?.key ?? '')
  }

  const selected = targets.find((t) => t.key === selectedKey)

  async function submit() {
    if (!selected) return
    setBusy(true)
    try {
      const { token } = await createShareFn({ data: selected.payload })
      try {
        await navigator.clipboard.writeText(
          `${window.location.origin}/s/${token}`,
        )
        toast.success('Ссылка создана и скопирована')
      } catch {
        toast.success('Ссылка создана')
      }
      onOpenChange(false)
      onCreated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (o) void load()
      }}
    >
      <DrawerContent aria-describedby={undefined} className="sm:max-w-sm">
        <DrawerHeader>
          <DrawerTitle>Чем поделиться?</DrawerTitle>
          <DrawerDescription>
            Гость увидит только книги: без заметок, оценок и имён должников.
          </DrawerDescription>
        </DrawerHeader>
        <div className="grid max-h-[46dvh] gap-1.5 overflow-y-auto">
          {targets.map((t) => {
            const on = t.key === selectedKey
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                className={`flex min-h-12 w-full items-center gap-2.5 rounded-xl border px-3 text-left text-[15px] font-medium ${
                  on ? 'border-primary/50 bg-accent' : 'bg-card'
                }`}
                onClick={() => setSelectedKey(t.key)}
              >
                <span
                  aria-hidden
                  className={`grid size-5 flex-none place-items-center rounded-full border-[1.5px] ${
                    on ? 'border-primary' : 'border-border'
                  }`}
                >
                  {on && <span className="size-2.5 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0 truncate">{t.label}</span>
                <span className="ml-auto flex-none font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">
                  {t.kind}
                </span>
              </button>
            )
          })}
        </div>
        <DrawerFooter>
          <Button
            size="lg"
            loading={busy}
            disabled={!selected}
            onClick={() => void submit()}
          >
            Создать ссылку{selected ? ` на «${selected.label}»` : ''}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function InvitePolkaDialog() {
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setBusy(true)
    try {
      const { token } = await createSignupInviteFn()
      setLink(`${window.location.origin}/join/${token}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer onOpenChange={(o) => !o && setLink(null)}>
      <DrawerTrigger asChild>
        <Button variant="outline">Пригласить в Полку</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Приглашение зарегистрироваться</DrawerTitle>
          <DrawerDescription>
            Регистрация в Полке — только по таким ссылкам. Ссылка одноразовая,
            живёт 7 дней. Чтобы человек попал в вашу библиотеку совладельцем —
            после регистрации пришлите ему ещё инвайт из шапки библиотеки.
          </DrawerDescription>
        </DrawerHeader>
        {link ? (
          <div className="grid gap-2">
            <Input
              readOnly
              value={link}
              className="font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button
              onClick={() =>
                void navigator.clipboard.writeText(link).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }
            >
              {copied ? 'Скопировано' : 'Скопировать ссылку'}
            </Button>
          </div>
        ) : (
          <DrawerFooter>
            <Button onClick={() => void generate()} loading={busy}>
              Создать ссылку
            </Button>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  )
}
