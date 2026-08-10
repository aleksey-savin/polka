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
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/public ./public
COPY server.ts package.json ./

VOLUME /data
EXPOSE 3000
CMD ["bun", "server.ts"]
