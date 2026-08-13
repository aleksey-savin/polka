import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import { Logo } from '@/components/layout/Logo'
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
import { plural } from '@/lib/plural'
import {
  createBorrowRequestFn,
  getShareViewFn,
  saveShareFn,
} from '@/server/shares'
import { getSession } from '@/server/session'
import { spineFor } from '@/services/spine'
import type { PublicBook } from '@/services/shares'

export const Route = createFileRoute('/s/$token')({
  loader: async ({ params }) => {
    const [view, session] = await Promise.all([
      getShareViewFn({ data: { token: params.token } }),
      getSession(),
    ])
    return { view, me: session?.user ?? null }
  },
  errorComponent: () => (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="grid justify-items-center gap-3">
        <Logo />
        <h1 className="text-2xl font-semibold">Ссылка не действует</h1>
        <p className="max-w-sm text-muted-foreground">
          Владелец отозвал её или адрес неполный. Попросите новую ссылку.
        </p>
      </div>
    </main>
  ),
  component: SharePage,
})

function SharePage() {
  const { view, me } = Route.useLoaderData()
  const router = useRouter()
  const [asking, setAsking] = useState<PublicBook | null>(null)
  const [saved, setSaved] = useState(false)
  const [savedError, setSavedError] = useState<string | null>(null)

  async function saveToFriends() {
    setSavedError(null)
    try {
      await saveShareFn({ data: { token: view.token } })
      setSaved(true)
    } catch (e) {
      setSavedError(e instanceof Error ? e.message : 'Не получилось сохранить')
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-b bg-card px-4 py-3">
        <Logo />
        <span className="text-[13px] text-muted-foreground">
          гостевой просмотр по ссылке
        </span>
        {me &&
          (saved ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => router.navigate({ to: '/friends' })}
            >
              Сохранено — в «Друзьях» ✓
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void saveToFriends()}
            >
              Сохранить себе
            </Button>
          ))}
        {savedError && (
          <span className="text-[12px] text-destructive">{savedError}</span>
        )}
      </header>

      <main className="mx-auto max-w-[1080px] px-4 py-7 md:px-7">
        <div className="text-center">
          <h1 className="text-[30px] font-semibold">{view.title}</h1>
          <p className="mt-1 text-muted-foreground">
            {view.scope === 'shelf' ? 'Полка' : 'Библиотека'} —{' '}
            {view.ownerNames} · {view.bookCount}{' '}
            {plural(view.bookCount, 'книга', 'книги', 'книг')}
            {view.allowRequests && ' · можно попроситься почитать'}
          </p>
        </div>

        {view.sections.map((section) => (
          <section key={section.name} className="mt-9">
            {view.sections.length > 1 && (
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-lg font-semibold">{section.name}</h2>
                <div
                  aria-hidden
                  className="h-2 flex-1 rounded-[2px]"
                  style={{
                    background: `linear-gradient(180deg, color-mix(in oklab, ${section.accentColor ?? section.tint.color} 88%, #fff), color-mix(in oklab, ${section.accentColor ?? section.tint.color} 82%, #232B38))`,
                  }}
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {section.books.map((b) => {
                const look = spineFor(b.title, b.pages)
                return (
                  <div
                    key={b.id}
                    className="relative grid content-start gap-2 rounded-lg border bg-card p-3 shadow-xs"
                  >
                    {b.onLoan && (
                      <span className="absolute -top-1.5 -right-1.5 z-[1] inline-block -rotate-3 rounded border-2 border-stamp bg-white/80 px-1.5 font-mono text-[9.5px] font-medium tracking-widest text-stamp uppercase">
                        На руках
                      </span>
                    )}
                    {b.hasCover ? (
                      <img
                        src={`/api/covers/${b.id}`}
                        alt=""
                        className="aspect-[7/10] w-full rounded-[4px] object-cover shadow-sm"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        aria-hidden
                        className="grid aspect-[7/10] w-full content-end rounded-[4px] p-2.5 shadow-sm"
                        style={{
                          background: `linear-gradient(160deg, ${look.color}, color-mix(in oklab, ${look.color} 72%, #232B38))`,
                        }}
                      >
                        <span
                          className="font-display text-sm leading-tight font-bold"
                          style={{ color: 'rgba(35,43,56,.9)' }}
                        >
                          {b.title}
                        </span>
                      </div>
                    )}
                    <b className="text-sm leading-snug">{b.title}</b>
                    <span className="text-xs text-muted-foreground">
                      {b.authors}
                      {b.year && ` · ${b.year}`}
                    </span>
                    {view.allowRequests &&
                      (b.onLoan ? (
                        <span className="pt-1 text-center text-xs text-muted-foreground">
                          Сейчас у читателя — загляните позже
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAsking(b)}
                        >
                          Хочу почитать
                        </Button>
                      ))}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </main>

      <AskDialog
        token={view.token}
        book={asking}
        meName={me?.name ?? null}
        onClose={() => setAsking(null)}
      />
    </div>
  )
}

function AskDialog({
  token,
  book,
  meName,
  onClose,
}: {
  token: string
  book: PublicBook | null
  meName: string | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveName = meName ?? name

  async function submit() {
    if (!book || !effectiveName.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createBorrowRequestFn({
        data: {
          token,
          bookId: book.id,
          guestName: effectiveName.trim(),
          note: note || undefined,
        },
      })
      setDone(true)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Не получилось отправить заявку',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={book !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
          setDone(false)
          setNote('')
          setError(null)
        }
      }}
    >
      <DrawerContent>
        {done ? (
          <>
            <DrawerHeader>
              <DrawerTitle>Заявка отправлена</DrawerTitle>
              <DrawerDescription>
                Хозяева увидят её и решат, когда передать книгу.
              </DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <Button onClick={onClose}>Хорошо</Button>
            </DrawerFooter>
          </>
        ) : (
          <>
            <DrawerHeader>
              <DrawerTitle>Хочу почитать «{book?.title}»</DrawerTitle>
              <DrawerDescription>
                Хозяева увидят заявку и ответят при встрече.
              </DrawerDescription>
            </DrawerHeader>
            <div className="grid gap-3">
              {!meName && (
                <div className="grid gap-1.5">
                  <Label htmlFor="ask-name">Как вас зовут</Label>
                  <Input
                    id="ask-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="ask-note">
                  Записка{' '}
                  <span className="font-normal text-muted-foreground">
                    (не обязательно)
                  </span>
                </Label>
                <Textarea
                  id="ask-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Заберу в четверг после работы"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DrawerFooter>
              <Button
                onClick={() => void submit()}
                disabled={busy || !effectiveName.trim()}
              >
                Отправить заявку
              </Button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}
