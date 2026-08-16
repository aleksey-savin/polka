import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { setPrefsFn } from '@/server/prefs'

/**
 * Выбор при «Пропустить» (M19): раньше книга молча уезжала в «Не распознано»,
 * и было непонятно, что случилось. Спрашиваем один раз и, если попросят,
 * запоминаем ответ в настройках профиля.
 */

const OPTIONS: Array<{ value: 'save-isbn' | 'discard'; title: string; sub: string }> = [
  {
    value: 'save-isbn',
    title: 'Сохранить по ISBN',
    sub: 'Книга попадёт в «Не распознано» — название добавите потом, из дома.',
  },
  {
    value: 'discard',
    title: 'Не сохранять',
    sub: 'Просто идём дальше. Книга нигде не останется — сканировать заново.',
  },
]

export function SkipChoiceSheet({
  open,
  isbn,
  busy,
  onClose,
  onChoose,
}: {
  open: boolean
  isbn?: string
  busy?: boolean
  onClose: () => void
  onChoose: (action: 'save-isbn' | 'discard', remember: boolean) => void
}) {
  const [choice, setChoice] = useState<'save-isbn' | 'discard'>('save-isbn')
  const [remember, setRemember] = useState(false)

  async function apply() {
    if (remember) {
      try {
        await setPrefsFn({ data: { skipAction: choice } })
      } catch {
        // настройка не сохранилась — на текущее действие это не влияет
      }
    }
    onChoose(choice, remember)
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[86dvh]">
        <DrawerHeader className="pt-1">
          <DrawerTitle>Пропустить эту книгу</DrawerTitle>
          <DrawerDescription>
            {isbn ? (
              <>
                ISBN <span className="font-mono">{isbn}</span> — источники
                ничего не знают
              </>
            ) : (
              'Источники ничего не знают об этой книге'
            )}
          </DrawerDescription>
        </DrawerHeader>

        <div className="grid gap-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`flex min-h-[52px] items-start gap-3 rounded-2xl border p-3 text-left ${
                choice === opt.value
                  ? 'border-primary/45 bg-accent/50'
                  : 'bg-card'
              }`}
              onClick={() => setChoice(opt.value)}
            >
              <span
                aria-hidden
                className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full border-[1.5px] ${
                  choice === opt.value ? 'border-primary' : 'border-border'
                }`}
              >
                {choice === opt.value && (
                  <span className="size-2.5 rounded-full bg-primary" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-semibold">
                  {opt.title}
                </span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {opt.sub}
                </span>
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="mt-3 flex items-center gap-2.5 text-left text-[13.5px]"
          onClick={() => setRemember((v) => !v)}
        >
          <span
            aria-hidden
            className={`grid size-[22px] flex-none place-items-center rounded-md border-[1.5px] text-[13px] ${
              remember
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-transparent'
            }`}
          >
            ✓
          </span>
          Запомнить выбор и больше не спрашивать
        </button>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Поведение всегда можно изменить в{' '}
          <Link to="/settings" className="underline">
            настройках
          </Link>{' '}
          — «Сканирование».
        </p>

        <DrawerFooter>
          <Button loading={busy} onClick={() => void apply()}>
            Продолжить
          </Button>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
