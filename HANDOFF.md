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
  - optional single-page web scraping context
- Model/provider defaults now target GLM-4.7 configuration:
  - `JARVIS_MODEL=glm-4.7`
  - `JARVIS_API_BASE_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions`
  - `JARVIS_API_KEY` for live responses

## Validation Snapshot (2026-03-05)

- `npm run build` passed
- `npm test` passed (**12 files, 69 tests**)

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
- `.env.example`
- `README.md`
