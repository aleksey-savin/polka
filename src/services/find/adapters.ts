import { ask } from '@/services/ai'
import { fetchFantlab } from '@/services/metadata/fantlab'
import {
  fetchGoogleBooks,
  fetchGoogleByTitle,
} from '@/services/metadata/googleBooks'
import { fetchOpenLibrary } from '@/services/metadata/openLibrary'
import { bestRefBookIdForIsbn, refLookup } from '@/services/reference'
import {
  fetchOpenGraph,
  fetchPageText,
  genSearch,
  mentionsIsbn,
  searchCoverImages,
  searchWeb,
  spendSearch,
} from '@/services/webSearch'
import {
  cleanAnnotation,
  cleanFoundTitle,
  cleanPublisher,
  looksTransliterated,
} from './clean'
import { MAX_VARIANTS_PER_STEP } from './types'
import type { MetadataDraft, SourceResult } from '@/services/metadata/types'
import type {
  Finding,
  FindContext,
  PendingPage,
  SourceAdapter,
  SourceKey,
} from './types'

/**
 * Источники как функции — единственное место подсистемы, где живёт сеть.
 *
 * Разбор ответов не переписан: он проверен фикстурами в `metadata.test.ts` и
 * живёт там же, где жил. Здесь только приведение к общему виду `Finding`.
 */

const finding = (
  key: SourceKey,
  draft: MetadataDraft,
  isbn13: string,
  extra: Partial<Finding> = {},
): Finding => ({
  key,
  variantKey: key,
  draft,
  proof: null,
  refBookId: null,
  workId: null,
  covers: draft.coverUrl ? [draft.coverUrl] : [],
  // латиница у русского издания — обычная беда каталогов: находка остаётся
  // запасной, а цепочка идёт дальше за живой страницей на русском
  weak: looksTransliterated(isbn13, draft.title, draft.authors),
  ...extra,
})

/** Одна находка или пусто — каталоги отвечают именно так. */
const one = (found: Finding | null): Array<Finding> => (found ? [found] : [])

/** Первая непустая запись из набора результатов источника. */
const firstResult = (
  results: Array<SourceResult> | null,
): SourceResult | null => results?.find((r) => r.draft.title) ?? null

const reference: SourceAdapter = {
  key: 'reference',
  paid: false,
  timeoutMs: 2_000,
  probe: async (ctx) => {
    const hit = firstResult(await refLookup(ctx.isbn13))
    if (!hit) return []
    return one(
      finding('reference', hit.draft, ctx.isbn13, {
        refBookId: await bestRefBookIdForIsbn(ctx.isbn13),
        // у записи, утверждённой модератором, латиница — осознанный выбор
        // человека; у пришедшей из каталога это обычный транслит
        weak:
          hit.source === 'manual'
            ? false
            : looksTransliterated(
                ctx.isbn13,
                hit.draft.title,
                hit.draft.authors,
              ),
      }),
    )
  },
}

const fantlab: SourceAdapter = {
  key: 'fantlab',
  paid: false,
  timeoutMs: 6_000,
  probe: async (ctx) => {
    const result = await fetchFantlab(ctx.isbn13)
    return one(
      result?.draft.title ? finding('fantlab', result.draft, ctx.isbn13) : null,
    )
  },
}

const google: SourceAdapter = {
  key: 'google',
  paid: false,
  timeoutMs: 6_000,
  probe: async (ctx) => {
    const result = await fetchGoogleBooks(ctx.isbn13)
    return one(
      result?.draft.title ? finding('google', result.draft, ctx.isbn13) : null,
    )
  },
  // Google знает обложки и аннотации почти для всего — им и добираем
  enrich: async (_ctx, draft) => {
    if (!draft.title) return { draft: {}, covers: [] }
    const found = await fetchGoogleByTitle(draft.title, draft.authors ?? null)
    if (!found) return { draft: {}, covers: [] }
    return {
      draft: { annotation: found.annotation, pages: found.pages },
      covers: found.coverUrl ? [found.coverUrl] : [],
    }
  },
}

