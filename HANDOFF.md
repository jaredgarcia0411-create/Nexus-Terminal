# Nexus Terminal — Handoff

**Generated:** 2026-03-06  
**Branch:** `main`

## Current State

The app is currently focused on trading journal workflows, analytics, filtering, Jarvis assistance, and notifications/alerts integrations.

### Product Surface

- Active tabs: `dashboard`, `journal`, `performance`, `filter`, `jarvis`
- Global time presets in header (`All`, `30D`, `60D`, `90D`)
- Journal day cards include per-trade replay charts with execution overlays
- Replay chart loading is progressive per day card for performance
- Trade table uses vertical scroll behavior on larger row counts
- Jarvis supports summary/analysis/assistant modes with optional URL scraping context (max 5)
- Jarvis URL input includes per-line validation, duplicate handling, overflow messaging, and remembered URL chips

### API and Integrations

- Market data endpoint: `app/api/market-data/route.ts`
- Trade APIs: list/create/update/delete, bulk, import, tag management
- Jarvis API: `app/api/jarvis/route.ts` with remembered URL reads/writes
- Discord + notification endpoints are present (`/api/discord/*`, `/api/notifications/*`, `/api/cron/alerts`, `/api/webhooks/trade-event`)

### Authentication and Access Control (Current Runtime)

- NextAuth v5 is configured with Google provider in `lib/auth-config.ts`
- Login page triggers `signIn('google')` in `app/login/page.tsx`
- Middleware protects app UI routes and excludes `/api/*` + `/login`
- Sign out redirects to `/login`

## Database and Schema Snapshot

- Drizzle schema source of truth: `lib/db/schema.ts`
- Drizzle config uses the same path: `drizzle.config.ts` -> `./lib/db/schema.ts`
- Current migrations in repo:
  - `drizzle/0000_motionless_catseye.sql`
  - `drizzle/0001_nosy_nebula.sql`
- `0001_nosy_nebula.sql` changes:
  - converts `user_id` columns from `uuid` to `text`
  - adds `users.name`
- `jarvis_source_urls` table exists for remembered Jarvis links

## Docs Updated This Session

- Added canonical stack/schema reference: `TECHSTACK.md`
- Updated project docs to match current runtime behavior: `README.md`

## Validation Snapshot

- Latest historical note (from prior handoff):
  - `npm run build` passed
  - `npm test` passed (12 files, 69 tests)
- Suggested re-check when picking up next dev cycle:
  - `npm test`
  - `npm run build`
  - `npm run db:migrate`

## Known Follow-ups

1. Run signed-in browser QA pass for:
- per-trade replay performance on large trading days
- preset behavior across all tabs
- mobile toolbar density/wrapping

2. If trade volume grows materially, consider pagination/virtualization for journal and other table-heavy views.

## Primary Files to Reference Next Session

- `TECHSTACK.md`
- `README.md`
- `app/page.tsx`
- `app/login/page.tsx`
- `components/trading/Sidebar.tsx`
- `components/trading/Toolbar.tsx`
- `components/trading/JournalTab.tsx`
- `components/trading/JournalTradeChart.tsx`
- `components/trading/JarvisTab.tsx`
- `app/api/jarvis/route.ts`
- `app/api/market-data/route.ts`
- `app/api/trades/route.ts`
- `lib/auth-config.ts`
- `middleware.ts`
- `lib/db/schema.ts`
- `drizzle.config.ts`
- `drizzle/0000_motionless_catseye.sql`
- `drizzle/0001_nosy_nebula.sql`
