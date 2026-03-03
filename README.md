# Nexus Terminal

A professional-grade trading journal and analysis platform built with Next.js 15, React 19, and TypeScript 5.9. Designed for active traders who need to import, tag, filter, and analyze their executions with performance metrics in both dollar and R-multiple formats.

## Tech Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript 5.9, standalone output
- **Database:** PostgreSQL via Neon with Drizzle ORM. Falls back to localStorage when `DATABASE_URL` is not set.
- **Auth:** Manual JWT sessions (HS256) via `jose`. Google OAuth provider with popup flow.
- **Broker Integration:** Charles Schwab OAuth + token management with per-user mutex, retry logic, and audit logging.
- **Charting:** Recharts v3 for performance analytics.
- **Styling:** Tailwind CSS v4 (dark theme, `#0A0A0B` base, emerald-500 accent), `tw-animate-css`.
- **Animation:** Motion (motion/react) v12 for page transitions.
- **Deployment:** Vercel (recommended). Firebase Tools available as dev dependency.

## Features

### Trade Journal
- CSV import from broker exports with automatic date parsing from filenames (MM-DD-YY pattern).
- Execution matching engine: FIFO pairing of entries and exits per symbol per day. Supports LONG (MARGIN/S) and SHORT (SS/B) sides.
- Bulk operations: multi-select trades, apply initial risk, delete in batch.
- Symbol search across all views.

### Tagging System
- Create, assign, and remove tags per trade.
- Global tag management with delete propagation.
- Filter trades by tag combination.

### Performance Analytics
- Equity curve (cumulative PnL).
- Daily PnL bar chart.
- Performance by day of week.
- Performance by time of day.
- Toggle between dollar ($) and R-multiple (R) metrics across all charts.

### Trading Calendar
- Month view with daily PnL and R-multiple totals per cell.
- Weekly summary column.
- Click any day to expand the full trade list for that date.

### Dashboard
- KPI cards: total PnL, win rate, profit factor, average win/loss, win/loss ratio.
- Recent trades table (top 10).
- Symbol distribution breakdown.
- Risk summary panel.

### Filter Page
- Date range picker (custom start/end).
- Preset filters: last 30, 60, or 90 days.
- Tag-based filtering with multi-select.
- Clear all filters action.

### Backtesting Engine
- Search historical data by symbol.
- Upload context files (.csv, .json, .txt) for strategy parameters.
- Connect Charles Schwab API for historical data retrieval.

### Authentication
- Google OAuth login/logout via popup window.
- JWT session stored in httpOnly secure cookie (24h expiry).
- Session check on page load via `/api/auth/me`.

### Broker Sync
- Schwab OAuth flow with token exchange.
- Sync endpoint at `/api/schwab/sync`.

## Project Structure

```
app/
  page.tsx                          # Main terminal UI, tab orchestration
  api/
    auth/
      google/url/route.ts           # Google OAuth URL generation
      google/callback/route.ts      # Google OAuth callback + session creation
      schwab/url/route.ts           # Schwab OAuth URL generation
      schwab/callback/route.ts      # Schwab OAuth callback + token exchange
      me/route.ts                   # Current session lookup
      logout/route.ts               # Session deletion
    health/route.ts                 # Health check endpoint
    trades/
      route.ts                      # Trades CRUD
      [id]/route.ts                 # Individual trade operations
      bulk/route.ts                 # Bulk trade operations
      import/route.ts               # Trade import
    tags/route.ts                   # Tags API
    schwab/
      sync/route.ts                 # Schwab broker sync

components/trading/
  TradeTable.tsx                    # Sortable table with selection + inline tagging
  PerformanceCharts.tsx             # Four-panel analytics (equity, daily, weekday, time)
  TradingCalendar.tsx               # Month view with daily/weekly PnL summaries

lib/
  auth.ts                           # JWT create/get/delete session (jose)
  env.ts                            # getBaseUrl() resolver
  types.ts                          # Trade, Direction, DateRisk, TradeTags, JournalState
  trading-utils.ts                  # formatCurrency, formatR, calculatePnL, parsePrice
  csv-parser.ts                     # parseDateFromFilename, processCsvData (FIFO matcher)
  db.ts                             # Database connection (Neon + Drizzle)
  db/schema.ts                      # Drizzle schema (users, trades, trade_tags, tags, schwab_tokens, broker_sync_log)
  schwab.ts                         # Schwab API integration (token management, retry, mutex)
  server-db-utils.ts                # Server-side DB utility functions
  __tests__/
    schwab.test.ts                  # Schwab integration tests

drizzle.config.ts                   # Drizzle ORM configuration
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | No | Neon PostgreSQL connection string. Falls back to localStorage if unset. |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth Client Secret |
| `SCHWAB_CLIENT_ID` | Yes | Schwab API Client ID |
| `SCHWAB_CLIENT_SECRET` | Yes | Schwab API Client Secret |
| `JWT_SECRET` | Yes | Random string for JWT session signing |
| `APP_URL` | No | Base URL override. Auto-detected on Vercel. |
| `GEMINI_API_KEY` | No | Google Gemini API key (for future AI features) |

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment file and fill in values
cp .env.example .env

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```

## Deployment (Vercel)

1. Push to GitHub.
2. Import the repo in Vercel.
3. Add environment variables in the Vercel dashboard.
4. Set OAuth redirect URIs:
   - Google: `https://your-app.vercel.app/api/auth/google/callback`
   - Schwab: `https://your-app.vercel.app/api/auth/schwab/callback`

## Still in Testing

The following were stabilized or introduced in the latest commit (`10d329b` — "Stabilize Neon migration and align Drizzle schema") and are still being validated:

- **Neon + Drizzle migration:** Schema for `users`, `trades`, `trade_tags`, `tags`, `schwab_tokens`, `broker_sync_log`. Dual-mode storage (Neon when `DATABASE_URL` is set, localStorage fallback) needs end-to-end verification.
- **RESTful trade API routes:** CRUD (`/api/trades`), individual operations (`/api/trades/[id]`), bulk operations (`/api/trades/bulk`), and import (`/api/trades/import`) are new and under test.
- **Tags API:** `/api/tags` route introduced in this commit.
- **Schwab sync:** `/api/schwab/sync` route and `lib/schwab.ts` token management with per-user mutex and retry logic. Token persistence and refresh flow need production validation.
- **Schwab test suite:** `lib/__tests__/schwab.test.ts` added. Coverage is initial.
- **Health check:** `/api/health` endpoint added.
- **Server DB utilities:** `lib/server-db-utils.ts` added for server-side database operations.
- **Backtesting engine:** UI shell exists (search + file upload + Schwab connect button). No functional backend processing yet.
