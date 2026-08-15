# ── Сборка ──────────────────────────────────────────────
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

# ── Рантайм ─────────────────────────────────────────────
FROM oven/bun:1.3-slim
WORKDIR /app
# какая версия крутится — видно в журнале при старте
ARG GIT_SHA=dev
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000 \
    GIT_SHA=$GIT_SHA

# Серверный бандл экстернализует зависимости — нужен production node_modules
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/public ./public
COPY server.ts package.json ./
COPY src/lib/logger.ts ./src/lib/logger.ts

VOLUME /data
EXPOSE 3000
CMD ["bun", "server.ts"]
