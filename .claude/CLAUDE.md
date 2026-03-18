# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# Development Commands

```bash
npm run dev              # Start Next.js dev server (localhost:3000)
npm run build            # Production build
npm run lint             # ESLint (flat config, eslint 9)
npx tsc --noEmit         # Type-check without emitting
npm run test             # Run all tests (vitest)
npx vitest run __tests__/csv-parser.test.ts  # Run a single test file
npm run test:watch       # Watch mode

# Database (Drizzle + Neon PostgreSQL)
npm run db:generate      # Generate migration from schema changes
npm run db:migrate       # Run migrations (safe wrapper script)
npm run db:push          # Push schema directly (dev only)
npm run db:studio        # Open Drizzle Studio GUI
```

**After every change:** `npm run lint && npx tsc --noEmit`

---

# Nexus Terminal

Professional trading terminal and analytics platform (SaaS). Tracks/journals trades, analyzes performance, visualizes market data, AI-assisted analysis via Jarvis.

---

# System Architecture

**Stack:** Next.js 15, React 19, TypeScript 5.9, Vercel deployment

## Frontend
- Single-page app with tab-based layout: Dashboard, Performance, Journal, Trades, Charts, Markets, Research, Backtesting
- Main entry: `app/page.tsx` (client component) orchestrates all tabs
- Styling: Tailwind CSS v4, dark theme (#0A0A0B base, emerald-500 accent)
- Animation: motion/react v12 via AnimatePresence
- UI primitives: Radix UI + shadcn/ui pattern (in `components/ui/`)
- Charts: recharts v3 (analytics), lightweight-charts v5 (candlestick — dynamically imported, SSR disabled)
- Path alias: `@/*` maps to project root

## Backend
- Next.js API routes under `app/api/`
- Auth: NextAuth v5 beta (5.0.0-beta.30), Google OAuth, JWT sessions
- All routes protected via `requireUser()` in `lib/server-db-utils.ts` except `/api/health`
- Middleware in `middleware.ts` protects all routes except `/login`, `/api/*`, static assets

## Database
- PostgreSQL via Neon serverless (`@neondatabase/serverless`)
- ORM: Drizzle v0.45.1, schema at `lib/db/schema.ts`
- Extensions: pgvector (1024-dim), tsvector full-text search
- Connection: HTTP client for reads, WebSocket pool for transactions
- Migrations output to `drizzle/` directory

### Tables (19)
users, trades (composite PK: user_id + id), trade_executions, trade_tags, tags,
trade_import_batches, broker_sync_log, agent_memory, research_reports,
imported_research_reports, daily_ticker_summaries, saved_tickers, market_snapshots,
macro_summaries, jarvis_conversations, jarvis_request_log, schwab_links,
realtime_quotes, scanner_presets

---

# API Routes

## Trades
- GET/POST `/api/trades`
- GET/PATCH/DELETE `/api/trades/[id]`
- POST `/api/trades/bulk`
- POST `/api/trades/import`

## Tags
- GET/POST/DELETE `/api/tags`

## Saved Tickers
- GET/POST/DELETE `/api/saved-tickers`

## Market Data
- GET `/api/market-data` (Massive API proxy)
- GET/POST `/api/market-data/daily-summary`
- GET `/api/market-data/snapshot`

## Jarvis AI
- POST `/api/jarvis/chat`, `/api/jarvis/research`, `/api/jarvis/trade-analysis`
- GET/DELETE `/api/jarvis/admin/memory`
- GET `/api/jarvis/admin/stats` (admin-only via x-jarvis-admin-key header)
- GET `/api/jarvis/macro-summary/latest`

## Schwab
- GET `/api/schwab/auth` (OAuth initiation)
- GET `/api/schwab/callback` (OAuth callback)
- GET/DELETE `/api/schwab/status` (link status + unlink)

## Scanner
- GET `/api/scanner` (query realtime_quotes with filters)
- GET/POST/DELETE `/api/scanner/presets`

## System
- GET/POST `/api/auth/[...nextauth]`
- GET `/api/health`
- GET `/api/jarvis/cron/macro-summary` (Vercel cron, CRON_SECRET auth)

## Discord
- POST `/api/discord/import` (bulk import research reports from Discord channel)
- GET `/api/discord/import` (list imported reports, ?ticker=X&limit=N)
- POST `/api/discord/sync` (incremental sync — new messages since last import)

## Empty/legacy directories (do not add routes without explicit instruction)
backtest/, cron/, notifications/, webhooks/

---

# Key Modules

## Core
- `lib/server-db-utils.ts` — `requireUser()`, `ensureUser()` — all API routes must use these
- `lib/auth-config.ts` — NextAuth config
- `lib/trading-utils.ts` — formatCurrency, formatR, calculatePnL
- `lib/csv-parser.ts` — CSV parsing with broker auto-detection
- `lib/parsers/` — pluggable parser system (DAS Trader, generic)
- `lib/indicators.ts` — SMA, EMA, RSI, MACD, VWAP, Bollinger

## State Management
- `hooks/use-trades.ts` — central trade hook: CRUD, filtering, CSV import, dual localStorage/cloud sync
- `hooks/use-candle-data.ts` — market data fetching with cache
- `hooks/use-mobile.ts` — responsive breakpoint detection

## Jarvis AI Pipeline (lib/jarvis/)
- `lib/jarvis/client.ts` — LLM wrapper with retry + circuit breaker
- `lib/jarvis/types.ts` — shared types (JarvisMode, JarvisRequest, JarvisResponse)
- `lib/jarvis/prompts.ts` — system/user prompt construction
- `lib/jarvis/context.ts` — conversation context assembly
- `lib/jarvis/memory.ts` — persistent user memory CRUD
- `lib/jarvis/research.ts` — research orchestration
- `lib/jarvis/trade-analysis.ts` — trade analysis pipeline
- `lib/jarvis/askedgar.ts` — AskEdgar API client
- `lib/jarvis/scrape-lite.ts` — lightweight web scraping
- `lib/jarvis/rate-limit.ts` — per-user rate limiting (30 req/hr)
- `lib/jarvis/circuit-breaker.ts` — LLM failure circuit breaker
- `lib/jarvis/token-tracking.ts` — per-request token/latency logging
- `lib/jarvis/admin.ts` — admin stats and memory management

## Discord
- `lib/discord/client.ts` — Discord REST API client (fetch channel messages, pagination)
- `lib/discord/parser.ts` — Research report parser (extracts ticker, price, float, risk ratings from Discord embeds)

## Schwab
- `lib/schwab/crypto.ts` — AES-256-GCM token encrypt/decrypt
- `lib/schwab/auth.ts` — OAuth URL generation, code exchange, token refresh
- `services/schwab-relay/` — Standalone streaming relay service (Fly.io), auto-subscribes imported research tickers

## Tests
- All in `__tests__/` directory, run via vitest
- Tests cover: parsers, indicators, API routes, Jarvis pipeline, schema isolation

---

# Sprint 8 — Dilution Research Pack (Planned, Not Yet Built)

AskEdgar API integration for on-demand dilution research reports.
- API: `https://eapi.askedgar.io` — auth via ASKEDGAR_API_KEY
- New mode: `dilution-research` through orchestration engine
- API docs: `docs/AE_API_DOCS.md`

---

# Known Issues
1. Empty legacy API directories remain from removed backtest features
2. NextAuth v5 is pre-release (5.0.0-beta.30) — watch for breaking changes
3. Vercel Hobby tier limits cron to daily; macro headlines may be stale by market close

---

# Development Rules
1. Preserve existing architecture — no large refactors unless explicitly requested
2. All new API routes must call `requireUser()` and return 401 on failure
3. Never access DB directly from client components — server-only via API routes or server actions
4. Maintain TypeScript strict typing throughout
5. Prefer modular code — no logic in `page.tsx` or `layout.tsx`
6. Run lint and type-check after every change: `npm run lint && npx tsc --noEmit`
7. Avoid unnecessary dependencies

# Security Rules
- Secrets via environment variables only — never expose .env, .env.local, API keys, or OAuth secrets
- ASKEDGAR_API_KEY must only be read server-side — never in client components
- Do not log sensitive data or commit secrets to Git

---

# Agent Workflow

**Plan agent:** Architecture planning, writing implementation specs, auditing codebase, producing prompts for opencode.

**opencode:** Implements code from specs, fixes lint/type errors, writes/runs tests, runs migrations.

Workflow: Plan designs → Plan writes spec → opencode implements → opencode runs lint/type-check/tests → Plan reviews architecture integrity.
