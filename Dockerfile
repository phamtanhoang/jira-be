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
# Drops jest/eslint/ts-node/etc. — re-runs `prisma generate` so the runtime
# client is present. Result: ~200MB smaller `node_modules` than reusing the
# builder's deps.
FROM node:20-alpine AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# ───────────────── Stage 3: Runner ─────────────────
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini

COPY --from=builder /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3031
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main"]
