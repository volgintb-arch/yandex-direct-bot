FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ── Mini App build (separate stage so deps don't bloat the bot image) ──
FROM node:20-alpine AS miniapp
WORKDIR /miniapp
COPY miniapp/package.json miniapp/package-lock.json* ./
RUN npm ci
COPY miniapp ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3004

# Only what's needed at runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=miniapp /miniapp/dist ./miniapp/dist
COPY package.json ./

EXPOSE 3004

# Apply schema on start (idempotent), then run server
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
