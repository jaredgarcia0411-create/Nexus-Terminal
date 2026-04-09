FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund --prefer-offline

COPY index.ts ./index.ts

ENV NODE_ENV=production

HEALTHCHECK NONE

USER node

CMD ["npx", "tsx", "index.ts"]
