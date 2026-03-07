# Nexus Terminal

Nexus Terminal is a trading journal built with Next.js 15, React 19, and TypeScript. The app focuses on journaling, analysis, filtering, and Jarvis assistance.

## Current Features

- Journal workflows for creating, editing, and deleting trades
- CSV import (single file and folder import)
- Execution-level persistence (`trade_executions`) with replay support
- Tagging and global tag management
- Bulk actions (multi-select delete and bulk tag add)
- Dashboard, Journal, Performance, Filter, and Jarvis tabs
- Date filtering and global time presets (`All`, `30D`, `60D`, `90D`)
- Per-trade detail sheet with notes support
- Market data fetch endpoint for chart/replay context (`/api/market-data`)
- Journal replay charts are taller (+20%), include pre/post market candles (`04:00-20:00` ET), and render entry/exit triangles at exact execution prices

## Jarvis

Jarvis provides:

- Daily summary
- Trade analysis
- Free-form assistant mode
- Optional website context scraping with up to 5 URLs per request
- URL validation with per-line feedback (invalid, duplicate, overflow)
- Remembered URL suggestions per user (`jarvis_source_urls`)
- Structured response format (TL;DR, Findings, Action Steps, Risks) with source citations
- DeepSeek V3.2 LLM integration via NVIDIA API endpoint

If no `JARVIS_API_KEY` (or `NVIDIA_API_KEY`) is configured, Jarvis falls back to deterministic non-LLM responses.

## Integrations

- Jarvis optional external web context scraping (HTTP/HTTPS URLs)

## Authentication and Access

- NextAuth v5 with Google provider (current runtime config)
- Sign-in page at `/login`
- Protected app routes via middleware
- API routes are excluded from middleware matcher and handle their own auth requirements
- Sign out returns users to `/login`

## Data and Storage

- PostgreSQL (Neon) via Drizzle ORM when `DATABASE_URL` is set
- LocalStorage fallback behavior exists in client flows when DB is unavailable
- Drizzle schema source: `lib/db/schema.ts`
- Migrations live under `drizzle/*.sql`

## Tech Stack

- Framework: Next.js 15 (App Router)
- UI: React 19
- Language: TypeScript 5.9
- Styling: Tailwind CSS v4
- Animation: `motion/react`
- Auth: NextAuth v5 beta
- ORM/DB: Drizzle ORM + PostgreSQL (Neon)
- Charts: Recharts + lightweight-charts
- Tests: Vitest

## Environment Variables

See `.env.example` for the canonical list.

Commonly used variables:

- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DATABASE_URL`
- `JARVIS_API_KEY`
- `JARVIS_API_BASE_URL`
- `JARVIS_MODEL`

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Validation

```bash
npm test
npm run build
```

## Database Migrations

```bash
npm run db:migrate
```

## Project Layout (High-Level)

```text
app/
  page.tsx
  login/page.tsx
  api/
    auth/
    jarvis/
    market-data/
    trades/
    tags/

components/trading/
  Sidebar.tsx
  Toolbar.tsx
  DashboardTab.tsx
  JournalTab.tsx
  JournalTradeChart.tsx
  PerformanceTab.tsx
  FilterTab.tsx
  TradeDetailSheet.tsx
  JarvisTab.tsx

lib/
  auth-config.ts
  api-route-utils.ts
  db.ts
  db/schema.ts
  server-db-utils.ts
```