const openlibrary: SourceAdapter = {
  key: 'openlibrary',
  paid: false,
  timeoutMs: 5_000,
  probe: async (ctx) => {
    const result = await fetchOpenLibrary(ctx.isbn13)
    return one(
      result?.draft.title
        ? finding('openlibrary', result.draft, ctx.isbn13)
        : null,
    )
  },
}

export const WEB_SYSTEM = [
  'Ты читаешь текст страницы книжного магазина или библиотеки и выписываешь выходные данные книги.',
  'Отвечай строго одним JSON-объектом, без пояснений.',
  'Поля: known (boolean), title, authors, publisher, year (число), pages (число), series, language, annotation.',
  'На странице обычно есть таблица характеристик — ISBN, автор, издательство, серия, год, число страниц, язык — и отдельно описание книги. Бери данные оттуда.',
  'authors — как напечатано на странице, в том числе по-русски; не переводи и не транслитерируй.',
  'annotation — описание книги со страницы (о чём она), без слов про магазин, цену, доставку и отзывы; если описания нет, верни null.',
  'Бери только то, что есть в тексте. Если книги с этим ISBN на странице нет — верни {"known": false}.',
].join(' ')

/**
 * Черновики из ответа модели: модели любят обрамлять JSON текстом и ```.
 *
 * Ответ ждём массивом — по книге на страницу. Одиночный объект тоже
 * принимаем: модели периодически возвращают его вместо массива из одного
 * элемента, и ронять из-за этого находку глупо.
 */
export function parseGuessDrafts(
  text: string,
): Array<{ draft: MetadataDraft; sourceUrl: string | null }> {
  const start = text.search(/[[{]/)
  if (start < 0) return []
  const opener = text[start]
  const end = text.lastIndexOf(opener === '[' ? ']' : '}')
  if (end <= start) return []
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    // не-JSON от модели — обычное «ничего не нашла», а не поломка
    return []
  }
  const items = Array.isArray(raw) ? raw : [raw]
  return items
    .map((item) => parseOneGuess(item))
    .filter(
      (v): v is { draft: MetadataDraft; sourceUrl: string | null } =>
        v !== null,
    )
}

function parseOneGuess(
  raw: unknown,
): { draft: MetadataDraft; sourceUrl: string | null } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const str = (v: unknown): string | undefined => {
    const s = typeof v === 'string' ? v.trim() : ''
    return s.length > 0 ? s : undefined
  }
  const rawTitle = str(o.title)
  const title = rawTitle ? cleanFoundTitle(rawTitle) || undefined : undefined
  if (o.known !== true || !title) return null

  const draft: MetadataDraft = { title }
  const authors = str(o.authors)
  if (authors) draft.authors = authors
  const publisher = cleanPublisher(str(o.publisher) ?? null)
  if (publisher) draft.publisher = publisher
  const year = Number(o.year)
  if (Number.isFinite(year) && year > 1400 && year < 2100) draft.year = year
  const pages = Number(o.pages)
  if (Number.isFinite(pages) && pages > 0) draft.pages = pages
  const series = str(o.series) ?? str(o.seriesName)
  if (series) draft.seriesName = series
  const annotation = cleanAnnotation(str(o.annotation) ?? null)
  if (annotation) draft.annotation = annotation
  return { draft, sourceUrl: str(o.sourceUrl) ?? null }
}

/**
 * Похожа ли картинка со страницы на обложку книги.
 *
 * `og:image` у страниц выдачи и маркетплейсов часто оказывается логотипом или
 * спрайтом: подставив такую картинку, мы перечеркнём человеку нормальную
 * обложку ради иконки поисковика. Отсеиваем по адресу — это дёшево и ловит
 * почти все случаи.
 */
const NOT_A_COVER =
  /(logo|sprite|favicon|placeholder|stub|banner|icon|share|default)/i
const STATIC_HOSTS = /(yastatic\.net|mc\.yandex|googletagmanager|gstatic\.com)/i

