import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { AiTabs, ServiceTabs } from '@/components/layout/ServiceTabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { dateHuman } from '@/lib/dates'
import {
  approveToReferenceFn,
  listAiReviewFn,
  rejectRecognitionFn,
} from '@/server/aiRecognize'
import type { ReviewRow } from '@/services/aiRecognize'

/**
 * Что ИИ применил и ждёт человека (M25). Эталон общий для всех, поэтому
 * записи туда заводит только модератор — руками, глядя на книгу.
 */
export const Route = createFileRoute('/_app/service_/ai-review')({
  loader: () => listAiReviewFn(),
  component: AiReviewPage,
})

const VERDICT_LABEL = {
  confirmed: 'подтверждено каталогом',
  'work-only': 'произведение есть, издание — нет',
  unconfirmed: 'только слова модели',
  unknown: 'модель не знала',
} as const

function AiReviewPage() {
  const rows = Route.useLoaderData()
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [edit, setEdit] = useState<ReviewRow | null>(null)
  const [form, setForm] = useState({ title: '', authors: '' })
  const [rejecting, setRejecting] = useState<ReviewRow | null>(null)
  const [note, setNote] = useState('')

  async function run(id: string, action: () => Promise<unknown>, done: string) {
    setBusyId(id)
    try {
      await action()
      toast.success(done)
      setEdit(null)
      setRejecting(null)
      setNote('')
      void router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-[640px] pb-6">
      <h1 className="mb-4 text-[25px] leading-tight font-semibold">Сервис</h1>
      <ServiceTabs isAdmin />
      <AiTabs pending={rows.length} />

      {rows.length === 0 ? (
        <p className="rounded-2xl border bg-card px-3.5 py-8 text-sm text-muted-foreground">
          Проверять нечего. Сюда попадает всё, что ИИ заполнил в карточках, —
          пока модератор не решит, годится ли это для общего эталона.
        </p>
      ) : (
        rows.map((row) => (
          <div key={row.id} className="border-t py-3 first:border-t-0">
            <div className="flex items-baseline justify-between gap-3">
              <Link
                to="/books/$bookId"
                params={{ bookId: row.bookId }}
                className="text-[15.5px] leading-tight font-semibold hover:underline"
              >
                {row.title}
              </Link>
              <span className="flex-none font-mono text-[11px] text-muted-foreground">
                {row.isbn13}
              </span>
            </div>
            <p className="text-[13px] text-muted-foreground">
              {row.authors || 'автор не указан'}
              {row.year && ` · ${row.year}`}
              {row.publisher && ` · ${row.publisher}`}
            </p>
            <p className="mt-1.5 text-[12.5px]">
              <span
                className={
                  row.verdict === 'confirmed'
                    ? 'font-semibold text-accent-foreground'
                    : 'font-semibold text-destructive'
                }
              >
                {VERDICT_LABEL[row.verdict]}
              </span>
              <span className="text-muted-foreground">
                {row.fromPrefix && ` · префикс: ${row.fromPrefix}`}
                {row.inReference && ' · уже в эталоне'}
                {row.appliedByName && ` · применил ${row.appliedByName}`}
                {` · ${dateHuman(row.appliedAt)}`}
              </span>
            </p>

            {edit?.id === row.id ? (
              <div className="mt-2 grid gap-2">
                <Input
                  className="h-11 rounded-xl text-[16px]"
                  value={form.title}
                  placeholder="Название"
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                />
                <Input
                  className="h-11 rounded-xl text-[16px]"
                  value={form.authors}
                  placeholder="Авторы"
                  onChange={(e) =>
                    setForm((f) => ({ ...f, authors: e.target.value }))
                  }
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={busyId === row.id}
                    onClick={() =>
                      void run(
                        row.id,
                        () =>
                          approveToReferenceFn({
                            data: {
                              suggestionId: row.id,
                              title: form.title,
                              authors: form.authors,
                            },
                          }),
                        'Поправлено и записано в эталон',
                      )
                    }
                  >
                    Сохранить и в эталон
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEdit(null)}
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            ) : rejecting?.id === row.id ? (
              <div className="mt-2 grid gap-2">
                <Input
                  className="h-11 rounded-xl text-[16px]"
                  value={note}
                  placeholder="Причина: чего не так с этой записью"
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={busyId === row.id}
                    onClick={() =>
                      void run(
                        row.id,
                        () =>
                          rejectRecognitionFn({
                            data: { suggestionId: row.id, note },
                          }),
                        'Отклонено, книга вернулась в нераспознанные',
                      )
                    }
                  >
                    Отклонить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRejecting(null)}
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  loading={busyId === row.id}
                  onClick={() =>
                    void run(
                      row.id,
                      () =>
                        approveToReferenceFn({
                          data: { suggestionId: row.id },
                        }),
                      'В эталоне — дальше этот номер найдётся без модели',
                    )
                  }
                >
                  В эталон
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEdit(row)
                    setForm({ title: row.title, authors: row.authors })
                  }}
                >
                  Поправить
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRejecting(row)}
                >
                  Отклонить
                </Button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
