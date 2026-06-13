FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json ./
RUN pnpm install --prod

COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "server.js"]
