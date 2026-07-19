# ---- база: node + pnpm ------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate

# ---- prod-зависимости (идут в финальный образ) ------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-server,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --config.strictDepBuilds=false

# ---- полные зависимости (нужны только для сборки: typescript, nest-cli) ---
FROM base AS build-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-server,target=/pnpm/store \
    pnpm install --frozen-lockfile --config.strictDepBuilds=false

# ---- сборка -------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=build-deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- финальный рантайм-образ --------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nestjs

# только prod node_modules
COPY --from=deps /app/node_modules ./node_modules
# скомпилированный код (включает dist/db/migrate.js — используем его для миграций)
COPY --from=builder /app/dist ./dist
# SQL-миграции drizzle нужны в рантайме (migrate.js читает их с диска)
COPY --from=builder /app/drizzle ./drizzle
COPY package.json ./

USER nestjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1 || exit 1

CMD ["node", "dist/main"]
