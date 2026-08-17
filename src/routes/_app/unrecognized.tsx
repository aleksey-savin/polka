import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { dateHuman } from '@/lib/dates'
import { plural } from '@/lib/plural'
import { applyRecognitionFn, recognizeBookFn } from '@/server/aiRecognize'
import { aiReadyFn } from '@/server/ai'
import { myAccountFn } from '@/server/moderation'
import { listUnrecognizedFn, retryLookupFn } from '@/server/unrecognized'
import type { RecognizeResult } from '@/services/aiRecognize'

/** Болванки из сканера: ISBN есть, названия нет — здесь их добивают (M18, M25). */
export const Route = createFileRoute('/_app/unrecognized')({
  loader: async () => {
    const [rows, ai, account] = await Promise.all([
      listUnrecognizedFn(),
      aiReadyFn(),
      myAccountFn(),
    ])
    return { rows, ai, isAdmin: account.role === 'admin' }
  },
  component: UnrecognizedPage,
})

const VERDICT = {
  confirmed: {
    mark: '✓',
    title: 'Подтверждено',
    text: 'Издание с этим номером нашлось в каталоге — данные берём оттуда.',
    tone: 'border-primary/45 bg-accent/40 text-accent-foreground',
  },
  'work-only': {
    mark: '≈',
    title: 'Книга такая есть, издание — не то',
    text: 'Произведение нашлось, но издания с этим номером в каталоге нет.',
    tone: 'border-[color-mix(in_oklab,var(--stamp)_35%,transparent)] bg-[color-mix(in_oklab,var(--stamp)_7%,transparent)] text-foreground',
  },
  unconfirmed: {
    mark: '!',
    title: 'Не подтверждено',
    text: 'Каталог молчит. Это предположение модели — сверьте с книгой в руках.',
    tone: 'border-destructive/40 bg-destructive/5 text-foreground',
  },
  unknown: {
    mark: '—',
    title: 'Модель не знает этого номера',
    text: 'Так честнее, чем красивая выдумка. Остаётся заполнить вручную.',
    tone: 'bg-card text-muted-foreground',
  },
} as const

