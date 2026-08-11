import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { plural } from '@/lib/plural'
import { listMyLibrariesFn, getLibraryOverviewFn } from '@/server/libraries'
import {
  createShareFn,
  createSignupInviteFn,
  listMySharesFn,
  listSavedSharesFn,
  removeSavedShareFn,
  revokeShareFn,
  saveShareFn,
} from '@/server/shares'

export const Route = createFileRoute('/_app/friends')({
  validateSearch: z.object({ tab: z.enum(['saved', 'mine']).optional() }),
  loaderDeps: ({ search }) => ({ tab: search.tab ?? 'saved' }),
  loader: async () => {
    const [saved, mine] = await Promise.all([
      listSavedSharesFn(),
      listMySharesFn(),
    ])
    return { saved, mine }
  },
  component: FriendsPage,
})

const dateRu = (value: Date | string) =>
  new Date(value).toLocaleDateString('ru-RU')

function FriendsPage() {
  const { saved, mine } = Route.useLoaderData()
  const { tab = 'saved' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const refresh = () => void router.invalidate()
  const [linkInput, setLinkInput] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function saveByLink() {
    const token =
      linkInput.trim().split('/s/')[1]?.split(/[/?#]/)[0] ?? linkInput.trim()
    if (!token) return
    setSaveError(null)
    try {
      await saveShareFn({ data: { token } })
      setLinkInput('')
      refresh()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Не получилось сохранить')
    }
  }

  async function copyShare(id: string, token: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/s/${token}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-3xl font-semibold">Друзья</h1>
        <span className="font-mono text-xs text-muted-foreground">
          {saved.length}{' '}
          {plural(
            saved.length,
            'сохранённая полка',
            'сохранённые полки',
            'сохранённых полок',
          )}{' '}
          · {mine.length}{' '}
          {plural(mine.length, 'моя ссылка', 'мои ссылки', 'моих ссылок')}
        </span>
        <div className="ml-auto">
          <InvitePolkaDialog />
        </div>
      </div>

      <nav className="mt-4 mb-5 flex gap-1 border-b">
        {(
          [
            ['saved', `Полки друзей · ${saved.length}`],
            ['mine', `Мои ссылки · ${mine.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={
              tab === key
                ? '-mb-px border-b-2 border-primary px-3.5 py-2 text-sm font-semibold text-accent-foreground'
                : 'px-3.5 py-2 text-sm font-semibold text-muted-foreground'
            }
            onClick={() => void navigate({ search: { tab: key } })}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'saved' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map((s) => (
              <Card key={s.shareId}>
                <CardContent className="grid content-start gap-2 pt-5">
                  <span className="text-[12.5px] font-semibold text-stamp">
                    у {s.ownerNames}
                  </span>
                  <b className="text-lg leading-tight">{s.title}</b>
                  <span className="text-[12.5px] text-muted-foreground">
                    {s.bookCount}{' '}
                    {plural(s.bookCount, 'книга', 'книги', 'книг')} · сохранена{' '}
                    {dateRu(s.savedAt)}
                  </span>
                  <div className="mt-1 flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <a href={`/s/${s.token}`}>Открыть</a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() =>
                        void removeSavedShareFn({
                          data: { shareId: s.shareId },
                        }).then(refresh)
                      }
                    >
                      Убрать
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {saved.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Пока пусто. Когда друг пришлёт ссылку на свою полку — откройте
                её и нажмите «Сохранить себе», либо вставьте ссылку сюда.
              </CardContent>
            </Card>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2.5 rounded-lg border bg-card px-4 py-3.5">
            <b className="text-[13.5px]">Добавить полку друга:</b>
            <Input
              className="min-w-56 flex-1 font-mono text-xs"
              placeholder="https://…/s/токен"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
            />
            <Button
              onClick={() => void saveByLink()}
              disabled={!linkInput.trim()}
            >
              Сохранить себе
            </Button>
            {saveError && (
              <span className="text-[12.5px] text-destructive">
                {saveError}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-2.5">
            {mine.map((s) => (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap items-center gap-3.5 py-3.5">
                  <div className="min-w-44 flex-1">
                    <b>{s.targetName}</b>{' '}
                    <span className="text-[12.5px] text-muted-foreground">
                      (
                      {s.scope === 'library'
                        ? 'вся библиотека'
                        : `полка · ${s.libraryName}`}
                      )
                    </span>
                    <span className="block font-mono text-[11.5px] text-muted-foreground">
                      /s/{s.token.slice(0, 10)}… · создана {dateRu(s.createdAt)}
                    </span>
                  </div>
                  {s.pendingRequests > 0 && (
                    <span className="rounded-full bg-stamp px-2 py-0.5 text-xs font-semibold text-white">
                      {s.pendingRequests}{' '}
                      {plural(s.pendingRequests, 'заявка', 'заявки', 'заявок')}
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copyShare(s.id, s.token)}
                  >
                    {copiedId === s.id ? 'Скопировано' : 'Копировать'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() =>
                      void revokeShareFn({ data: { shareId: s.id } }).then(
                        refresh,
                      )
                    }
                  >
                    Отозвать
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          {mine.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                Ссылок пока нет. Создайте — и у друзей появится витрина вашей
                библиотеки с кнопкой «Хочу почитать».
              </CardContent>
            </Card>
          )}
          <p className="mt-3 text-[13px] text-muted-foreground">
            Отзыв ссылки сразу закрывает витрину и убирает её из «Друзей» у
            всех, кто сохранил.
          </p>
          <div className="mt-4">
            <NewShareDialog onCreated={refresh} />
          </div>
        </>
      )}
    </div>
  )
}

function NewShareDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [libraries, setLibraries] = useState<
    Array<{ id: string; name: string }>
  >([])
  const [shelves, setShelves] = useState<Array<{ id: string; name: string }>>(
    [],
  )
  const [libraryId, setLibraryId] = useState('')
  const [shelfId, setShelfId] = useState('') // '' = вся библиотека
  const [busy, setBusy] = useState(false)

  async function load() {
    const libs = await listMyLibrariesFn()
    setLibraries(libs)
    const first = libs[0]?.id ?? ''
    setLibraryId(first)
    if (first) {
      const o = await getLibraryOverviewFn({ data: { libraryId: first } })
      setShelves(o.shelves.map((s) => ({ id: s.id, name: s.name })))
    }
  }

  async function onLibraryChange(id: string) {
    setLibraryId(id)
    setShelfId('')
    const o = await getLibraryOverviewFn({ data: { libraryId: id } })
    setShelves(o.shelves.map((s) => ({ id: s.id, name: s.name })))
  }

  async function submit() {
    setBusy(true)
    try {
      await createShareFn({
        data: shelfId
          ? { scope: 'shelf', shelfId }
          : { scope: 'library', libraryId },
      })
      setOpen(false)
      onCreated()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void load()
      }}
    >
      <DialogTrigger asChild>
        <Button>Создать ссылку</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Что открываем друзьям?</DialogTitle>
          <DialogDescription>
            Витрина показывает только сами книги: без заметок, оценок и имён
            должников.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Библиотека</Label>
            <select
              className="h-10 rounded-lg border bg-card px-3 text-sm"
              value={libraryId}
              onChange={(e) => void onLibraryChange(e.target.value)}
            >
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>Полка</Label>
            <select
              className="h-10 rounded-lg border bg-card px-3 text-sm"
              value={shelfId}
              onChange={(e) => setShelfId(e.target.value)}
            >
              <option value="">Вся библиотека</option>
              {shelves.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={busy || !libraryId}>
            Создать ссылку
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <Dialog onOpenChange={(o) => !o && setLink(null)}>
      <DialogTrigger asChild>
        <Button variant="outline">Пригласить в Полку</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Приглашение зарегистрироваться</DialogTitle>
          <DialogDescription>
            Регистрация в Полке — только по таким ссылкам. Ссылка одноразовая,
            живёт 7 дней. Чтобы человек попал в вашу библиотеку совладельцем —
            после регистрации пришлите ему ещё инвайт из шапки библиотеки.
          </DialogDescription>
        </DialogHeader>
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
          <DialogFooter>
            <Button onClick={() => void generate()} disabled={busy}>
              Создать ссылку
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
