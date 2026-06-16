FROM node:20-slim AS builder

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY . .
RUN pnpm build

FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 8080

CMD ["node", "server.js"]
