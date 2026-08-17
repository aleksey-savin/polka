import { useEffect, useRef, useState } from 'react'

import { StarRating } from '@/components/book/StarRating'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { upsertPersonalFn } from '@/server/personal'
import type { BookPersonalView, ReadingStatus } from '@/services/personal'

const READING_LABEL: Record<ReadingStatus, string> = {
  unread: 'Не читал',
  reading: 'Читаю',
  read: 'Прочитал',
  abandoned: 'Бросил',
}

function toDateInput(value: Date | string | null): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  return d.toISOString().slice(0, 10)
}

/** Мой личный слой книги + слои остальных участников (read-only). */
export function PersonalPanel({
  bookId,
  personal,
  onChanged,
}: {
  bookId: string
  personal: Array<BookPersonalView>
  onChanged: () => void
}) {
  const mine = personal.find((p) => p.isMe)
  const others = personal.filter((p) => !p.isMe)

  const [review, setReview] = useState(mine?.review ?? '')
  const [notes, setNotes] = useState(mine?.notes ?? '')
  const [readAt, setReadAt] = useState(toDateInput(mine?.readAt ?? null))
  const [savingText, setSavingText] = useState(false)
  const textDirty =
    review !== (mine?.review ?? '') ||
    notes !== (mine?.notes ?? '') ||
    readAt !== toDateInput(mine?.readAt ?? null)
  const busyRef = useRef(false)

  useEffect(() => {
    setReview(mine?.review ?? '')
    setNotes(mine?.notes ?? '')
    setReadAt(toDateInput(mine?.readAt ?? null))
  }, [mine?.review, mine?.notes, mine?.readAt])

  async function quickSave(
    patch: Parameters<typeof upsertPersonalFn>[0]['data'],
  ) {
    if (busyRef.current) return
    busyRef.current = true
    try {
      await upsertPersonalFn({ data: patch })
      onChanged()
    } finally {
      busyRef.current = false
    }
  }

  async function saveTexts() {
    setSavingText(true)
    try {
      await upsertPersonalFn({
        data: {
          bookId,
          review: review || null,
          notes: notes || null,
          readAt: readAt || null,
        },
      })
      onChanged()
    } finally {
      setSavingText(false)
    }
  }

  const status = mine?.readingStatus ?? 'unread'

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-4 pt-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="grid w-full gap-1 sm:w-auto">
              <span className="text-[13px] font-semibold text-muted-foreground">
                Моя оценка
              </span>
              <StarRating
                value={mine?.rating ?? null}
                onChange={(rating) => void quickSave({ bookId, rating })}
              />
              <span className="flex justify-between px-1 text-[11.5px] text-muted-foreground">
                <span>не пошло</span>
                <span>отлично</span>
              </span>
            </div>
            <div className="grid w-full gap-1 sm:w-auto">
              <span className="text-[13px] font-semibold text-muted-foreground">
                Чтение
              </span>
              <div className="flex w-full rounded-full border bg-background p-0.5 sm:w-auto">
                {(Object.keys(READING_LABEL) as Array<ReadingStatus>).map(
                  (s) => (
                    <button
                      key={s}
                      type="button"
                      className={
                        s === status
                          ? 'min-w-0 flex-1 truncate rounded-full bg-foreground px-1.5 py-2 text-center text-[12.5px] font-semibold text-background sm:flex-none sm:px-3 sm:py-1'
                          : 'min-w-0 flex-1 truncate rounded-full px-1.5 py-2 text-center text-[12.5px] font-medium text-muted-foreground sm:flex-none sm:px-3 sm:py-1'
                      }
                      onClick={() =>
                        void quickSave({ bookId, readingStatus: s })
                      }
                    >
                      {READING_LABEL[s]}
                    </button>
                  ),
                )}
              </div>
            </div>
            {status === 'read' && (
              <div className="grid gap-1">
                <label
                  htmlFor="read-at"
                  className="text-[13px] font-semibold text-muted-foreground"
                >
                  Когда прочитал
                </label>
                <input
                  id="read-at"
                  type="date"
                  className="h-8 rounded-lg border bg-card px-2 text-[13px]"
                  value={readAt}
                  onChange={(e) => setReadAt(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <label
              htmlFor="my-review"
              className="text-[13px] font-semibold text-muted-foreground"
            >
              Моя рецензия
            </label>
            <Textarea
              id="my-review"
              rows={3}
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder="Что думаете о книге?"
            />
          </div>

          <div className="grid gap-1.5">
            <label
              htmlFor="my-notes"
              className="text-[13px] font-semibold text-muted-foreground"
            >
              Заметки <span className="font-normal">(видны только вам)</span>
            </label>
            <Textarea
              id="my-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Экземпляр с автографом, куплена там-то…"
              className="border-dashed border-[#E2D3A8] bg-[#FDF9EC]"
            />
          </div>

          {textDirty && (
            <div>
              <Button
                size="sm"
                onClick={() => void saveTexts()}
                disabled={savingText}
              >
                Сохранить
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {others.length > 0 && (
        <Card>
          <CardContent className="grid gap-3 pt-5">
            {others.map((p) => (
              <div key={p.userId} className="grid gap-1">
                <div className="flex items-center gap-2.5">
                  <b className="text-sm">{p.userName}</b>
                  <StarRating value={p.rating} readOnly size="sm" />
                  <span className="text-xs text-muted-foreground">
                    {READING_LABEL[p.readingStatus]}
                    {p.readAt &&
                      ` · ${new Date(p.readAt).toLocaleDateString('ru-RU')}`}
                  </span>
                </div>
                {p.review && (
                  <p className="text-sm leading-relaxed">{p.review}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
