import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, test } from 'bun:test'

import type { Finding, SourceAdapter, SourceKey } from './types'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'polka-findcore-'))
process.env.BETTER_AUTH_SECRET = 'test-secret-for-find-core'

const { db } = await import('@/db')
const { user } = await import('@/db/schema/auth')
const { bookSource, userAccount } = await import('@/db/schema/moderation')
const { lookupCache } = await import('@/db/schema/circulation')
const { findEdition } = await import('./core')
const { QUICK_BUDGET_MS } = await import('./types')
const { setEnabled, moveSource } = await import('@/services/bookSources')
const { looksTransliterated } = await import('./clean')
const { eq } = await import('drizzle-orm')

const ME = 'core-user'
await db.insert(user).values({
  id: ME,
  name: 'Хозяин',
  email: 'core@test.local',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
})
await db.insert(userAccount).values({ userId: ME, role: 'admin' })

const ISBN = '9785171636951'
/** Кто из подставных источников был спрошен в этом прогоне. */
let asked: Array<SourceKey> = []

/** Подставная ступень: отвечает одной находкой, списком или ничем. */
const answering = (
  key: SourceKey,
  drafts: Finding['draft'] | Array<Finding['draft']> | null,
  extra: { paid?: boolean; delayMs?: number; throws?: boolean } = {},
): SourceAdapter => ({
  key,
  paid: extra.paid ?? false,
  timeoutMs: 1_000,
  probe: async () => {
    asked.push(key)
    if (extra.delayMs) await new Promise((r) => setTimeout(r, extra.delayMs))
    if (extra.throws) throw new Error(`${key} лёг`)
    if (!drafts) return []
    const list = Array.isArray(drafts) ? drafts : [drafts]
    return list.map((draft, index) => ({
      key,
      variantKey: list.length > 1 ? `${key}#${index + 1}` : key,
      draft,
      proof: null,
      refBookId: null,
      workId: null,
      covers: [],
      // как в боевом адаптере: латиница у русского номера — слабая находка
      weak: looksTransliterated(ISBN, draft.title, draft.authors),
    }))
  },
})

const registry = (
  over: Partial<Record<SourceKey, SourceAdapter>> = {},
): Partial<Record<SourceKey, SourceAdapter>> => ({
  reference: answering('reference', null),
  fantlab: answering('fantlab', { title: 'Зона', authors: 'Довлатов' }),
  google: answering('google', { title: 'Zona', publisher: 'Азбука' }),
  openlibrary: answering('openlibrary', null),
  web: answering('web', null, { paid: true }),
  neuro: answering('neuro', null, { paid: true }),
  ...over,
})

beforeEach(async () => {
  asked = []
  await db.delete(bookSource)
  await db.delete(lookupCache)
})