export function looksLikeCover(url: string | null): url is string {
  if (!url?.startsWith('http')) return false
  if (url.endsWith('.svg')) return false
  if (STATIC_HOSTS.test(url)) return false
  return !NOT_A_COVER.test(url)
}

/** Страница-кандидат: у каждой находки будет своя ссылка-доказательство. */
interface WebPage {
  url: string
  title: string
  text: string
}

/**
 * Общая часть веб-ступеней: найти страницы, проверить, что на них есть наш
 * номер, и попросить модель выписать данные. Правило приёмки прежнее (M26):
 * без номера в тексте страницы результат не берётся вовсе.
 *
 * Отдаёт несколько находок — по одной на страницу. Поиск оплачен один раз, и
 * запирать десяток найденных изданий в единственный вариант незачем: человек
 * листает их стрелками бесплатно.
 */
async function readFromWeb(
  ctx: FindContext,
  key: 'web' | 'neuro',
  collect: () => Promise<Array<WebPage>>,
): Promise<Array<Finding>> {
  // Отложенные страницы читаем без нового поиска: он уже оплачен, а страница
  // никуда не делась. Так «Искать дальше» не стоит ни поиска, ни лишних
  // запросов к модели.
  let queue: Array<PendingPage> = ctx.pending
  if (queue.length === 0) {
    const box: { pages: Array<WebPage> } = { pages: [] }
    // расход считается всегда, когда мы реально пошли в поиск, — включая
    // неудачу: иначе платный источник тратится мимо суточного лимита
    await spendSearch(ctx.userId, async () => {
      box.pages = await collect()
      return `${box.pages.length} страниц`
    })

    // Сниппет — только повод открыть страницу: в нём две строки, ни
    // аннотации, ни нормальных ФИО автора.
    queue = box.pages
      .filter(
        (page) =>
          mentionsIsbn(page.text, ctx.isbn13) ||
          mentionsIsbn(page.title, ctx.isbn13),
      )
      .slice(0, MAX_VARIANTS_PER_STEP)
      .map((page) => ({ url: page.url, title: page.title || page.url }))
    if (queue.length === 0) {
      ctx.trace.info('номер в выдаче не встретился', { step: key })
      ctx.defer([])
      return []
    }
    ctx.trace.info('страницы отобраны', { step: key, pages: queue.length })
  }

  // За страницу платим запросом к модели, поэтому читаем ровно одну.
  // Не устроит — «Искать дальше» возьмёт следующую из очереди.
  for (let i = 0; i < queue.length; i++) {
    const page = queue[i]!
    if (ctx.leftMs() < 12_000) {
      ctx.trace.info('на чтение страницы не хватило времени', {
        step: key,
        leftMs: ctx.leftMs(),
      })
      ctx.defer(queue.slice(i))
      return []
    }

    const text = await fetchPageText(page.url)
    if (!text) continue
    // Пустой каркас: магазин отдал страницу, но данные рисует скриптами.
    // Тратить на неё запрос к модели незачем — читать там нечего.
    if (text.length < 400) {
      ctx.trace.info('страница пришла почти пустой', {
        step: key,
        url: page.url,
        chars: text.length,
      })
      continue
    }
    // Номер должен встретиться в тексте самой страницы, а не только в
    // сниппете: совпадение в выдаче бывает случайным (M26, усилено M32).
    if (!mentionsIsbn(text, ctx.isbn13)) {
      ctx.trace.info('на странице номера не оказалось', {
        step: key,
        url: page.url,
      })
      continue
    }

    // Магазины отдают ботам по-разному: кто-то 403, кто-то пустой каркас с
    // рендером на скриптах. Записываем, сколько текста реально досталось —
    // иначе «аннотации нет» не отличить от «страница пришла пустой».
    ctx.trace.info('страница прочитана', {
      step: key,
      url: page.url,
      chars: text.length,
    })

    const answer = await ask(
      ctx.userId,
      `ISBN: ${ctx.isbn13}. Страница ${page.url}:\n\n${text.slice(0, 7000)}`,
      { system: WEB_SYSTEM, maxTokens: 700 },
    )
    const parsed = parseGuessDrafts(answer.text)[0]
    if (!parsed) {
      ctx.trace.info('модель не нашла книгу на странице', {
        step: key,
        url: page.url,
      })
      continue
    }

    ctx.defer(queue.slice(i + 1))
    ctx.trace.info('данные со страницы', {
      step: key,
      url: page.url,
      title: parsed.draft.title,
      publisher: parsed.draft.publisher ?? '—',
      pages: parsed.draft.pages ?? '—',
      // самое частое «чего-то не хватает» — именно про описание
      annotation: parsed.draft.annotation
        ? `${parsed.draft.annotation.length} символов`
        : 'нет',
      left: queue.length - i - 1,
    })
    return [
      finding(key, parsed.draft, ctx.isbn13, {
        variantKey: `${key}#${MAX_VARIANTS_PER_STEP - queue.length + i + 1}`,
        proof: page,
      }),
    ]
  }

  // ни одна страница не далась — очередь пуста, идём дальше по цепочке
  ctx.defer([])
  ctx.trace.info('страницы не дали данных', { step: key })
  return []
}

