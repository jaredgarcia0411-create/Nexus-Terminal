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

### Tables (11)
users, trades (composite PK: user_id + id), trade_executions, trade_tags, tags, trade_import_batches, broker_sync_log, agent_memory, research_reports, macro_summaries, jarvis_conversations, jarvis_request_log

---

# API Routes

## Trades
- GET/POST `/api/trades`
- GET/PATCH/DELETE `/api/trades/[id]`
- POST `/api/trades/bulk`
- POST `/api/trades/import`

## Tags
- GET/POST/DELETE `/api/tags`

## Market Data
- GET `/api/market-data` (Massive API proxy)

## Jarvis AI
- POST `/api/jarvis/chat`, `/api/jarvis/research`, `/api/jarvis/trade-analysis`
- GET/DELETE `/api/jarvis/admin/memory`
- GET `/api/jarvis/admin/stats` (admin-only via x-jarvis-admin-key header)

## System
- GET/POST `/api/auth/[...nextauth]`
- GET `/api/health`
- GET `/api/jarvis/cron/macro-summary` (Vercel cron, CRON_SECRET auth)

## Empty/legacy directories (do not add routes without explicit instruction)
backtest/, cron/, discord/, notifications/, schwab/, webhooks/

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

## Jarvis AI Pipeline
- `lib/jarvis-types.ts` — shared types (JarvisMode, JarvisRequest, JarvisResponse)
- `lib/jarvis/client.ts` — LLM wrapper with retry + circuit breaker
- `lib/jarvis-knowledge.ts` — knowledge ingestion/retrieval/eviction
- `lib/jarvis-scrape.ts` — web scraping, chunking, ranking
- `lib/jarvis-embedding.ts` — NVIDIA embedding API
- `lib/jarvis-response.ts` — LLM response parsing
- `lib/jarvis-allowlist.ts` — domain allowlist with trust scoring
- `lib/jarvis-source-packs.ts` — source pack registry

## Jarvis Safety & Observability
- `lib/jarvis-rate-limit.ts` — per-user rate limiting (30 req/hr, in-memory)
- `lib/jarvis-token-tracking.ts` — per-request token/latency logging
- `lib/jarvis-circuit-breaker.ts` — LLM failure circuit breaker (5 failures → open, 60s reset)
- `lib/jarvis-robots.ts` — robots.txt compliance with 1h cache

## Tests
- All in `__tests__/` directory, run via vitest
- Tests cover: parsers, indicators, API routes, Jarvis pipeline, schema isolation

---

# Sprint 8 — Dilution Research Pack (Planned, Not Yet Built)

AskEdgar API integration for on-demand dilution research reports.
- API: `https://eapi.askedgar.io` — auth via ASKEDGAR_API_KEY
- New mode: `dilution-research` through orchestration engine
- Detailed spec: `docs/SPRINT_8_SPEC.md`, API docs: `docs/AE_API_DOCS.md`

---

# Known Issues
1. ALLOWED_EMAILS is documented in .env.example but not enforced in auth callbacks
2. Empty legacy API directories remain from removed Schwab/Discord/backtest features
3. NextAuth v5 is pre-release (5.0.0-beta.30) — watch for breaking changes
4. Vercel Hobby tier limits cron to daily; macro headlines may be stale by market close

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
