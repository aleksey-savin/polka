import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import {
  ArrowLeftRight,
  Ellipsis,
  Eye,
  EyeOff,
  Gift,
  Heart,
  ListPlus,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  TriangleAlert,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ReactNode } from 'react'
import type { Crumb } from '@/components/layout/Breadcrumbs'

import { AddToListButton } from '@/components/book/AddToListButton'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { currentOrigin, originCrumb, rememberLibrary } from '@/lib/origin'
import { ExpandableText } from '@/components/book/ExpandableText'
import { ListBadges } from '@/components/book/ListBadges'
import { MoveDialog } from '@/components/book/MoveDialog'
import { CycleRow, CycleSheet } from '@/components/book/CycleSheet'
import { SectionLabel } from '@/components/layout/SectionLabel'
import { PersonalPanel } from '@/components/book/PersonalPanel'
import { GiftDialog, LendDialog } from '@/components/book/status-dialogs'
import { Badge } from '@/components/ui/badge'
import { ActionMenu } from '@/components/ui/action-menu'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  deleteBookFn,
  getBookCardFn,
  markLostFn,
  restoreToLibraryFn,
  setBookHiddenFn,
} from '@/server/books'
import { dateHuman, dateRu, dateShort } from '@/lib/dates'
import {
  removeCoverFn,
  searchCoversFn,
  setCoverFromUrlFn,
  uploadCoverFn,
} from '@/server/covers'
import {
  aiMarkFn,
  applyProposalFn,
  dismissProposalFn,
  nextVariantFn,
  proposeForBookFn,
  revertRecognitionFn,
} from '@/server/aiRecognize'
import type { Proposal } from '@/services/aiRecognize'
import { bookCycleFn } from '@/server/cycles'
import { bookLoanHistoryFn, returnLoanFn } from '@/server/loans'
import { listBookPersonalFn } from '@/server/personal'
import { spineFor } from '@/services/spine'

export const Route = createFileRoute('/_app/books/$bookId')({
  loader: async ({ params }) => {
    const [book, personal, loans, cycle, aiMark] = await Promise.all([
      getBookCardFn({ data: { bookId: params.bookId } }),
      listBookPersonalFn({ data: { bookId: params.bookId } }),
      bookLoanHistoryFn({ data: { bookId: params.bookId } }),
      bookCycleFn({ data: { bookId: params.bookId } }),
      aiMarkFn({ data: { bookId: params.bookId } }),
    ])
    return { book, personal, loans, cycle, aiMark }
  },
  component: BookCardPage,
})

/** Откуда взялся вариант — та же подпись, что в разборе нераспознанных. */
const VIA_LABEL: Record<string, string> = {
  sources: 'Каталоги',
  'web-extract': 'Яндекс Поиск',
  'web-generative': 'Нейропоиск',
  model: 'Догадка модели',
}

const LANG_LABEL: Record<string, string> = {
  ru: 'русский',
  en: 'английский',
}