const web: SourceAdapter = {
  key: 'web',
  paid: true,
  timeoutMs: 20_000,
  probe: (ctx) =>
    readFromWeb(ctx, 'web', async () => {
      const hits = await searchWeb(`ISBN ${ctx.isbn13}`)
      return hits.map((hit) => ({
        url: hit.url,
        title: hit.title,
        text: hit.text,
      }))
    }),
  // страница, на которой встретился номер, — лучший источник обложки
  enrich: async (ctx, draft) => {
    const proof = ctx.soFar.find((f) => f.proof)?.proof
    if (!proof) return { draft: {}, covers: [] }
    const page = await fetchOpenGraph(proof.url)
    const cover = looksLikeCover(page.image) ? page.image : null
    if (page.image && !cover) {
      ctx.trace.info('картинка со страницы не похожа на обложку', {
        url: page.image.slice(0, 120),
      })
    }
    return {
      draft: draft.annotation
        ? {}
        : { annotation: cleanAnnotation(page.description) ?? undefined },
      covers: cover ? [cover] : [],
    }
  },
}

/**
 * Нейропоиск: модель ищет сама и отвечает связным текстом. Ступень остаётся
 * одной находкой и выключена по умолчанию — искать номер генеративным ответом
 * малополезно (ISBN модель не помнит), она сильна как читатель страниц.
 */
const neuro: SourceAdapter = {
  key: 'neuro',
  paid: true,
  timeoutMs: 35_000,
  probe: (ctx) =>
    readFromWeb(ctx, 'neuro', async () => {
      const answer = await genSearch(
        `Книга с ISBN ${ctx.isbn13}: название, автор, издательство, год, число страниц.`,
      )
      // текст ответа кладём к цитируемой странице: номер обычно именно там
      const cited = answer.sources.find((src) => src.used) ?? answer.sources[0]
      if (!cited) return []
      return [
        { url: cited.url, title: cited.title || cited.url, text: answer.text },
      ]
    }),
  // Яндекс Картинки — тоже платная услуга, поэтому живут за платной ступенью
  // и расходуются через общий счётчик, а не мимо него
  enrich: async (ctx, draft) => {
    if (!draft.title) return { draft: {}, covers: [] }
    let covers: Array<string> = []
    await spendSearch(ctx.userId, async () => {
      covers = await searchCoverImages(
        `${draft.title} ${draft.authors ?? ''} книга обложка`.trim(),
        4,
      )
      return `${covers.length} картинок`
    })
    return { draft: {}, covers }
  },
}

export const ADAPTERS: Partial<Record<SourceKey, SourceAdapter>> = {
  reference,
  fantlab,
  google,
  openlibrary,
  web,
  neuro,
}
