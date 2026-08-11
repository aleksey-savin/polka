import { z } from 'zod'

const DEV_SECRET = 'dev-secret-change-me-in-production'

const envSchema = z.object({
  DATA_DIR: z.string().default('./data'),
  APP_URL: z.url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(16).default(DEV_SECRET),
  GOOGLE_BOOKS_API_KEY: z.string().optional(),
})

export const env = envSchema.parse(process.env)

if (
  process.env.NODE_ENV === 'production' &&
  env.BETTER_AUTH_SECRET === DEV_SECRET
) {
  throw new Error(
    'BETTER_AUTH_SECRET обязателен в продакшене — задайте длинную случайную строку',
  )
}
