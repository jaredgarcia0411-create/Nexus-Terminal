FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund --prefer-offline \
  && npm install -g tsx@4 --no-audit --no-fund

COPY lib/ ./lib/
COPY services/agent-entrypoint.ts ./services/agent-entrypoint.ts

ENV NODE_ENV=production

HEALTHCHECK NONE

USER node

CMD ["tsx", "services/agent-entrypoint.ts"]
