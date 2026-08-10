/**
 * Демо-наполнение: пользователь seed@polka.local / polka-seed-1234,
 * библиотека «Дом» с тремя полками и ~20 реальными книгами.
 * Запуск: bun run seed (идемпотентно по email).
 */
import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { user } from '@/db/schema/auth'
import { auth } from '@/lib/auth'
import { createBook } from '@/services/books'
import { createLibrary } from '@/services/libraries'
import { createShelf, updateShelf } from '@/services/shelves'

const EMAIL = 'seed@polka.local'

const existing = await db
  .select({ id: user.id })
  .from(user)
  .where(eq(user.email, EMAIL))
if (existing.length > 0) {
  console.log(`Демо-данные уже есть (${EMAIL}) — выходим.`)
  process.exit(0)
}

await auth.api.signUpEmail({
  body: { email: EMAIL, password: 'polka-seed-1234', name: 'Алексей (демо)' },
})
const [seedUser] = await db
  .select({ id: user.id })
  .from(user)
  .where(eq(user.email, EMAIL))
if (!seedUser) throw new Error('не удалось создать демо-пользователя')
const uid = seedUser.id

const { id: home } = await createLibrary(uid, { name: 'Дом' })
const { id: sf } = await createShelf(uid, {
  libraryId: home,
  name: 'Фантастика',
})
const { id: romance } = await createShelf(uid, {
  libraryId: home,
  name: 'Романтика',
})
const { id: modern } = await createShelf(uid, {
  libraryId: home,
  name: 'Современная проза',
})
await updateShelf(uid, romance, { accentColor: '#E9ADBC' })

type SeedBook = Parameters<typeof createBook>[1]
const strug = { seriesName: 'Миры братьев Стругацких' }

const books: Array<SeedBook> = [
  {
    title: 'Трудно быть богом',
    authors: 'Аркадий и Борис Стругацкие',
    year: 1989,
    pages: 320,
    ...strug,
    seriesNumber: '2',
    tags: ['классика', 'перечитать'],
    libraryId: home,
    shelfId: sf,
  },
  {
    title: 'Пикник на обочине',
    authors: 'Аркадий и Борис Стругацкие',
    year: 1997,
    pages: 384,
    isbn13: '978-5-15-000554-9',
    ...strug,
    seriesNumber: '7',
    tags: ['классика'],
    libraryId: home,
    shelfId: sf,
  },
  {
    title: 'Град обреченный',
    authors: 'Аркадий и Борис Стругацкие',
    year: 2016,
    pages: 480,
    ...strug,
    seriesNumber: '9',
    libraryId: home,
    shelfId: sf,
  },
  {
    title: 'Солярис',
    authors: 'Станислав Лем',
    year: 1992,
    pages: 288,
    tags: ['классика'],
    libraryId: home,
    shelfId: sf,
  },
  {
    title: 'Туманность Андромеды',
    authors: 'Иван Ефремов',
    year: 1987,
    pages: 352,
    libraryId: home,
    shelfId: sf,
  },
  {
    title: 'Человек-амфибия',
    authors: 'Александр Беляев',
    year: 1985,
    pages: 224,
    libraryId: home,
    shelfId: sf,
  },
  {
    title: '451° по Фаренгейту',
    authors: 'Рэй Брэдбери',
    year: 1993,
    pages: 256,
    libraryId: home,
    shelfId: sf,
  },
  {
    title: 'Основание',
    authors: 'Айзек Азимов',
    year: 2008,
    pages: 416,
    libraryId: home,
    shelfId: sf,
  },
  {
    title: 'Стальная Крыса',
    authors: 'Гарри Гаррисон',
    year: 1990,
    pages: 288,
    libraryId: home,
    shelfId: sf,
  },
  {
    title: 'Посёлок',
    authors: 'Кир Булычёв',
    year: 1988,
    pages: 336,
    libraryId: home,
    shelfId: sf,
  },
  {
    title: 'Гордость и предубеждение',
    authors: 'Джейн Остин',
    year: 2012,
    pages: 416,
    libraryId: home,
    shelfId: romance,
  },
  {
    title: 'Джейн Эйр',
    authors: 'Шарлотта Бронте',
    year: 2015,
    pages: 512,
    libraryId: home,
    shelfId: romance,
  },
  {
    title: 'Унесённые ветром',
    authors: 'Маргарет Митчелл',
    year: 2004,
    pages: 1024,
    libraryId: home,
    shelfId: romance,
  },
  {
    title: 'До встречи с тобой',
    authors: 'Джоджо Мойес',
    year: 2019,
    pages: 480,
    libraryId: home,
    shelfId: romance,
  },
  {
    title: 'Лавр',
    authors: 'Евгений Водолазкин',
    year: 2021,
    pages: 440,
    tags: ['современное'],
    libraryId: home,
    shelfId: modern,
  },
  {
    title: 'Зулейха открывает глаза',
    authors: 'Гузель Яхина',
    year: 2022,
    pages: 508,
    libraryId: home,
    shelfId: modern,
  },
  {
    title: 'Петровы в гриппе и вокруг него',
    authors: 'Алексей Сальников',
    year: 2020,
    pages: 416,
    libraryId: home,
    shelfId: modern,
  },
  {
    title: 'Симон',
    authors: 'Наринэ Абгарян',
    year: 2023,
    pages: 352,
    libraryId: home,
    shelfId: modern,
  },
  {
    title: 'Мастер и Маргарита',
    authors: 'Михаил Булгаков',
    year: 1988,
    pages: 384,
    tags: ['классика'],
    libraryId: home,
    shelfId: null,
  },
  {
    title: 'Три товарища',
    authors: 'Эрих Мария Ремарк',
    year: 1995,
    pages: 448,
    libraryId: home,
    shelfId: null,
  },
  {
    title: 'Дюна',
    authors: 'Фрэнк Герберт',
    year: 2021,
    pages: 704,
    libraryId: home,
    shelfId: null,
  },
  {
    title: 'Улитка на склоне',
    authors: 'Аркадий и Борис Стругацкие',
    ...strug,
    seriesNumber: '5',
    wishlist: true,
  },
]

for (const b of books) await createBook(uid, b)
console.log(
  `Готово: «Дом», 3 полки, ${books.length} книг. Вход: ${EMAIL} / polka-seed-1234`,
)
process.exit(0)
