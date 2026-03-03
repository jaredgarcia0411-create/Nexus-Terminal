FROM node:20-slim AS base

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:20-slim AS production

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=base /app/dist ./dist

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
