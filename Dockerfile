# ───────────────── Stage 1: Builder ─────────────────
# Full deps (incl. dev) → tsc + prisma generate → dist/
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
RUN npx prisma generate

COPY . .
RUN npm run build

# ───────────────── Stage 2: Production deps only ─────────────────
# Drops jest/eslint/ts-node/etc. — `npm ci --omit=dev` installs runtime
# packages only. We do NOT run `prisma generate` here because the `prisma`
# CLI is in devDependencies (just stripped). The generated client gets
# copied from the builder stage at stage 3 instead.
FROM node:20-alpine AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts

# ───────────────── Stage 3: Runner ─────────────────
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini

COPY --from=builder /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
# Bring the generated Prisma client over from builder. `.prisma/client` is
# what `import { PrismaClient } from '@prisma/client'` resolves to at
# runtime — without it, Nest boot crashes with "PrismaClient not generated".
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3031
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
