import { useRef, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { dateHuman } from '@/lib/dates'
import { plural } from '@/lib/plural'
import {
  applyRecognitionFn,
  nextVariantFn,
  recognizeBookFn,
} from '@/server/aiRecognize'
import { myAccountFn } from '@/server/moderation'
import { listUnrecognizedFn } from '@/server/unrecognized'
import type { RecognizeResult } from '@/services/aiRecognize'

/**
 * Болванки из сканера: ISBN есть, названия нет (M18).
 *
 * Одна кнопка «Найти» проходит всю цепочку: эталон → FantLab · Google Books ·
 * OpenLibrary → поиск в интернете → модель. Человек решает: сохранить,
 * отклонить или заполнить руками.
 */
export const Route = createFileRoute('/_app/unrecognized')({
  loader: async () => {
    const [rows, account] = await Promise.all([
      listUnrecognizedFn(),
      myAccountFn(),
    ])
    return { rows, isAdmin: account.role === 'admin' }
  },
  component: UnrecognizedPage,
})

function UnrecognizedPage() {
  const { rows, isAdmin } = Route.useLoaderData()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [found, setFound] = useState<Record<string, RecognizeResult>>({})
  const [details, setDetails] = useState<Record<string, boolean>>({})
  const [chosenCover, setChosenCover] = useState<Record<string, string | null>>(
    {},
  )
  const [annOpen, setAnnOpen] = useState<Record<string, boolean>>({})
  const [batch, setBatch] = useState<{
    done: number
    total: number
    hits: number
  } | null>(null)
  const [stop, setStop] = useState(false)

  async function find(bookId: string) {
    setBusyId(bookId)
    try {
      const { result } = await recognizeBookFn({ data: { bookId } })
      setFound((f) => ({ ...f, [bookId]: result }))
      return result
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
      return null
    } finally {
      setBusyId(null)
    }
  }

  /** Пачкой — по одной, чтобы упереться в лимит без потерь. */
  async function findAll() {
    const queue = rows.filter((r) => r.isbn13 && !found[r.id])
    setStop(false)
    setBatch({ done: 0, total: queue.length, hits: 0 })
    let hits = 0
    for (const [index, row] of queue.entries()) {
      if (stop) break
      const result = await find(row.id)
      if (result?.guess.title) hits++
      setBatch({ done: index + 1, total: queue.length, hits })
      if (!result) break
    }
  }

  async function save(bookId: string) {
    setBusyId(`save:${bookId}`)
    try {
      await applyRecognitionFn({
        data: { bookId, coverUrl: chosenCover[bookId] ?? undefined },
      })
      toast.success('Сохранили')
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  /** «Искать дальше»: отвергнуть вариант и продолжить цепочку. */
  async function next(bookId: string) {
    setBusyId(`next:${bookId}`)
    try {
      const { result } = await nextVariantFn({ data: { bookId } })
      setFound((f) => ({ ...f, [bookId]: result }))
      if (!result.guess.title) {
        toast.info(
          result.exhausted
            ? 'Вариантов больше нет — остаётся ручная форма'
            : 'Дальше ничего не нашлось',
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  const saveable = Object.entries(found).filter(
    ([, result]) => result.verdict !== 'unknown' && result.guess.title,
  )

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <p className="mb-4 truncate text-[13px] text-muted-foreground">
        <Link to="/add" className="hover:text-foreground">
          Сканер
        </Link>
        {' / '}
        Не распознано
      </p>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[25px] leading-tight font-semibold">
          Не распознано
        </h1>
        {rows.length > 0 && (
          <Button
            className="flex-none"
            loading={batch !== null && batch.done < batch.total}
            onClick={() => void findAll()}
          >
            Найти всё
          </Button>
        )}
      </div>
      {rows.length > 0 && (
        <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">
          {rows.length}{' '}
          {plural(rows.length, 'книга ждёт', 'книги ждут', 'книг ждут')}{' '}
          названия
        </p>
      )}

      {batch && (
        <div className="mt-3 rounded-2xl border bg-card px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px] text-muted-foreground">
            <span>Ищу по одной</span>
            <span className="font-mono">
              {batch.done} из {batch.total}
            </span>
          </div>
          <div className="my-2 h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-primary transition-[width]"
              style={{
                width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-muted-foreground">
            <span>
              нашлось {batch.hits} · пусто {batch.done - batch.hits}
            </span>
            {batch.done < batch.total && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => setStop(true)}
              >
                Остановить
              </Button>
            )}
          </div>
          {saveable.length > 0 && (
            <Button
              className="mt-2 h-11 w-full"
              onClick={() => {
                void Promise.all(saveable.map(([id]) => save(id)))
              }}
            >
              Сохранить найденные ({saveable.length})
            </Button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="mt-5">
          <CardContent className="py-8 text-sm text-muted-foreground">
            Пусто — все отсканированные книги распознались. Если источники
            промолчат, книга сохранится по одному ISBN и попадёт сюда.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4">
          {rows.map((row) => {
            const result = found[row.id]
            const empty = result && !result.guess.title
            return (
              <div key={row.id} className="border-t py-3 first:border-t-0">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="h-14 w-[38px] flex-none rounded-[3px] bg-[repeating-linear-gradient(135deg,#E8E4DA,#E8E4DA_5px,#DDD8CC_5px,#DDD8CC_10px)] shadow-[inset_1.5px_0_0_rgba(255,255,255,.5)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-medium">
                      {row.isbn13 ?? 'без ISBN'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="mr-1.5 inline-block rounded-[3px] border-[1.5px] border-destructive/70 px-1 align-[1px] font-mono text-[9.5px] tracking-[0.07em] text-destructive uppercase">
                        не распознана
                      </span>
                      {row.publisher && `${row.publisher} · `}
                      {dateHuman(row.createdAt)}
                    </p>
                  </div>
                  {!result && (
                    <Button
                      className="flex-none"
                      loading={busyId === row.id}
                      disabled={!row.isbn13}
                      onClick={() => void find(row.id)}
                    >
                      Найти
                    </Button>
                  )}
                </div>

                {result && !empty && (
                  <div
                    className={`mt-2.5 rounded-2xl border p-3.5 shadow-[0_10px_26px_-20px_rgba(35,43,56,.5)] ${
                      result.verdict === 'confirmed'
                        ? 'border-primary/30 bg-card'
                        : 'border-destructive/25 bg-card'
                    }`}
                  >
                    <div className="flex gap-[15px]">
                      <CoverSwiper
                        urls={result.coverOptions}
                        fallback={result.confirmed?.coverUrl ?? null}
                        onChoose={(url) =>
                          setChosenCover((c) => ({ ...c, [row.id]: url }))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[16.5px] leading-[1.22] font-semibold text-balance">
                          {result.confirmed?.title ?? result.guess.title}
                        </p>
                        {(result.confirmed?.authors ||
                          result.guess.authors) && (
                          <p className="mt-0.5 text-[13.5px] text-muted-foreground">
                            {result.confirmed?.authors || result.guess.authors}
                          </p>
                        )}
                        <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">
                          {[
                            result.confirmed?.publisher ??
                              result.guess.publisher ??
                              result.fromPrefix,
                            result.confirmed?.year ?? result.guess.year,
                            result.confirmed?.pages
                              ? `${result.confirmed.pages} с.`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {result.confirmed?.annotation && (
                          <>
                            <p
                              className={`mt-1.5 text-[12.5px] leading-[1.5] text-muted-foreground ${
                                annOpen[row.id] ? '' : 'line-clamp-3'
                              }`}
                            >
                              {result.confirmed.annotation}
                            </p>
                            {result.confirmed.annotation.length > 160 && (
                              <button
                                type="button"
                                className="mt-0.5 text-[12px] text-accent-foreground"
                                onClick={() =>
                                  setAnnOpen((a) => ({
                                    ...a,
                                    [row.id]: !a[row.id],
                                  }))
                                }
                              >
                                {annOpen[row.id] ? 'свернуть' : 'развернуть'}
                              </button>
                            )}
                          </>
                        )}
                        <p className="mt-2.5">
                          {result.proof ? (
                            <a
                              href={result.proof.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-accent/40 py-[3.5px] pr-3 pl-2 text-[11.5px] text-accent-foreground"
                            >
                              <span aria-hidden>✓</span> ISBN совпал ·{' '}
                              <b className="font-semibold">
                                {hostOf(result.proof.url)}
                              </b>
                            </a>
                          ) : result.verdict === 'confirmed' ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-accent/40 py-[3.5px] pr-3 pl-2 text-[11.5px] text-accent-foreground">
                              <span aria-hidden>✓</span>
                              {result.via === 'sources'
                                ? 'нашлось в каталогах'
                                : 'подтверждено каталогом'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/5 py-[3.5px] pr-3 pl-2 text-[11.5px] text-destructive">
                              <span aria-hidden>!</span> не подтверждено —
                              сверьте с книгой
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {empty && (
                  <div className="mt-2.5 rounded-xl border px-3 py-2.5 text-[12.5px] text-muted-foreground">
                    <b className="text-foreground">
                      {result.exhausted
                        ? 'Вариантов больше нет.'
                        : 'Ничего не нашлось.'}
                    </b>{' '}
                    {result.exhausted
                      ? 'Все пути перепробованы — остаётся ручная форма.'
                      : 'Ни в каталогах, ни в поиске.'}
                    {row.publisher && ` Издательство: ${row.publisher}.`}
                  </div>
                )}

                {result && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {!empty && (
                      <>
                        <Button
                          variant={
                            result.verdict === 'confirmed'
                              ? 'default'
                              : 'outline'
                          }
                          loading={busyId === `save:${row.id}`}
                          onClick={() => void save(row.id)}
                        >
                          Сохранить
                        </Button>
                        <Button
                          variant="outline"
                          loading={busyId === `next:${row.id}`}
                          onClick={() => void next(row.id)}
                        >
                          Искать дальше
                        </Button>
                      </>
                    )}
                    {empty && (
                      <Button asChild>
                        <Link
                          to="/books/$bookId/edit"
                          params={{ bookId: row.id }}
                        >
                          Заполнить руками
                        </Link>
                      </Button>
                    )}
                    <button
                      type="button"
                      className="ml-auto text-[12.5px] text-muted-foreground underline underline-offset-2"
                      onClick={() =>
                        setDetails((d) => ({ ...d, [row.id]: !d[row.id] }))
                      }
                    >
                      {details[row.id] ? 'Скрыть' : 'Подробнее'}
                    </button>
                  </div>
                )}

                {result && details[row.id] && (
                  <div className="mt-2 text-[11.5px] text-muted-foreground">
                    {result.sources.length > 0 && (
                      <p>
                        {result.sources
                          .map((src) => `${src.name}: ${src.outcome}`)
                          .join(' · ')}
                        {result.cached && ' · из памяти'}
                      </p>
                    )}
                    <p className="mt-1">
                      {!empty && (
                        <>
                          <Link
                            to="/books/$bookId/edit"
                            params={{ bookId: row.id }}
                            className="underline underline-offset-2"
                          >
                            заполнить руками
                          </Link>
                          {isAdmin && ' · '}
                        </>
                      )}
                      {isAdmin && (
                        <Link
                          to="/service/sources"
                          className="underline underline-offset-2"
                        >
                          настройки источников
                        </Link>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Свайп обложек: обычный горизонтальный scroll со snap, сохраняется видимая.
 * Битые ссылки выпадают по onError — «либо картинка грузится, либо её нет».
 */
function CoverSwiper({
  urls,
  fallback,
  onChoose,
}: {
  urls: Array<string>
  fallback: string | null
  onChoose: (url: string | null) => void
}) {
  const all = urls.length > 0 ? urls : fallback ? [fallback] : []
  const [dead, setDead] = useState<Record<string, boolean>>({})
  const [index, setIndex] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const alive = all.filter((u) => !dead[u])

  function onScroll() {
    const el = scroller.current
    if (!el) return
    const i = Math.min(
      alive.length - 1,
      Math.max(0, Math.round(el.scrollLeft / el.clientWidth)),
    )
    if (i !== index) {
      setIndex(i)
      onChoose(alive[i] ?? null)
    }
  }

  if (alive.length === 0) {
    return (
      <span
        aria-hidden
        className="aspect-[7/10] w-[96px] flex-none rounded-[5px] bg-patina-old/40 shadow-[inset_3px_0_0_rgba(255,255,255,.25)]"
      />
    )
  }

  return (
    <div className="w-[96px] flex-none">
      <div className="relative">
        <div
          ref={scroller}
          className="flex snap-x snap-mandatory overflow-x-auto rounded-[5px] shadow-[inset_3px_0_0_rgba(255,255,255,.25),0_10px_20px_-10px_rgba(35,43,56,.55)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={onScroll}
        >
          {alive.map((url) => (
            <img
              key={url}
              src={url}
              alt=""
              className="aspect-[7/10] w-[96px] flex-none snap-center object-cover"
              onError={() => {
                setDead((d) => ({ ...d, [url]: true }))
                onChoose(alive.filter((u) => u !== url)[0] ?? null)
              }}
            />
          ))}
        </div>
        {alive.length > 1 && (
          <span className="absolute top-1.5 right-1.5 rounded-full bg-foreground/70 px-1.5 py-0.5 font-mono text-[10px] text-background">
            {index + 1} из {alive.length}
          </span>
        )}
        <span
          aria-hidden
          className="absolute -inset-x-2 -bottom-[7px] h-1 rounded-full bg-[linear-gradient(#E3D3AE,#CBB686)]"
        />
      </div>
      {alive.length > 1 && (
        <div className="mt-3 flex justify-center gap-[5px]" aria-hidden>
          {alive.map((url, i) => (
            <i
              key={url}
              className={`size-[5px] rounded-full ${
                i === index ? 'bg-muted-foreground' : 'bg-border'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Домен без www — им и подписываем ссылку-доказательство. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
