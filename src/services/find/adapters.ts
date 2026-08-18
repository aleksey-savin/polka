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
import type { Finding, FindContext, SourceAdapter, SourceKey } from './types'

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
            : looksTransliterated(ctx.isbn13, hit.draft.title, hit.draft.authors),
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
  'Ты читаешь фрагменты веб-страниц и выписываешь выходные данные книги.',
  'Отвечай строго JSON-массивом, без пояснений: по одному объекту на каждую страницу, где книга нашлась.',
  'Поля объекта: known (boolean), sourceUrl (адрес той самой страницы), title, authors, publisher, year (число), pages (число), series, annotation.',
  'sourceUrl обязателен и должен точно совпадать с адресом страницы из входных данных.',
  'Не объединяй данные разных страниц в один объект: у разных магазинов бывают разные издания одной книги.',
  'annotation — описание книги из фрагментов (о чём она), без слов про магазин, цену и доставку; если описания нет, верни null.',
  'Бери только то, что есть во фрагментах.',
  'Если книги с этим ISBN нет ни на одной странице — верни пустой массив.',
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
    return []
  }
  const items = Array.isArray(raw) ? raw : [raw]
  return items
    .map((item) => parseOneGuess(item))
    .filter(
      (v): v is { draft: MetadataDraft; sourceUrl: string | null } => v !== null,
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
  const box: { pages: Array<WebPage> } = { pages: [] }
  // расход считается всегда, когда мы реально пошли в поиск, — включая
  // неудачу: иначе платный источник тратится мимо суточного лимита
  await spendSearch(ctx.userId, async () => {
    box.pages = await collect()
    return `${box.pages.length} страниц`
  })

  // страницы без номера отбрасываем до всякой модели: доверять нечему
  const useful = box.pages
    .filter(
      (page) =>
        mentionsIsbn(page.text, ctx.isbn13) ||
        mentionsIsbn(page.title, ctx.isbn13),
    )
    .slice(0, MAX_VARIANTS_PER_STEP)
  if (useful.length === 0) {
    ctx.trace.info('номер на найденных страницах не встретился', { step: key })
    return []
  }

  const payload = useful
    .map((page) => `URL: ${page.url}\n${page.title}\n${page.text}`)
    .join('\n\n')
  const answer = await ask(
    ctx.userId,
    `ISBN: ${ctx.isbn13}. Фрагменты найденных страниц:\n\n${payload.slice(0, 6000)}`,
    { system: WEB_SYSTEM, maxTokens: 1200 },
  )

  const byUrl = new Map(useful.map((page) => [page.url, page]))
  const found: Array<Finding> = []
  for (const parsed of parseGuessDrafts(answer.text)) {
    // ссылка обязана быть одной из поданных: без неё нечего показать человеку
    // как доказательство, а выдуманный адрес хуже отсутствия варианта
    const page = parsed.sourceUrl ? byUrl.get(parsed.sourceUrl) : undefined
    if (!page) continue
    if (found.some((f) => f.proof?.url === page.url)) continue
    found.push(
      finding(key, parsed.draft, ctx.isbn13, {
        variantKey: `${key}#${found.length + 1}`,
        proof: { url: page.url, title: page.title || page.url },
      }),
    )
  }
  ctx.trace.info('страницы разобраны', {
    step: key,
    pages: useful.length,
    variants: found.length,
  })
  return found.slice(0, MAX_VARIANTS_PER_STEP)
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
    return {
      draft: draft.annotation
        ? {}
        : { annotation: cleanAnnotation(page.description) ?? undefined },
      covers: page.image ? [page.image] : [],
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
      return [{ url: cited.url, title: cited.title || cited.url, text: answer.text }]
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