describe('ядро поиска', () => {
  test('кривой ISBN — понятная ошибка, а не падение', async () => {
    await expect(
      findEdition(ME, '123', { adapters: registry() }),
    ).rejects.toThrow(/ISBN/i)
  })

  test('находки сливаются по порядку цепочки', async () => {
    const result = await findEdition(ME, ISBN, { adapters: registry() })
    expect(result.draft.title).toBe('Зона')
    expect(result.draft.publisher).toBe('Азбука')
    expect(result.found).toContain('fantlab')
  })

  test('выключенный источник не спрашивается', async () => {
    await setEnabled(ME, 'google', false)
    await findEdition(ME, ISBN, { adapters: registry() })
    expect(asked).not.toContain('google')
  })

  test('выключенный источник виден в отчёте', async () => {
    await setEnabled(ME, 'google', false)
    const result = await findEdition(ME, ISBN, { adapters: registry() })
    const probe = result.probes.find((p) => p.key === 'google')
    expect(probe?.outcome).toBe('выключен')
  })

  test('упавший источник не роняет поиск', async () => {
    const result = await findEdition(ME, ISBN, {
      adapters: registry({
        fantlab: answering('fantlab', null, { throws: true }),
      }),
    })
    expect(result.draft.title).toBe('Zona')
    const probe = result.probes.find((p) => p.key === 'fantlab')
    expect(probe?.outcome).toBe('ошибка')
    expect(probe?.detail).toMatch(/лёг/)
  })

  test('нашлось бесплатно — за платное не платим', async () => {
    const paidRegistry = registry({
      web: answering('web', { title: 'Из веба' }, { paid: true }),
    })
    await findEdition(ME, ISBN, { adapters: paidRegistry })
    expect(asked).not.toContain('web')
  })

  test('транслит не считается ответом — цепочка идёт дальше', async () => {
    const translit = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', { title: 'Deti-bilingvy' }),
      web: answering('web', { title: 'Дети-билингвы' }, { paid: true }),
    })
    const result = await findEdition(ME, ISBN, { adapters: translit })
    expect(asked).toContain('web')
    expect(result.draft.title).toBe('Дети-билингвы')
  })

  test('маленький бюджет обрывает цепочку до платных ступеней', async () => {
    const silent = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
    })
    const result = await findEdition(ME, ISBN, {
      budgetMs: 1,
      adapters: silent,
    })
    expect(result.truncated).toBe(true)
    expect(asked).not.toContain('web')
  })

  test('оборванная цепочка помечает не дошедшие ступени', async () => {
    const silent = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
    })
    const result = await findEdition(ME, ISBN, {
      budgetMs: 1,
      adapters: silent,
    })
    expect(result.probes.some((p) => p.outcome === 'не успели')).toBe(true)
  })

  test('оборванная цепочка не кэшируется', async () => {
    const silent = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
    })
    await findEdition(ME, ISBN, { budgetMs: 1, adapters: silent })
    asked = []
    const again = await findEdition(ME, ISBN, { adapters: silent })
    expect(again.cached).toBe(false)
    expect(asked.length).toBeGreaterThan(0)
  })

  test('повтор отдаётся из кэша, источники не тревожатся', async () => {
    await findEdition(ME, ISBN, { adapters: registry() })
    asked = []
    const again = await findEdition(ME, ISBN, { adapters: registry() })
    expect(again.cached).toBe(true)
    expect(asked).toEqual([])
  })

  test('смена настроек обесценивает кэш', async () => {
    await findEdition(ME, ISBN, { adapters: registry() })
    await moveSource(ME, 'google', 'up')
    asked = []
    const again = await findEdition(ME, ISBN, { adapters: registry() })
    expect(again.cached).toBe(false)
    expect(asked.length).toBeGreaterThan(0)
  })

  test('force идёт мимо кэша', async () => {
    await findEdition(ME, ISBN, { adapters: registry() })
    asked = []
    const again = await findEdition(ME, ISBN, {
      force: true,
      adapters: registry(),
    })
    expect(again.cached).toBe(false)
    expect(asked).toContain('fantlab')
  })

  test('отвергнутая ступень пропускается', async () => {
    await findEdition(ME, ISBN, {
      rejected: ['fantlab'],
      adapters: registry(),
    })
    expect(asked).not.toContain('fantlab')
  })

  test('никто не ответил — пустой черновик, не исключение', async () => {
    const silent = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
    })
    const result = await findEdition(ME, ISBN, { adapters: silent })
    expect(result.draft.title).toBeUndefined()
    expect(result.exhausted).toBe(true)
  })

  test('бесплатные каталоги опрашиваются разом, а не по очереди', async () => {
    // по очереди три ступени по 300 мс заняли бы 900 мс: столько складывались
    // таймауты до M32, и быстрый режим не успевал ни одного каталога
    const slow = registry({
      fantlab: answering('fantlab', null, { delayMs: 300 }),
      google: answering('google', null, { delayMs: 300 }),
      openlibrary: answering('openlibrary', null, { delayMs: 300 }),
    })
    const started = performance.now()
    await findEdition(ME, ISBN, { adapters: slow })
    expect(performance.now() - started).toBeLessThan(700)
  })

  test('быстрого бюджета хватает на каталоги', async () => {
    const slow = registry({
      fantlab: answering('fantlab', { title: 'Зона' }, { delayMs: 300 }),
      google: answering('google', null, { delayMs: 300 }),
    })
    const result = await findEdition(ME, ISBN, {
      budgetMs: QUICK_BUDGET_MS,
      adapters: slow,
    })
    expect(result.draft.title).toBe('Зона')
    expect(asked).toContain('fantlab')
  })

  test('отчёт идёт в порядке цепочки, а не в порядке ответов', async () => {
    const uneven = registry({
      fantlab: answering('fantlab', null, { delayMs: 200 }),
      google: answering('google', null, { delayMs: 10 }),
    })
    const result = await findEdition(ME, ISBN, { adapters: uneven })
    const keys = result.probes.map((p) => p.key)
    expect(keys.indexOf('fantlab')).toBeLessThan(keys.indexOf('google'))
  })

  test('непрочитанные страницы возвращаются наружу', async () => {
    const withQueue: SourceAdapter = {
      key: 'web',
      paid: true,
      timeoutMs: 1_000,
      probe: async (ctx) => {
        asked.push('web')
        // адаптер прочитал одну страницу, две отложил
        ctx.defer([
          { url: 'https://b.ru', title: 'Б' },
          { url: 'https://c.ru', title: 'В' },
        ])
        return [
          {
            key: 'web',
            variantKey: 'web#1',
            draft: { title: 'Со страницы А' },
            proof: { url: 'https://a.ru', title: 'А' },
            refBookId: null,
            workId: null,
            covers: [],
            weak: false,
          },
        ]
      },
    }
    const result = await findEdition(ME, ISBN, {
      adapters: registry({
        fantlab: answering('fantlab', null),
        google: answering('google', null),
        web: withQueue,
      }),
    })
    expect(result.pendingPages).toHaveLength(2)
    // очередь не пуста — значит есть куда идти
    expect(result.exhausted).toBe(false)
  })

  test('отложенные страницы читаются без нового поиска', async () => {
    let searched = 0
    const lazy: SourceAdapter = {
      key: 'web',
      paid: true,
      timeoutMs: 1_000,
      probe: async (ctx) => {
        // очередь пуста только при первом заходе — тогда и платим за поиск
        if (ctx.pending.length === 0) searched++
        const queue =
          ctx.pending.length > 0
            ? ctx.pending
            : [
                { url: 'https://a.ru', title: 'А' },
                { url: 'https://b.ru', title: 'Б' },
              ]
        const [page, ...rest] = queue
        ctx.defer(rest)
        return [
          {
            key: 'web',
            variantKey: 'web#1',
            draft: { title: `Со страницы ${page!.title}` },
            proof: page!,
            refBookId: null,
            workId: null,
            covers: [],
            weak: false,
          },
        ]
      },
    }
    const silent = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
      web: lazy,
    })

    const first = await findEdition(ME, ISBN, { adapters: silent })
    expect(first.draft.title).toBe('Со страницы А')
    expect(first.pendingPages).toHaveLength(1)

    // второй заход берёт отложенную страницу и в поиск не идёт
    const second = await findEdition(ME, ISBN, {
      adapters: silent,
      rejected: [],
      pendingPages: first.pendingPages,
      force: true,
    })
    expect(second.draft.title).toBe('Со страницы Б')
    expect(searched).toBe(1)
  })

  test('находка каталога пополняет общий эталон', async () => {
    // ради этого заведён M14: второй раз книга находится мгновенно и без сети
    const { refBook } = await import('@/db/schema/catalog')
    const isbn = '9785171636968'
    await findEdition(ME, isbn, {
      adapters: registry({
        fantlab: answering('fantlab', { title: 'Зона', authors: 'Довлатов' }),
      }),
    })
    const rows = await db.select().from(refBook).where(eq(refBook.isbn13, isbn))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]?.title).toBe('Зона')
  })

  test('транслит в общий эталон не попадает', async () => {
    // осев в эталоне, латиница портила бы выдачу всем: эталон стоит первым
    const { refBook } = await import('@/db/schema/catalog')
    const isbn = '9785171636975'
    await findEdition(ME, isbn, {
      adapters: registry({
        fantlab: answering('fantlab', null),
        google: answering('google', { title: 'Deti-bilingvy' }),
      }),
    })
    const rows = await db.select().from(refBook).where(eq(refBook.isbn13, isbn))
    expect(rows).toHaveLength(0)
  })

  test('ступень отдаёт несколько вариантов — все попадают в находки', async () => {
    const many = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
      web: answering(
        'web',
        [
          { title: 'Зона', year: 2020 },
          { title: 'Зона', year: 2001 },
          { title: 'Зона: записки надзирателя' },
        ],
        { paid: true },
      ),
    })
    const result = await findEdition(ME, ISBN, { adapters: many })
    expect(result.findings).toHaveLength(3)
    expect(result.findings.map((f) => f.variantKey)).toEqual([
      'web#1',
      'web#2',
      'web#3',
    ])
  })

  test('в слитый черновик идёт первый вариант ступени', async () => {
    const many = registry({
      fantlab: answering('fantlab', null),
      google: answering('google', null),
      web: answering(
        'web',
        [
          { title: 'Зона', year: 2020 },
          { title: 'Зона', year: 2001 },
        ],
        { paid: true },
      ),
    })
    const result = await findEdition(ME, ISBN, { adapters: many })
    expect(result.draft.year).toBe(2020)
  })
})
