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

Personal trading terminal for a small private team. Not SaaS — purpose-built for my coworkers and me. Tracks/journals trades, analyzes performance, visualizes market data, AI-assisted analysis via Jarvis.

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
| `markets` | `MarketsTab` | max-w-7xl |
| `research` | `ResearchTab` | Full-width |
| `jarvis` | `JarvisTab` | max-w-7xl |

## Backend
- Next.js API routes under `app/api/` — run `find app/api -name route.ts` to list all 32 routes
- Auth: NextAuth v5 beta (5.0.0-beta.30), Google OAuth, JWT sessions
- All routes protected via `requireUser()` except `/api/health`
- Middleware in `middleware.ts` protects all routes except `/login`, `/api/*`, static assets

### requireUser()
Import from `lib/server-db-utils.ts`. Returns `{ user: { id, email, name, picture } }` or `{ error: Response }` (401). Destructure and early-return on error in every route.

## Database
- PostgreSQL via Neon serverless (`@neondatabase/serverless`)
- ORM: Drizzle v0.45.1, schema at `lib/db/schema.ts` (21 tables — read schema directly for details)
- Connection: HTTP client for reads, WebSocket pool for transactions
- Migrations output to `drizzle/` directory

---

# Key Modules

## Core
- `lib/server-db-utils.ts` — `requireUser()`, `ensureUser()` — all API routes must use these
- `lib/auth-config.ts` — NextAuth config
- `lib/trading-utils.ts` — formatCurrency, formatR, calculatePnL
- `lib/csv-parser.ts` — CSV parsing with broker auto-detection
- `lib/parsers/` — pluggable parser system (DAS Trader, generic)
- `lib/indicators.ts` — SMA, EMA, RSI, MACD, VWAP, Bollinger, ATR

## Jarvis AI Pipeline
All modules in `lib/jarvis/` — client, types, prompts, context, memory, research, trade-analysis, askedgar, historical-summary, scrape-lite, rate-limit, circuit-breaker, token-tracking, admin, chat-helpers.

## State Management
Hooks in `hooks/` — `ls hooks/` to see all. Key ones:
- `use-trades.ts` — central trade hook: CRUD, filtering, CSV import, cloud sync
- `use-candle-data.ts` — market data fetching with cache
- `use-market-stream.ts` — SSE market data stream
- `use-relay-socket.ts` — WebSocket connection to Schwab relay

## Discord
- `lib/discord/client.ts` — Discord REST API client (fetch channel messages, pagination)
- `lib/discord/parser.ts` — Research report parser (extracts ticker, price, float, risk ratings from Discord embeds)

## Schwab
- `lib/schwab/crypto.ts` — AES-256-GCM token encrypt/decrypt
- `lib/schwab/auth.ts` — OAuth URL generation, code exchange, token refresh
- `services/schwab-relay/` — Standalone streaming relay service (Fly.io), auto-subscribes imported research tickers
- **Schwab streaming sends partial updates** — only changed fields per tick. DB upserts must use `COALESCE(excluded.col, table.col)` to avoid nulling out good data.
- **Relay deploys separately** — `cd services/schwab-relay && fly deploy`. Changes here do NOT deploy via Vercel push.

## AskEdgar (Dilution Research)
- `lib/jarvis/askedgar.ts` — AskEdgar API client (`https://eapi.askedgar.io`)
- Routes: `/api/askedgar/lookup`, `/api/askedgar/tldr`, `/api/askedgar/gainers`
- API docs: `docs/AE_API_DOCS.md`

## Tests
- All in `__tests__/` directory, run via vitest
- Tests cover: parsers, indicators, API routes, Jarvis pipeline, schema isolation

---

# Environment Variables

Names only — values in `.env.local` (never committed):

| Category | Variables |
|----------|-----------|
| Auth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, `NEXTAUTH_SECRET` |
| Database | `DATABASE_URL` |
| Jarvis/LLM | `JARVIS_API_KEY`, `JARVIS_API_BASE_URL`, `JARVIS_MODEL`, `JARVIS_ADMIN_KEY` |
| Market Data | `MASSIVE_API_KEY` |
| Schwab | `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, `SCHWAB_REDIRECT_URI`, `SCHWAB_TOKEN_ENCRYPTION_KEY` |
| Schwab Relay | `RELAY_WS_SECRET`, `RELAY_WS_URL` (separate Fly.io env) |
| Discord | `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID` |
| AskEdgar | `ASKEDGAR_API_KEY` |
| Cron | `CRON_SECRET` |
| Tuning (optional) | `ASKEDGAR_DAILY_LIMIT`, `JARVIS_CIRCUIT_BREAKER_THRESHOLD`, `JARVIS_CIRCUIT_BREAKER_RESET_MS`, `JARVIS_RATE_LIMIT_PER_HOUR`, `JARVIS_TIMEOUT_MS` |

---

# Known Issues
1. Legacy API stubs with empty subdirectories: app/api/backtest/, app/api/cron/alerts/, app/api/notifications/process/, app/api/webhooks/trade-event/ — do not add routes without explicit instruction
2. NextAuth v5 is pre-release (5.0.0-beta.30) — watch for breaking changes
3. Vercel Hobby tier limits cron to daily; macro headlines may be stale by market close

# Realtime Data Debugging

When scanner shows "15-MIN DELAYED" instead of "LIVE", check in order:
1. `/api/schwab/status` → must return `{ linked: true }`
2. `realtime_quotes` table must have rows with `updated_at` < 5 minutes old
3. `/api/market-data/snapshot` → must return `dataSource: 'realtime'`
4. Fly relay health: `fly logs --app nexus-schwab-relay` / `fly status --app nexus-schwab-relay`

---

# Development Rules
1. Preserve existing architecture — no large refactors unless explicitly requested
2. All new API routes must call `requireUser()` and return 401 on failure
3. Never access DB directly from client components — server-only via API routes or server actions
4. Maintain TypeScript strict typing throughout
5. Prefer modular code — no logic in `page.tsx` or `layout.tsx`
6. Run lint and type-check after every change: `npm run lint && npx tsc --noEmit`
7. Avoid unnecessary dependencies
8. When adding/removing API routes, DB tables, hooks, or Jarvis modules, update the corresponding counts and lists in this file. Run `/audit` periodically to catch drift.

# Security Rules
- Secrets via environment variables only — never expose .env, .env.local, API keys, or OAuth secrets
- ASKEDGAR_API_KEY must only be read server-side — never in client components
- Do not log sensitive data or commit secrets to Git
