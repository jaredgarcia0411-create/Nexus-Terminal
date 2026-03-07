# Nexus Terminal — Current Implementation State

## Product Direction

Nexus Terminal is now intentionally lean:

- trade journaling and analytics
- filtering and tagging workflows
- Jarvis personal assistant

Schwab-specific broker coupling and bundled backtesting infrastructure were removed from the base product.

## What Is Implemented

1. Core App Simplification
- Removed Schwab routes and token logic
- Removed backtesting UI/routes/engines/workers
- Removed MFE/MAE recalc pipeline from active UX

2. Navigation + Filtering UX
- Desktop sidebar now uses labeled nav items
- Global time presets moved into header toolbar (`All`, `30D`, `60D`, `90D`)
- Filter tab now centers on date-range + tag controls

3. Journal Visualization Enhancements
- Journal day cards include per-trade replay charts
- New `JournalTradeChart` renders candle data with execution overlays
- Journal charts render progressively per day card using batched loading
- Trade table supports vertical scrolling for large result sets (`>20` rows)

4. Jarvis Assistant
- Jarvis UI and API support:
  - daily summary
  - trade analysis
  - free-form assistant mode
  - optional URL scraping context
- Provider defaults now target DeepSeek V3.2 on NVIDIA:
  - `JARVIS_MODEL=deepseek-v3.2`
  - `JARVIS_API_BASE_URL=https://integrate.api.nvidia.com/v1`
  - `JARVIS_API_KEY` or `NVIDIA_API_KEY`

5. Market Data
- Added generic market data API at `app/api/market-data/route.ts`
- Candle data hook updated to use `/api/market-data`

## Validation Baseline (2026-03-05)

- `npm run build` passed
- `npm test` passed (12 files, 69 tests)

## Important Active Files

- `app/page.tsx`
- `app/api/jarvis/route.ts`
- `app/api/market-data/route.ts`
- `app/api/trades/route.ts`
- `components/trading/Toolbar.tsx`
- `components/trading/Sidebar.tsx`
- `components/trading/JournalTab.tsx`
- `components/trading/JournalTradeChart.tsx`
- `components/trading/TradeTable.tsx`
- `components/trading/FilterTab.tsx`
- `hooks/use-candle-data.ts`
- `hooks/use-trades.ts`
- `.env.example`

## Remaining Manual QA

- Check chart density/performance on heavy journal days
- Check mobile toolbar behavior with preset buttons
- Validate Jarvis provider credentials in deployed environment
