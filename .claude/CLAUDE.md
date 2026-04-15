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

Personal trading terminal for a small private team. Not SaaS — purpose-built for my coworkers and me. Tracks/journals trades, analyzes performance, visualizes market data, and supports research workflows.

---

# System Architecture

**Stack:** Next.js 15, React 19, TypeScript 5.9, Vercel deployment

## Frontend
- Single-page app with tab-based layout — see Tab Mapping below
- Main entry: `app/page.tsx` (client component) orchestrates all tabs
- Styling: Tailwind CSS v4, dark theme (#0A0A0B base, emerald-500 accent)
- Animation: motion/react v12 via AnimatePresence
- UI primitives: Radix UI + shadcn/ui pattern (in `components/ui/`)
- Charts: recharts v3 (analytics), lightweight-charts v5 (candlestick — dynamically imported, SSR disabled)
- Path alias: `@/*` maps to project root

### Tab Mapping
| Tab key | Component | Layout |
|---------|-----------|--------|
| `dashboard` | `DashboardTab` | Default, max-w-7xl |
| `performance` | `PerformanceTab` | max-w-7xl |
| `journal` | `JournalTab` | max-w-7xl |
| `filter` | `TradesTab` | max-w-7xl |
| `charts` | `ChartsTab` | Full-width |
| `research` | `ResearchTab` | Full-width |

## Backend
- Next.js API routes under `app/api/` — run `find app/api -name route.ts` to list all 25 routes
- Auth: NextAuth v5 beta (5.0.0-beta.30), Google OAuth, JWT sessions
- All routes protected via `requireUser()` except `/api/health`
- Middleware in `middleware.ts` protects all routes except `/login`, `/api/*`, static assets

### requireUser()
Import from `lib/server-db-utils.ts`. Returns `{ user: { id, email, name, picture } }` or `{ error: Response }` (401). Destructure and early-return on error in every route.

## Database
- PostgreSQL via Neon serverless (`@neondatabase/serverless`)
- ORM: Drizzle v0.45.1, schema at `lib/db/schema.ts` (23 tables — read schema directly for details)
- Connection: HTTP client for reads, WebSocket pool for transactions
- Migrations output to `drizzle/` directory

---

# Key Modules

## Core
- `lib/server-db-utils.ts` — `requireUser()`, `ensureUser()` — all API routes must use these
- `lib/auth-config.ts` — NextAuth config
- `lib/types.ts` — Centralized type definitions (Trade, ResearchSnapshot, etc.)
- `lib/db.ts` — Database connection bootstrapping (HTTP + WebSocket pool)
- `lib/sse.ts` — `createSSEResponse` helper for Server-Sent Events routes
- `lib/api-route-utils.ts` — `parseAndValidate()` Zod request parsing helper
- `lib/askedgar-utils.ts` — AskEdgar response normalization utilities
- `lib/time-utils.ts` — Shared date/time formatting utilities
- `lib/validations/trades.ts`, `lib/validations/system.ts` — Zod schemas for API input validation
- `lib/trading-utils.ts` — formatCurrency, formatR, calculatePnL, buildTradeMarkers, getPnLColor, getPnLHex
- `lib/trade-utils.ts` — Trade-specific utilities (normalizeTrade, sortTradesByDate, toApiTrade, fromApiTrade, collectImportedTrades, apiRequest)
- `lib/chart-timeframes.ts` — Chart timeframe configs shared across all chart components
- `lib/csv-parser.ts` — CSV parsing with broker auto-detection
- `lib/parsers/` — pluggable parser system (DAS Trader, generic)
- `lib/indicators.ts` — SMA, EMA, RSI, MACD, VWAP, Bollinger, ATR
- `lib/llm-client.ts` — shared LLM client for research generation (`callLlm`, `callLlmStreaming`)
- `lib/research.ts` — research report assembly and TLDR helpers
- `lib/askedgar.ts` — AskEdgar client with shared cache helpers

## State Management
Hooks in `hooks/` (7 files). Key ones:
- `use-trades.ts` — central trade hook: CRUD, filtering, CSV import, cloud sync
- `use-candle-data.ts` — market data fetching with cache
- `use-chart-drawings.ts` — chart drawing state and persistence helpers
- `use-global-shortcuts.ts` — app-wide keyboard shortcut bindings
- `use-mobile.ts` — responsive mobile breakpoint helper
- `use-trade-filters.ts` — isolated trade filter/search state
- `use-trade-sync.ts` — trade persistence helpers

## Discord
- `lib/discord/client.ts` — Discord REST API client (fetch channel messages, pagination)
- `lib/discord/parser.ts` — Research report parser (extracts ticker, price, float, risk ratings from Discord embeds)

## AskEdgar (Dilution Research)
- `lib/askedgar.ts` — AskEdgar API client (`https://eapi.askedgar.io`)
- Routes: `/api/askedgar/lookup`, `/api/askedgar/snapshot`, `/api/askedgar/tldr`
- API docs: `docs/AE_API_DOCS.md`

## TradingView Screener
- Route: `/api/tradingview/gainers` — top gainers with preset filters
- Env var: `TRADINGVIEW_SESSION_ID` — enables real-time data (optional, falls back to 15-min delayed)

## Tests
- All in `__tests__/` directory, run via vitest
- Tests cover: parsers, indicators, API routes, research flows, schema isolation

---

# Environment Variables

Names only — values in `.env.local` (never committed):

| Category | Variables |
|----------|-----------|
| Auth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` |
| Database | `DATABASE_URL` |
| Market Data | `MASSIVE_API_KEY`, `TRADINGVIEW_SESSION_ID` |
| Discord | `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID` |
| AskEdgar | `ASKEDGAR_API_KEY` |
| Cron | `CRON_SECRET` |
| Tuning (optional) | `ASKEDGAR_DAILY_LIMIT` |

---

## Services (Docker / Home Server)
- `services/discord-bot/` — Discord bot for agent chat (AEV2, not yet built)
- `services/.env.example` — All agent service env vars (copy to `services/.env`)
- `services/docker-compose.yml` — Agent container topology (AEV2, not yet built)
- Services deploy independently from Vercel — they run on a home server via Docker Compose

## Trade Example Seed System
- `scripts/generate-trade-template.ts` — Parses screenshot filenames → blank annotation JSON
- `scripts/trade-screenshots/` — Reference images (gitignored)
- `scripts/trade-examples-template.json` — Auto-generated template (gitignored)
- `scripts/trade-examples-reviewed.json` — Human-annotated final version (gitignored)
- `scripts/seed-trade-examples.ts` — Loads reviewed trades into `agent_memory` (not yet built)

---

# Known Issues
1. NextAuth v5 is pre-release (5.0.0-beta.30) — watch for breaking changes

---

# Development Rules
1. Preserve existing architecture — no large refactors unless explicitly requested
2. All new API routes must call `requireUser()` and return 401 on failure
3. Never access DB directly from client components — server-only via API routes or server actions
4. Maintain TypeScript strict typing throughout
5. Prefer modular code — no logic in `page.tsx` or `layout.tsx`
6. Run lint and type-check after every change: `npm run lint && npx tsc --noEmit`
7. Avoid unnecessary dependencies
8. When adding/removing API routes, DB tables, hooks, or research modules, update the corresponding counts and lists in this file. Run `/audit` periodically to catch drift.

# Security Rules
- Secrets via environment variables only — never expose .env, .env.local, API keys, or OAuth secrets
- ASKEDGAR_API_KEY must only be read server-side — never in client components
- Do not log sensitive data or commit secrets to Git