function UnrecognizedPage() {
  const { rows, ai, isAdmin } = Route.useLoaderData()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [found, setFound] = useState<Record<string, RecognizeResult>>({})
  const [left, setLeft] = useState<number | null>(null)
  const [stop, setStop] = useState(false)

  async function retry(bookIds: Array<string>, key: string) {
    setBusyId(key)
    try {
      const { resolved, missed } = await retryLookupFn({ data: { bookIds } })
      if (resolved > 0) {
        toast.success(
          `Нашлось ${resolved} ${plural(resolved, 'книга', 'книги', 'книг')}` +
            (missed > 0 ? `, осталось ${missed}` : ''),
        )
      } else {
        toast.error('Источники снова ничего не знают об этих номерах')
      }
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  async function recognize(bookId: string) {
    setBusyId(bookId)
    try {
      const { result, usage } = await recognizeBookFn({ data: { bookId } })
      setFound((f) => ({ ...f, [bookId]: result }))
      setLeft(usage.left)
      return result
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
      return null
    } finally {
      setBusyId(null)
    }
  }

  /** Пачкой: по одной, чтобы упереться в лимит без потерь. */
  async function recognizeAll() {
    setStop(false)
    const queue = rows.filter((r) => r.isbn13 && !found[r.id])
    for (const row of queue) {
      if (stop) break
      const result = await recognize(row.id)
      if (!result) break
    }
  }

  async function apply(bookId: string) {
    setBusyId(bookId)
    try {
      await applyRecognitionFn({ data: { bookId } })
      toast.success('Карточка заполнена — модератор проверит')
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <p className="mb-4 truncate text-[13px] text-muted-foreground">
        <Link to="/add" className="hover:text-foreground">
          Добавить
        </Link>{' '}
        / Не распознано
      </p>

      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-[25px] leading-tight font-semibold">
          Не распознано
        </h1>
        {rows.length > 0 && (
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {rows.length}{' '}
            {plural(rows.length, 'книга ждёт', 'книги ждут', 'книг ждут')}{' '}
            названия
          </span>
        )}
        {rows.length > 0 && (
          <Button
            className="ml-auto"
            loading={busyId === 'all'}
            onClick={() =>
              void retry(
                rows.map((r) => r.id),
                'all',
              )
            }
          >
            Проверить все
          </Button>
        )}
      </div>

      {rows.length > 0 && !ai && isAdmin && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-dashed px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Разбор с ИИ не подключён</p>
            <p className="text-[12.5px] text-muted-foreground">
              Нужны ключ, каталог и модель — и включённый тумблер в настройках.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/service/ai">Настроить</Link>
          </Button>
        </div>
      )}

      {rows.length > 0 && ai && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Разобрать с ИИ</p>
            <p className="text-[12.5px] text-muted-foreground">
              Сначала эталон и источники, модель — последней.
              {left !== null && ` Осталось запросов сегодня: ${left}.`}
            </p>
          </div>
          {busyId ? (
            <Button variant="outline" onClick={() => setStop(true)}>
              Остановить
            </Button>
          ) : (
            <Button onClick={() => void recognizeAll()}>Разобрать все</Button>
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
            const verdict = result ? VERDICT[result.verdict] : null
            return (
              <div key={row.id} className="border-t py-2.5 first:border-t-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span
                    aria-hidden
                    className="h-14 w-[38px] flex-none rounded-[3px] bg-[repeating-linear-gradient(135deg,#E8E4DA,#E8E4DA_5px,#DDD8CC_5px,#DDD8CC_10px)] shadow-[inset_1.5px_0_0_rgba(255,255,255,.5)]"
                  />
                  <div className="min-w-[140px] flex-1">
                    <p className="font-mono text-sm font-medium">
                      {row.isbn13 ?? 'без ISBN'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <span className="mr-1.5 inline-block rounded-[3px] border-[1.5px] border-destructive/70 px-1 align-[1px] font-mono text-[9.5px] tracking-[0.07em] text-destructive uppercase">
                        не распознана
                      </span>
                      {row.publisher && `${row.publisher} · `}
                      {dateHuman(row.createdAt)}
                      {` · ${row.shelfName ?? 'Неразобранное'}`}
                    </p>
                  </div>
                  <div className="flex flex-none gap-2">
                    {ai && !result && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busyId === row.id}
                        disabled={!row.isbn13}
                        onClick={() => void recognize(row.id)}
                      >
                        Спросить ИИ
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-accent-foreground"
                      loading={busyId === `retry-${row.id}`}
                      disabled={!row.isbn13}
                      onClick={() => void retry([row.id], `retry-${row.id}`)}
                    >
                      Найти снова
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to="/books/$bookId/edit"
                        params={{ bookId: row.id }}
                      >
                        Заполнить
                      </Link>
                    </Button>
                  </div>
                </div>

                {result && verdict && (
                  <div className="mt-2 ml-[50px]">
                    {result.guess.title && (
                      <div className="mb-1.5">
                        <p className="text-[15px] leading-tight font-semibold">
                          {result.confirmed?.title ?? result.guess.title}
                        </p>
                        <p className="text-[13px] text-muted-foreground">
                          {result.confirmed?.authors || result.guess.authors}
                          {(result.confirmed?.year ?? result.guess.year) &&
                            ` · ${result.confirmed?.year ?? result.guess.year}`}
                          {result.cached && ' · из памяти, запрос не тратился'}
                        </p>
                      </div>
                    )}
                    <div
                      className={`rounded-xl border px-3 py-2 text-[12.5px] leading-snug ${verdict.tone}`}
                    >
                      <b>
                        {verdict.mark} {verdict.title}.
                      </b>{' '}
                      {verdict.text}
                    </div>
                    {result.sources.length > 0 && (
                      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                        {result.sources
                          .map((src) => `${src.name}: ${src.outcome}`)
                          .join(' · ')}
                        {result.askedModel
                          ? ' · спросили модель'
                          : ' · хватило источников'}
                      </p>
                    )}
                    {result.sources.some(
                      (src) => src.name === 'Google Books' && src.detail,
                    ) &&
                      isAdmin && (
                        <p className="mt-1 text-[11.5px]">
                          <Link
                            to="/service/sources"
                            className="underline underline-offset-2"
                          >
                            Проверить источники
                          </Link>{' '}
                          — без ключа Google молчит на любой номер.
                        </p>
                      )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.verdict !== 'unknown' && (
                        <Button
                          size="sm"
                          loading={busyId === row.id}
                          onClick={() => void apply(row.id)}
                        >
                          {result.verdict === 'confirmed'
                            ? 'Применить'
                            : 'Применить с пометкой'}
                        </Button>
                      )}
                      {result.workId && (
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            to="/works/$workId"
                            params={{ workId: result.workId }}
                          >
                            Выбрать издание
                          </Link>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setFound((f) => {
                            const next = { ...f }
                            delete next[row.id]
                            return next
                          })
                        }
                      >
                        Скрыть
                      </Button>
                    </div>
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