function BookCardPage() {
  const { book, personal, loans, cycle, aiMark } = Route.useLoaderData()
  const router = useRouter()
  const navigate = Route.useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [coverOpen, setCoverOpen] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [finding, setFinding] = useState<'fill' | 'replace' | null>(null)
  const [listsOpen, setListsOpen] = useState(false)
  const [covers, setCovers] = useState<Array<string> | null>(null)
  const [pickedCover, setPickedCover] = useState<string | null>(null)
  const [searchingCovers, setSearchingCovers] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [lendOpen, setLendOpen] = useState(false)
  const [giftOpen, setGiftOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [cycleOpen, setCycleOpen] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const refresh = () => void router.invalidate()

  // запоминаем библиотеку книги: следующий переход должен попасть в неё
  useEffect(() => {
    if (book.libraryId) rememberLibrary(book.libraryId)
  }, [book.libraryId])

  const placeCrumbs: Array<Crumb> = book.libraryId
    ? [
        {
          label: book.libraryName ?? 'Библиотека',
          to: '/libraries',
          search: { lib: book.libraryId },
        },
        book.shelfId
          ? {
              label: book.shelfName ?? 'Полка',
              to: '/shelves/$shelfId',
              params: { shelfId: book.shelfId },
            }
          : {
              label: 'Неразобранное',
              to: '/unsorted',
              search: { lib: book.libraryId },
            },
      ]
    : [{ label: 'Хочу', to: '/wishlist' }]

  // если пришли из списка (каталог, подборка, автор) — показываем и его
  const cameFrom = originCrumb()
  const crumbs: Array<Crumb> = [
    ...(cameFrom && !placeCrumbs.some((c) => c.to === cameFrom.to)
      ? [cameFrom]
      : []),
    ...placeCrumbs,
    { label: book.title },
  ]

  const look = spineFor(book.title, book.pages)
  const activeLoan = loans.find((l) => l.returnedAt === null) ?? null
  const canCirculate = book.status === 'in_library' && !activeLoan

  const stampLabel = activeLoan
    ? 'На руках'
    : book.status === 'gifted'
      ? 'Подарена'
      : book.status === 'lost'
        ? 'Потеряна'
        : book.status === 'wishlist'
          ? 'Хочу'
          : null
  const stampTone =
    book.status === 'lost'
      ? 'border-destructive text-destructive'
      : book.status === 'wishlist'
        ? 'border-accent-foreground text-accent-foreground'
        : 'border-stamp text-stamp'

  async function run(
    name: string,
    action: () => Promise<unknown>,
    done?: string,
  ) {
    setBusyAction(name)
    try {
      await action()
      if (done) toast.success(done)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setBusyAction(null)
    }
  }

  async function uploadCover(file: File) {
    setCoverBusy(true)
    try {
      const form = new FormData()
      form.set('bookId', book.id)
      form.set('file', file)
      await uploadCoverFn({ data: form })
      refresh()
    } finally {
      setCoverBusy(false)
    }
  }

  async function removeBook() {
    await deleteBookFn({ data: { bookId: book.id } })
    // возвращаем туда, откуда пришли: в каталог сваливать неправильно
    const back = currentOrigin() ?? {
      to: placeCrumbs[placeCrumbs.length - 1]?.to ?? '/books',
      params: placeCrumbs[placeCrumbs.length - 1]?.params,
      search: placeCrumbs[placeCrumbs.length - 1]?.search ?? {},
      label: '',
    }
    setDeleteOpen(false)
    await navigate({
      to: back.to as never,
      params: back.params as never,
      search: (back.search ?? {}) as never,
    })
  }

  /** Обе ветки идут одной цепочкой источников, отличается только запись. */
  async function findData(
    mode: 'fill' | 'replace',
    variantVia?: string,
    fresh = false,
  ) {
    setFinding(mode)
    try {
      const found = await proposeForBookFn({
        data: { bookId: book.id, mode, variantVia, fresh },
      })
      if (!found) {
        toast.info('Ничего не нашлось — заполните карточку руками')
        return
      }
      setProposal(found)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setFinding(null)
    }
  }

  /** Закрыть шторку: предложение снимаем, если оно вообще записывалось. */
  async function closeProposal() {
    const suggestionId = proposal?.suggestionId ?? null
    setProposal(null)
    if (suggestionId) await dismissProposalFn({ data: { suggestionId } })
  }

  /**
   * «Искать дальше»: сначала показываем уже найденные варианты, а когда они
   * кончились — отвергаем текущий путь и идём на следующую ступень цепочки.
   */
  async function searchFurther() {
    if (!proposal) return
    const mode = proposal.mode
    const next = proposal.variants.find(
      (v, index) => index !== proposal.variantIndex && v.via !== proposal.via,
    )
    const exhausted = proposal.exhausted
    await closeProposal()
    if (next) {
      await findData(mode, next.via)
      return
    }
    // пути кончились — забываем всё найденное и проходим цепочку заново
    if (exhausted) {
      await findData(mode, undefined, true)
      return
    }
    setFinding(mode)
    try {
      await nextVariantFn({ data: { bookId: book.id } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
      setFinding(null)
      return
    }
    setFinding(null)
    await findData(mode)
  }

  /** Обложки из Яндекс Картинок — тот же поиск, что в разборе находок. */
  async function findCovers() {
    setSearchingCovers(true)
    try {
      const found = await searchCoversFn({ data: { bookId: book.id } })
      setCovers(found)
      setPickedCover(found[0] ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setSearchingCovers(false)
    }
  }

  async function useFoundCover(url: string) {
    setCoverBusy(true)
    try {
      await setCoverFromUrlFn({ data: { bookId: book.id, url } })
      setCovers(null)
      setPickedCover(null)
      setCoverOpen(false)
      toast.success('Обложка поставлена')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не получилось')
    } finally {
      setCoverBusy(false)
    }
  }

  /** Поделиться книгой: то, что нужно при рекомендации. */
  async function share() {
    const text =
      [
        book.authors ? `${book.authors}. ${book.title}` : book.title,
        [book.publisher, book.year].filter(Boolean).join(', '),
      ]
        .filter(Boolean)
        .join(' (') + (book.publisher || book.year ? ')' : '')
    try {
      // системное меню есть не везде: на десктопе кладём в буфер
      const shareApi = (
        navigator as { share?: (data: ShareData) => Promise<void> }
      ).share
      if (shareApi) {
        await shareApi.call(navigator, { title: book.title, text })
        return
      }
      await navigator.clipboard.writeText(text)
      toast.success('Скопировано')
    } catch {
      // пользователь закрыл системное меню — это не ошибка
    }
  }

  const menuEntries: Array<ActionMenuEntry> = [
    {
      key: 'fill',
      label: finding === 'fill' ? 'Ищу…' : 'Найти недостающее',
      sub: 'заполнит пустое: обложку, описание, год',
      icon: <Sparkles />,
      onSelect: () => void findData('fill'),
    },
    {
      key: 'replace',
      label: finding === 'replace' ? 'Ищу…' : 'Заменить данные',
      sub: 'перезапишет карточку целиком',
      icon: <RefreshCw />,
      onSelect: () => void findData('replace'),
    },
    'separator',
    ...(book.status !== 'wishlist'
      ? ([
          {
            key: 'move',
            label: 'Переместить на полку',
            icon: <ArrowLeftRight />,
            onSelect: () => setMoveOpen(true),
          },
        ] satisfies Array<ActionMenuEntry>)
      : []),
    {
      key: 'lists',
      label: 'В список',
      sub: 'вишлист или подборка',
      icon: <ListPlus />,
      onSelect: () => setListsOpen(true),
    },
    ...(canCirculate
      ? ([
          'separator',
          {
            key: 'gift',
            label: 'Подарить',
            icon: <Gift />,
            onSelect: () => setGiftOpen(true),
          },
          {
            key: 'lost',
            label: 'Потерялась',
            icon: <TriangleAlert />,
            onSelect: () =>
              void run('lost', () => markLostFn({ data: { bookId: book.id } })),
          },
        ] satisfies Array<ActionMenuEntry>)
      : []),
    'separator',
    {
      key: 'hidden',
      label: book.hidden ? 'Не скрывать' : 'Скрыть',
      sub: book.hidden ? undefined : 'видна только владельцам библиотеки',
      icon: book.hidden ? <Eye /> : <EyeOff />,
      onSelect: () =>
        void run(
          'hidden',
          () =>
            setBookHiddenFn({
              data: { bookId: book.id, hidden: !book.hidden },
            }),
          book.hidden
            ? 'Больше не скрыта'
            : 'Скрыта — видна только владельцам библиотеки',
        ),
    },
    'separator',
    {
      key: 'delete',
      label: 'Удалить книгу',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => setDeleteOpen(true),
    },
  ]

  // окно из трёх соседей вокруг текущей книги — весь цикл живёт в шторке
  const neighbors = (() => {
    if (!cycle) return []
    const i = cycle.members.findIndex((m) => m.current)
    if (i < 0) return cycle.members.slice(0, 3)
    const from = Math.max(0, Math.min(i - 1, cycle.members.length - 3))
    return cycle.members.slice(from, from + 3)
  })()

  const editionParts: Array<ReactNode> = []
  if (book.publisher) editionParts.push(book.publisher)
  if (book.year)
    editionParts.push(
      <span key="year" className="font-mono text-[12.5px]">
        {book.year}
      </span>,
    )
  if (book.pages)
    editionParts.push(
      <span key="pages">
        <span className="font-mono text-[12.5px]">{book.pages}</span> с.
      </span>,
    )

  return (
    <div className="mx-auto max-w-[640px]">
      {aiMark && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--stamp)_35%,transparent)] bg-[color-mix(in_oklab,var(--stamp)_6%,transparent)] px-3 py-2 text-[12.5px]">
          <span className="font-semibold text-stamp">
            {aiMark.approved
              ? 'Заполнил ИИ · проверено'
              : aiMark.verdict === 'confirmed'
                ? 'Заполнил ИИ · подтверждено каталогом'
                : 'Заполнил ИИ · не проверено'}
          </span>
          <span className="text-muted-foreground">
            {dateHuman(aiMark.appliedAt)}
          </span>
          {!aiMark.approved && (
            <button
              type="button"
              className="ml-auto rounded-full border px-2.5 py-1 text-[12px] font-semibold"
              onClick={() => {
                void revertRecognitionFn({ data: { bookId: book.id } })
                  .then(() => {
                    toast.success('Откатили — книга снова в нераспознанных')
                    void router.invalidate()
                  })
                  .catch((e: unknown) =>
                    toast.error(
                      e instanceof Error ? e.message : 'Не получилось',
                    ),
                  )
              }}
            >
              Откатить
            </button>
          )}
        </div>
      )}
      <Breadcrumbs items={crumbs} />

      {/* ── Книга-объект ──
          Длинное название разъезжается на шесть строк и утаскивает обложку
          вниз, поэтому кегль подбираем по длине, а выравнивание по низу
          оставляем коротким: там книга красиво стоит рядом с текстом. */}
      <header
        className={`flex gap-[18px] ${
          book.title.length > 40 ? 'items-start' : 'items-end'
        }`}
      >
        <div className="relative w-[106px] flex-none">
          <button
            type="button"
            aria-label="Открыть обложку крупнее"
            className="block w-full cursor-zoom-in"
            onClick={() => setCoverOpen(true)}
          >
            {book.coverPath ? (
              <img
                src={`/api/covers/${book.id}?v=${book.coverPath}`}
                alt={`Обложка: ${book.title}`}
                className="aspect-[7/10] w-full rounded-[4px] object-cover shadow-[inset_3px_0_0_rgba(255,255,255,.22),0_8px_18px_-8px_rgba(35,43,56,.55)]"
              />
            ) : (
              <span
                aria-hidden
                className="grid aspect-[7/10] w-full content-end gap-1 overflow-hidden rounded-[4px] p-2.5 text-left"
                style={{
                  background: `linear-gradient(160deg, ${look.color}, color-mix(in oklab, ${look.color} 70%, #232B38))`,
                  boxShadow:
                    'inset 3px 0 0 rgba(255,255,255,.3), 0 8px 18px -8px rgba(35,43,56,.55)',
                }}
              >
                <span
                  className="text-[8.5px] leading-tight font-semibold"
                  style={{ color: 'rgba(35,43,56,.72)' }}
                >
                  {book.authors}
                </span>
                <span
                  className="font-display text-[12px] leading-tight font-bold"
                  style={{ color: 'rgba(35,43,56,.92)' }}
                >
                  {book.title}
                </span>
              </span>
            )}
          </button>
          {/* полочная линия под книгой */}
          <span
            aria-hidden
            className="absolute -inset-x-2 -bottom-[7px] h-1 rounded-full"
            style={{
              background:
                'linear-gradient(to right, var(--patina-old), var(--patina-fresh))',
              boxShadow: '0 3px 6px -2px rgba(35,43,56,.25)',
            }}
          />
          {stampLabel && (
            <span
              className={`absolute top-2.5 -right-3 rotate-[-7deg] rounded border-2 bg-background/85 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.16em] uppercase shadow-sm ${stampTone}`}
            >
              {stampLabel}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 pb-1">
          {cycle && (
            <button
              type="button"
              className="mb-2 flex max-w-full min-w-0 items-center gap-[7px] rounded-full border border-stamp/30 bg-card px-3 py-1 text-[12.5px] font-semibold text-stamp"
              onClick={() => setCycleOpen(true)}
            >
              <span
                aria-hidden
                className="flex flex-none items-end gap-[1.5px]"
              >
                <span className="h-[11px] w-[3.5px] rounded-[1px] bg-stamp/75" />
                <span className="h-[8px] w-[3.5px] rounded-[1px] bg-stamp/75" />
                <span className="h-[10px] w-[3.5px] rounded-[1px] bg-stamp/75" />
              </span>
              <span className="truncate">{cycle.title}</span>
              {cycle.currentPosition && (
                <span className="flex-none font-mono text-[11px] text-muted-foreground">
                  №{cycle.currentPosition} из {cycle.total}
                </span>
              )}
            </button>
          )}
          <h1
            className={`font-semibold tracking-[-0.015em] text-balance ${
              book.title.length > 70
                ? 'text-[18.5px] leading-[1.22] md:text-[21px]'
                : book.title.length > 40
                  ? 'text-[21px] leading-[1.18] md:text-[24px]'
                  : 'text-[25px] leading-[1.16] md:text-[28px]'
            }`}
          >
            {book.title}
          </h1>
          {book.authorLinks.length > 0 ? (
            <p className="mt-1 text-[15px] text-muted-foreground">
              {book.authorLinks.map((a, i) => (
                <Fragment key={a.id}>
                  {i > 0 && ', '}
                  <Link
                    to="/authors/$authorId"
                    params={{ authorId: a.id }}
                    className="hover:text-foreground hover:underline"
                  >
                    {a.name}
                  </Link>
                </Fragment>
              ))}
            </p>
          ) : (
            book.authors && (
              <p className="mt-1 text-[15px] text-muted-foreground">
                {book.authors}
              </p>
            )
          )}
          {editionParts.length > 0 && (
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {editionParts.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  {part}
                </Fragment>
              ))}
            </p>
          )}
          {book.hidden && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-muted-foreground/45 bg-card/60 px-2.5 py-0.5 text-[12.5px] font-medium text-muted-foreground">
              <EyeOff className="size-3.5" aria-hidden />
              Скрыта
            </span>
          )}
        </div>
      </header>

      {/* ── Лента обращения: где книга сейчас + главное действие ── */}
      {activeLoan ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-stamp/25 bg-stamp/5 p-3">
          <UserRound aria-hidden className="size-6 flex-none text-stamp" />
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px]">
              У <b className="font-semibold">«{activeLoan.borrowerName}»</b>
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              с{' '}
              <span className="font-mono text-xs">
                {dateHuman(activeLoan.lentAt)}
              </span>
              {activeLoan.dueAt && (
                <>
                  {' · вернуть к '}
                  <span className="font-mono text-xs">
                    {dateHuman(activeLoan.dueAt)}
                  </span>
                </>
              )}
            </p>
          </div>
          <Button
            className="h-11"
            loading={busyAction === 'return'}
            onClick={() =>
              void run(
                'return',
                () => returnLoanFn({ data: { loanId: activeLoan.loanId } }),
                'Вернули — книга снова дома',
              )
            }
          >
            Вернули
          </Button>
        </div>
      ) : book.status === 'in_library' ? (
        // «книга дома» — норма, а не новость: акцентную плашку бережём для
        // выданных и подаренных, здесь довольно строки
        <p className="mt-5 flex items-center gap-2 text-[13px] text-muted-foreground">
          <span
            aria-hidden
            className="size-[7px] flex-none rounded-full bg-primary"
          />
          Дома · {book.libraryName} ·{' '}
          {book.shelfId ? (
            <Link
              to="/shelves/$shelfId"
              params={{ shelfId: book.shelfId }}
              className="truncate underline underline-offset-2 hover:text-foreground"
            >
              {book.shelfName}
            </Link>
          ) : (
            <Link
              to="/unsorted"
              search={{ lib: book.libraryId ?? undefined }}
              className="truncate underline underline-offset-2 hover:text-foreground"
            >
              Неразобранное
            </Link>
          )}
        </p>
      ) : book.status === 'gifted' ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-patina-old bg-patina-old/20 p-3">
          <Gift aria-hidden className="size-6 flex-none text-[#A5824A]" />
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px]">
              Подарена
              {book.giftedTo && (
                <b className="font-semibold"> «{book.giftedTo}»</b>
              )}
            </p>
            {book.giftedAt && (
              <p className="text-[12.5px] text-muted-foreground">
                <span className="font-mono text-xs">
                  {dateHuman(book.giftedAt)}
                </span>
              </p>
            )}
          </div>
          <Button
            variant="outline"
            loading={busyAction === 'restore'}
            onClick={() =>
              void run(
                'restore',
                () => restoreToLibraryFn({ data: { bookId: book.id } }),
                'Книга снова в библиотеке',
              )
            }
          >
            Снова в библиотеку
          </Button>
        </div>
      ) : book.status === 'lost' ? (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <TriangleAlert
            aria-hidden
            className="size-6 flex-none text-destructive"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px]">Потерялась</p>
            <p className="text-[12.5px] text-muted-foreground">
              карточка и формуляр сохранены
            </p>
          </div>
          <Button
            variant="outline"
            loading={busyAction === 'restore'}
            onClick={() =>
              void run(
                'restore',
                () => restoreToLibraryFn({ data: { bookId: book.id } }),
                'Книга снова в библиотеке',
              )
            }
          >
            Нашлась
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-primary/25 bg-accent p-3">
          <Heart aria-hidden className="size-6 flex-none text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px]">В списке «Хочу»</p>
            <p className="text-[12.5px] text-muted-foreground">
              книги ещё нет дома
            </p>
          </div>
          <Button className="h-11" onClick={() => setMoveOpen(true)}>
            Купил — на полку
          </Button>
        </div>
      )}

      {/* ── Действия ── все одной высоты: 44px по тап-таргету гайдлайна ── */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {book.status === 'in_library' && !activeLoan && (
          <Button className="h-11" onClick={() => setLendOpen(true)}>
            Дал почитать
          </Button>
        )}
        <Button asChild variant="outline" className="h-11">
          <Link to="/books/$bookId/edit" params={{ bookId: book.id }}>
            Редактировать
          </Link>
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-11"
          aria-label="Поделиться"
          onClick={() => void share()}
        >
          <Share2 aria-hidden />
        </Button>
        <ActionMenu
          caption={book.title}
          trigger={
            <Button variant="ghost" className="h-11">
              Ещё <Ellipsis aria-hidden />
            </Button>
          }
          entries={menuEntries}
        />
      </div>

      <ListBadges lists={book.lists} className="mt-4" />

      {/* ── Аннотация и тэги ── */}
      {(book.annotation || book.tags.length > 0) && (
        <section className="mt-7">
          <SectionLabel>{book.annotation ? 'Аннотация' : 'Тэги'}</SectionLabel>
          {book.annotation && (
            <ExpandableText
              text={book.annotation}
              lines={4}
              className="max-w-[60ch]"
            />
          )}
          {book.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {book.tags.map((t) => (
                <Badge key={t} variant="secondary" className="rounded-full">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Цикл: соседние произведения ── */}
      {cycle && neighbors.length > 0 && (
        <section className="mt-7">
          <SectionLabel>
            Цикл <span className="text-stamp">· {cycle.title}</span>
          </SectionLabel>
          {neighbors.map((m) => (
            <CycleRow
              key={m.workId}
              member={m}
              authorName={cycle.authorName ?? book.authors}
              onChanged={refresh}
            />
          ))}
          {cycle.total > neighbors.length && (
            <button
              type="button"
              className="mt-2 text-[13px] font-semibold text-accent-foreground"
              onClick={() => setCycleOpen(true)}
            >
              Весь цикл · {cycle.total} →
            </button>
          )}
        </section>
      )}

      {/* ── Личное ── */}
      <section className="mt-7">
        <SectionLabel>Мой формуляр</SectionLabel>
        <PersonalPanel
          bookId={book.id}
          personal={personal}
          onChanged={refresh}
        />
      </section>

      {/* ── Библиография ── */}
      <section className="mt-7">
        <SectionLabel>Каталожная карточка</SectionLabel>
        <dl className="ruled-card">
          {book.seriesName && (
            <div className="flex h-8 items-baseline gap-3 overflow-hidden whitespace-nowrap">
              <dt className="w-[108px] flex-none text-[12.5px] text-muted-foreground">
                Изд. серия
              </dt>
              <dd className="m-0 min-w-0 truncate text-sm">
                {book.seriesId ? (
                  <Link
                    to="/series/$seriesId"
                    params={{ seriesId: book.seriesId }}
                    className="hover:underline"
                  >
                    {book.seriesName}
                  </Link>
                ) : (
                  book.seriesName
                )}
                {book.seriesNumber && (
                  <span className="text-muted-foreground">
                    {' · том '}
                    <span className="font-mono text-[13px]">
                      {book.seriesNumber}
                    </span>
                  </span>
                )}
              </dd>
            </div>
          )}
          {(book.isbn13 || book.isbn10) && (
            <div className="flex h-8 items-baseline gap-3 overflow-hidden whitespace-nowrap">
              <dt className="w-[108px] flex-none text-[12.5px] text-muted-foreground">
                ISBN
              </dt>
              <dd className="m-0 min-w-0 truncate font-mono text-[13px]">
                {book.isbn13 ?? book.isbn10}
              </dd>
            </div>
          )}
          {book.publisher && (
            <div className="flex h-8 items-baseline gap-3 overflow-hidden whitespace-nowrap">
              <dt className="w-[108px] flex-none text-[12.5px] text-muted-foreground">
                Издательство
              </dt>
              <dd className="m-0 min-w-0 truncate text-sm">{book.publisher}</dd>
            </div>
          )}
          <div className="flex h-8 items-baseline gap-3 overflow-hidden whitespace-nowrap">
            <dt className="w-[108px] flex-none text-[12.5px] text-muted-foreground">
              Язык
            </dt>
            <dd className="m-0 min-w-0 truncate text-sm">
              {LANG_LABEL[book.language] ?? book.language}
            </dd>
          </div>
          <div className="flex h-8 items-baseline gap-3 overflow-hidden whitespace-nowrap">
            <dt className="w-[108px] flex-none text-[12.5px] text-muted-foreground">
              В библиотеке
            </dt>
            <dd className="m-0 min-w-0 truncate text-sm">
              с{' '}
              <span className="font-mono text-[13px]">
                {dateRu(book.createdAt)}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      {/* ── История выдач ── */}
      {loans.length > 0 && (
        <section className="mt-7">
          <SectionLabel>Формуляр выдач</SectionLabel>
          <div className="ruled-card">
            <div className="grid h-8 grid-cols-[minmax(0,1fr)_78px_78px] items-baseline gap-2.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground uppercase">
              <span>Кому</span>
              <span>Взял</span>
              <span>Вернул</span>
            </div>
            {loans.map((l) => {
              const current = l.returnedAt === null
              return (
                <div
                  key={l.loanId}
                  className={`grid h-8 grid-cols-[minmax(0,1fr)_78px_78px] items-baseline gap-2.5 ${current ? 'text-stamp' : ''}`}
                >
                  <span className="flex min-w-0 items-baseline">
                    <span className="truncate text-sm font-medium">
                      {l.borrowerName}
                    </span>
                    {current && (
                      <span className="ml-2 inline-block flex-none rotate-[-3deg] rounded-[3px] border-[1.5px] border-stamp px-1 font-mono text-[10px] tracking-[0.1em] text-stamp uppercase">
                        сейчас
                      </span>
                    )}
                  </span>
                  <span
                    className={`font-mono text-[13px] tabular-nums ${current ? '' : 'text-muted-foreground'}`}
                  >
                    {dateShort(l.lentAt)}
                  </span>
                  <span
                    className={`font-mono text-[13px] tabular-nums ${current ? '' : 'text-muted-foreground'}`}
                  >
                    {l.returnedAt ? dateShort(l.returnedAt) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Диалоги ── */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void uploadCover(f)
          e.target.value = ''
        }}
      />
      <Drawer open={coverOpen} onOpenChange={setCoverOpen}>
        <DrawerContent className="max-w-sm">
          <DrawerHeader>
            <DrawerTitle>Обложка</DrawerTitle>
          </DrawerHeader>
          {book.coverPath ? (
            <img
              src={`/api/covers/${book.id}?v=${book.coverPath}`}
              alt={`Обложка: ${book.title}`}
              className="mx-auto max-h-[60vh] w-auto rounded-md shadow-md"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              У книги пока нет обложки — загрузите фото или скан.
            </p>
          )}
          {covers !== null && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {covers.length === 0 ? (
                <p className="col-span-3 text-[13px] text-muted-foreground">
                  Картинок не нашлось — загрузите файл.
                </p>
              ) : (
                covers.map((url) => (
                  <button
                    key={url}
                    type="button"
                    className={`overflow-hidden rounded-[5px] ${
                      pickedCover === url
                        ? 'ring-2 ring-primary ring-offset-2'
                        : ''
                    }`}
                    onClick={() => setPickedCover(url)}
                  >
                    <img
                      src={url}
                      alt=""
                      className="aspect-[7/10] w-full object-cover"
                    />
                  </button>
                ))
              )}
            </div>
          )}
          <DrawerFooter className="gap-2">
            {pickedCover && (
              <Button
                loading={coverBusy}
                onClick={() => void useFoundCover(pickedCover)}
              >
                Поставить выбранную
              </Button>
            )}
            <Button
              variant="outline"
              loading={coverBusy}
              onClick={() => fileRef.current?.click()}
            >
              {book.coverPath ? 'Заменить файлом' : 'Загрузить файл'}
            </Button>
            <Button
              variant="outline"
              loading={searchingCovers}
              onClick={() => void findCovers()}
            >
              Найти в Яндекс Картинках
            </Button>
            {book.coverPath && (
              <Button
                variant="ghost"
                disabled={coverBusy}
                onClick={() =>
                  void removeCoverFn({ data: { bookId: book.id } }).then(
                    refresh,
                  )
                }
              >
                Убрать
              </Button>
            )}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <AddToListButton
        target={{ bookId: book.id }}
        title={book.title}
        subtitle={book.authors}
        active={book.lists.length > 0}
        open={listsOpen}
        onOpenChange={setListsOpen}
      />
      <LendDialog
        bookId={book.id}
        bookTitle={book.title}
        open={lendOpen}
        onOpenChange={setLendOpen}
        onDone={refresh}
      />
      <GiftDialog
        bookId={book.id}
        bookTitle={book.title}
        open={giftOpen}
        onOpenChange={setGiftOpen}
        onDone={refresh}
      />
      <Drawer
        open={proposal !== null}
        onOpenChange={(open) => {
          if (!open) void closeProposal()
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {proposal?.mode === 'replace' ? 'Заменить данные' : 'Нашлось'}
            </DrawerTitle>
          </DrawerHeader>
          {proposal && (
            <>
              {proposal.variants.length > 1 && (
                <div className="mb-2.5 flex items-center gap-2.5">
                  <span className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
                    вариант {proposal.variantIndex + 1} из{' '}
                    {proposal.variants.length}
                  </span>
                  <span className="rounded-full bg-stamp/10 px-2.5 py-0.5 text-[11px] font-semibold text-stamp">
                    {VIA_LABEL[proposal.via] ?? proposal.via}
                  </span>
                </div>
              )}
              <div className="flex gap-3">
                {proposal.coverUrl && (
                  <img
                    src={proposal.coverUrl}
                    alt=""
                    className="aspect-[7/10] w-[70px] flex-none rounded-[4px] object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[15.5px] leading-tight font-semibold">
                    {proposal.title}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {proposal.authors}
                  </p>
                  {proposal.proof && (
                    <a
                      href={proposal.proof.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1.5 inline-block text-[12px] text-accent-foreground underline underline-offset-2"
                    >
                      ISBN найден на {proposal.proof.title}
                    </a>
                  )}
                </div>
              </div>

              {proposal.fills.length === 0 ? (
                <p className="mt-3 rounded-xl bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
                  {proposal.mode === 'replace'
                    ? 'Это ровно то, что уже записано в карточке. Ищите дальше, если издание не то.'
                    : 'Пустых полей нет — дозаполнять нечего.'}
                </p>
              ) : (
                <div className="mt-3 grid gap-1.5">
                  {proposal.fills.map((fill) => (
                    <div
                      key={fill.field}
                      className="rounded-xl bg-muted px-3 py-2"
                    >
                      <b className="block font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                        {fill.label}
                      </b>
                      {fill.was && (
                        <s className="block text-[12.5px] text-muted-foreground decoration-muted-foreground/60">
                          {fill.was}
                        </s>
                      )}
                      {fill.field === 'coverUrl' ? (
                        <img
                          src={fill.value}
                          alt=""
                          className="mt-1 aspect-[7/10] w-[46px] rounded-[3px] object-cover"
                        />
                      ) : (
                        <span
                          className={`block text-[13px] leading-snug ${
                            fill.field === 'annotation' ? 'line-clamp-4' : ''
                          }`}
                        >
                          {fill.value}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-2 text-[12.5px] text-muted-foreground">
                {proposal.mode === 'fill'
                  ? 'Название и автор остаются вашими. Оценка, рецензия, полка и списки не меняются.'
                  : 'Оценка, рецензия, полка и списки не меняются.'}
              </p>
            </>
          )}
          <DrawerFooter>
            {proposal && proposal.suggestionId !== null && (
              <Button
                variant={
                  proposal.mode === 'replace' ? 'destructive' : 'default'
                }
                className="h-12 w-full text-[15px]"
                onClick={() => {
                  const suggestionId = proposal.suggestionId
                  if (suggestionId === null) return
                  void applyProposalFn({ data: { suggestionId } })
                    .then(() => {
                      toast.success(
                        proposal.mode === 'replace' ? 'Заменили' : 'Заполнили',
                      )
                      setProposal(null)
                      void router.invalidate()
                    })
                    .catch((e: unknown) =>
                      toast.error(
                        e instanceof Error ? e.message : 'Не получилось',
                      ),
                    )
                }}
              >
                {proposal.mode === 'replace' ? 'Заменить' : 'Заполнить'}
              </Button>
            )}
            {proposal && (
              <Button
                variant="outline"
                className="h-12 w-full text-[15px]"
                loading={finding !== null}
                onClick={() => void searchFurther()}
              >
                {proposal.exhausted && proposal.variants.length < 2
                  ? 'Искать заново'
                  : 'Искать дальше'}
              </Button>
            )}
            <Button
              variant="ghost"
              className="h-12 w-full text-[15px]"
              onClick={() => void closeProposal()}
            >
              {proposal?.suggestionId === null ? 'Закрыть' : 'Отмена'}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <DeleteBookDialog
        title={book.title}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => void removeBook()}
      />
      {cycle && (
        <CycleSheet
          cycle={cycle}
          open={cycleOpen}
          onClose={() => setCycleOpen(false)}
          onChanged={refresh}
        />
      )}

      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        bookIds={[book.id]}
        defaultLibraryId={book.libraryId ?? undefined}
        defaultShelfId={book.libraryId ? book.shelfId : undefined}
        contextLabel={
          book.libraryName
            ? `Сейчас: «${book.libraryName} · ${book.shelfName ?? 'Неразобранное'}»`
            : undefined
        }
        onMoved={refresh}
      />
    </div>
  )
}

function DeleteBookDialog({
  title,
  open,
  onOpenChange,
  onConfirm,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Удалить книгу?</DrawerTitle>
        </DrawerHeader>
        <p className="text-sm text-muted-foreground">
          «{title}» — карточка, тэги, история выдач и обложка исчезнут навсегда.
          Отменить нельзя.
        </p>
        <DrawerFooter>
          <Button
            variant="destructive"
            className="h-12 w-full text-[15px]"
            onClick={onConfirm}
          >
            Удалить книгу
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" className="h-12 w-full text-[15px]">
              Отмена
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
