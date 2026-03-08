# Nexus Terminal

Nexus Terminal is a professional trading terminal and analytics platform built as a SaaS web application.

Primary goals:
- Track and journal trades
- Analyze trading performance
- Visualize market data
- AI-assisted trade analysis via Jarvis

Target users:
- Discretionary traders
- Quantitative traders
- Performance analysts

---

# System Architecture

Framework: Next.js 15, React 19, TypeScript 5.9, deployed on Vercel

## Frontend
- Tab-based layout: Dashboard, Performance, Journal, Trades, Jarvis
- Styling: Tailwind CSS v4, dark theme (#0A0A0B base, emerald-500 accent)
- Animation: motion/react v12 via AnimatePresence
- Icons: lucide-react
- UI primitives: Radix UI + shadcn/ui pattern (button, command, dialog, dropdown-menu, input, label, popover, select, sheet, textarea)
- Charts: recharts v3, lightweight-charts v5 (CandlestickChart)

## Backend
- Next.js API routes under app/api/
- Auth: NextAuth v5 beta (5.0.0-beta.30), Google OAuth, JWT sessions
- All routes protected via requireUser() in lib/server-db-utils.ts except /api/health
- Middleware in middleware.ts protects all routes except /login, /api/*, static assets

## Database
- PostgreSQL via Neon serverless
- ORM: Drizzle v0.45.1
- Extensions: pgvector (1024-dim), tsvector full-text search
- Connection: HTTP client for reads, WebSocket pool for transactions

### Tables (10)
- users — Google OAuth accounts
- trades — composite PK (user_id, id)
- trade_executions — individual executions within trades
- trade_tags — trade-to-tag associations
- tags — user-defined tags
- trade_import_batches — import deduplication
- broker_sync_log — broker sync history
- jarvis_source_urls — remembered URLs for Jarvis
- jarvis_knowledge_chunks — knowledge base with embeddings
- jarvis_user_documents — user-uploaded documents

---

# API Routes (13 active endpoints)

## Trades
- GET/POST     /api/trades
- GET/PATCH/DELETE /api/trades/[id]
- POST         /api/trades/bulk
- POST         /api/trades/import

## Tags
- GET/POST/DELETE /api/tags

## Market Data
- GET /api/market-data  (Yahoo Finance proxy)

## Jarvis AI
- GET/POST         /api/jarvis  (summary/analysis/assistant modes)
- GET/POST/DELETE  /api/jarvis/upload
- GET              /api/jarvis/admin/memory/stats
- DELETE           /api/jarvis/admin/memory/purge

## Jarvis Cron
- GET /api/jarvis/cron/headlines  (Vercel cron, CRON_SECRET auth)

## System
- GET/POST /api/auth/[...nextauth]
- GET      /api/health

## Empty/legacy directories (do not add routes here without explicit instruction)
backtest/, cron/, discord/, notifications/, schwab/, webhooks/

---

# Components (29 total)

## Trading Feature Components (19)
- DashboardTab — main dashboard with stats and charts
- PerformanceTab — analytics with calendar view
- JournalTab — daily journal with trade cards
- TradesTab — trade management and filtering
- JarvisTab — AI assistant interface
- Sidebar — main navigation
- Toolbar — time presets and actions
- TradeTable — sortable trade table
- TradeDetailSheet — slide-out trade details
- CandlestickChart — TradingView-style charts
- PerformanceCharts — P&L visualizations
- JournalTradeChart — journal replay charts
- JarvisStructuredResponse — AI response renderer
- JarvisMacroSummary — macro region summary renderer
- JarvisDocuments — document upload UI
- NewTradeDialog — manual trade entry
- ImportDropdown — import options menu
- SettingsMenu — export/clear settings
- TradingCalendar — monthly calendar view

## UI Primitives (10)
button, command, dialog, dropdown-menu, input, label, popover, select, sheet, textarea

---

# Hooks
- useTrades — trade CRUD, filtering, CSV import, cloud/local sync
- useCandleData — market data fetching with cache
- useIsMobile — responsive detection

---

# Key Service Modules
- lib/auth-config.ts — NextAuth main config
- lib/server-db-utils.ts — requireUser(), ensureUser()
- lib/trading-utils.ts — formatCurrency, formatR, calculatePnL
- lib/csv-parser.ts — CSV parsing with broker auto-detection
- lib/parsers/ — pluggable parser system (DAS Trader, generic)
- lib/indicators.ts — SMA, EMA, RSI, MACD, VWAP, Bollinger
- lib/jarvis-knowledge.ts — knowledge ingestion/retrieval/eviction
- lib/jarvis-orchestrator.ts — multi-step orchestration pipeline (plan, retrieve, summarize, critique, answer)
- lib/jarvis-scrape.ts — web scraping, chunking, ranking
- lib/jarvis-embedding.ts — NVIDIA embedding API
- lib/jarvis-response.ts — LLM response parsing

---

# Known Issues
1. ALLOWED_EMAILS is documented in .env.example but not enforced in auth callbacks
2. Empty legacy API directories remain from removed Schwab/Discord/backtest features
3. NextAuth v5 is pre-release (5.0.0-beta.30) — watch for breaking changes on upgrade
4. Vercel Hobby tier limits cron to daily; macro headlines may be stale by market close

---

# Development Rules
1. Preserve existing architecture — no large refactors unless explicitly requested
2. All new API routes must call requireUser() and return 401 on failure
3. Never access DB directly from client components — server-only via API routes or server actions
4. Maintain TypeScript strict typing throughout
5. Prefer modular code — no logic in page.tsx or layout.tsx
6. Run lint and type-check after every change: npm run lint && npx tsc --noEmit
7. Avoid unnecessary dependencies

# Security Rules
- Never expose .env, .env.local, API keys, or OAuth secrets
- Secrets via environment variables only
- Do not log sensitive data
- Do not commit secrets to Git
- Schwab tokens (if re-added) must never be returned to the client

---

# Agent Workflow

Plan agent responsibilities:
- Architecture planning
- Writing implementation specs
- Auditing codebase state
- Producing prompts for opencode

opencode responsibilities:
- Implementing code from specs
- Fixing lint and type errors
- Writing and running tests
- Running migrations

Workflow:
1. Plan reads codebase and designs solution
2. Plan writes opencode execution spec
3. opencode implements
4. opencode runs lint, type-check, tests
5. Plan reviews architecture integrity of result
