FROM node:20-slim AS builder

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod

COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public

FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app ./

EXPOSE 8080

CMD ["node", "server.js"]
