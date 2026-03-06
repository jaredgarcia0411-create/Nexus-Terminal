# Nexus Terminal — Handoff

**Generated:** 2026-03-05  
**Branch:** `main`

## Current State

The codebase has been streamlined to a lean core focused on journaling, analytics, and Jarvis assistance.

### Completed Refactor

- Removed Schwab-specific integration and OAuth routes.
- Removed backtesting UI, engine, API routes, and worker/gateway services.
- Removed MFE/MAE recomputation flow and related tests/files.
- Introduced generic market data endpoint at `app/api/market-data/route.ts`.
- Updated price alert evaluator to use non-Schwab market data fetch path.

### Navigation and Filtering

- Desktop sidebar now displays labels next to icons.
- Active tabs are now: `dashboard`, `journal`, `performance`, `filter`, `jarvis`.
- Time presets moved to global header controls in `components/trading/Toolbar.tsx`:
  - `All`, `30D`, `60D`, `90D`
- Filter page now focuses on date-range and tag filtering (presets removed from that page).

### Journal UX Enhancements

- Expanded day cards in `JournalTab` now render per-trade replay charts.
- New component: `components/trading/JournalTradeChart.tsx`.
- Each chart overlays execution markers using `rawExecutions` when available.
- Chart rendering is progressive per day card (batched "Load more") to prevent heavy initial render cost.
- Trade table gains vertical scroll behavior when more than 20 rows are present.

### Jarvis (AI Assistant)

- Jarvis tab and API are live:
  - `components/trading/JarvisTab.tsx`
  - `app/api/jarvis/route.ts`
- Jarvis capabilities:
  - daily summary
  - trade analysis
  - free-form assistant requests
  - optional multi-page web scraping context (up to 5 URLs)
- Jarvis URL UX now includes line-by-line validation feedback in `components/trading/JarvisTab.tsx`:
  - inline per-line highlighting for invalid URL rows (requires full `http://` or `https://` format)
  - ignores duplicate URLs
  - shows when valid URLs exceed the 5-link scrape cap
- Jarvis now stores URL memory per user:
  - New table: `jarvis_source_urls` (composite key `user_id + url`)
  - API route `app/api/jarvis/route.ts` now supports `GET` to fetch remembered URLs
  - `POST` upserts submitted scrape URLs and updates recency/use count
  - UI renders remembered URLs as quick-add chips in `components/trading/JarvisTab.tsx`
- Model/provider defaults now target GLM-4.7 configuration:
  - `JARVIS_MODEL=glm-4.7`
  - `JARVIS_API_BASE_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions`
  - `JARVIS_API_KEY` for live responses

### Authentication and Access Control

- Auth flow now uses NextAuth Credentials (User ID + Password) instead of Google OAuth.
- Added account registration endpoint at `app/api/auth/register/route.ts`.
- Added password hashing utilities in `lib/password.ts` (PBKDF2 via Web Crypto).
- Added `user_credentials` table in `lib/db/schema.ts` and migration SQL:
  - `drizzle/0001_user_credentials.sql`
- Middleware now gates UI pages until authenticated and excludes `/api/*` so service/webhook endpoints retain their own auth flow.
- Sign out now redirects to `/login` and ends the active session.

## Validation Snapshot (2026-03-05)

- `npm run build` passed
- `npm test` passed (**12 files, 69 tests**)
- `npm run db:migrate` should be run to apply credential and Jarvis memory tables

## Known Follow-ups

1. Perform a signed-in browser QA pass for:
- per-trade journal chart loading behavior on large days
- header preset behavior across all tabs
- mobile toolbar wrapping and button density

2. If trade volume becomes very large, consider pagination/virtualization for journal and table-heavy views.

## Primary Files Touched in Latest Rollout

- `app/page.tsx`
- `app/api/jarvis/route.ts`
- `app/api/market-data/route.ts`
- `app/api/trades/route.ts`
- `components/trading/Sidebar.tsx`
- `components/trading/Toolbar.tsx`
- `components/trading/FilterTab.tsx`
- `components/trading/JournalTab.tsx`
- `components/trading/JournalTradeChart.tsx`
- `components/trading/TradeTable.tsx`
- `hooks/use-candle-data.ts`
- `lib/auth-config.ts`
- `lib/password.ts`
- `lib/db/schema.ts`
- `app/api/auth/register/route.ts`
- `app/login/page.tsx`
- `middleware.ts`
- `drizzle/0001_user_credentials.sql`
- `drizzle/meta/_journal.json`
- `.env.example`
- `README.md`
