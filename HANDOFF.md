# Nexus Terminal — Handoff Document

**Generated:** 2026-03-03
**Last Commit:** `d78514a` — Auth gating, UI refactor, Schwab integration build-out, CSV warning support, dependency cleanup

---

## Project Overview

Nexus Terminal is a trading journal and analytics platform for day traders.

| Layer | Tech |
|-------|------|
| Framework | Next.js 15 (App Router) |
| Frontend | React 19, shadcn/ui, motion/react animations |
| Charts | Recharts (equity curves), lightweight-charts v5 (candlesticks) |
| Auth | NextAuth v5 beta, JWT strategy, Google OAuth, `ALLOWED_EMAILS` env gating |
| Database | Turso (libsql), schema in `lib/db.ts` |
| Broker | Charles Schwab API (OAuth2, token rotation, market data, transaction sync) |
| Services | Docker Compose stack: Redis, Express+BullMQ backtest gateway, Python backtest worker, Discord bot |
| Styling | Tailwind v4, dark theme (#0A0A0B base, emerald-500 accent) |

### Key Directories

```
app/                     Next.js app router pages + API routes
components/trading/      All UI panels (Sidebar, Toolbar, tabs, chart, modals)
hooks/use-trades.ts      Central trade state hook (dual localStorage/cloud mode)
lib/                     Core logic: CSV parsing, indicators, backtesting, Schwab client, DB schema
lib/parsers/             Pluggable broker parser system
lib/backtesting/         Client-side backtest engine + strategy definitions
services/                Docker Compose microservices (backtest-gateway, backtest-worker, discord-bot)
```

### Sidebar Tabs

`dashboard` | `journal` | `performance` | `filter` | `backtesting` | `sync`

---

## Last Commit Summary

**`d78514a`** — Auth gating, UI refactor, Schwab integration build-out, CSV warning support, dependency cleanup

This commit established the authenticated multi-user architecture (NextAuth + Turso), the Schwab OAuth connection flow, and the CSV import pipeline with the existing DAS Trader format. It is the baseline from which all uncommitted work branches.

---

## Modified Files

### `app/api/schwab/market-data/route.ts` (+29 lines)
Made the Schwab price history endpoint flexible. Added configurable query params (`periodType`, `period`, `frequencyType`, `frequency`, `startDate`, `endDate`) with allowlist validation instead of hardcoded 1Y/daily. Enables the new timeframe selector in BacktestingTab.

### `app/page.tsx` (+8 lines)
Wired up the new `BrokerSyncTab` (renders on `activeTab === 'sync'`), added `folderInputRef` and `handleFolderUpload` from `useTrades`, and passed `onFolderImportClick` to Toolbar. Added a hidden `<input webkitdirectory>` element for folder selection.

### `components/trading/BacktestingTab.tsx` (+321/-87 lines)
Major rewrite. Replaced the Recharts line chart with a dynamically-imported `CandlestickChart` (lightweight-charts). Added: timeframe selector (1D/1W/1M/3M/1Y), indicator toggles (SMA20, SMA50, EMA12, EMA26, Bollinger), strategy selector with configurable parameters, client-side backtest execution via `runBacktest()`, and trade marker overlays on the chart. Renders `BacktestResultsPanel` for results.

### `components/trading/Sidebar.tsx` (+11 lines)
Added the `sync` tab to the `TabKey` type union and added a `RefreshCw` icon button in the sidebar nav linking to the new Broker Sync tab.

### `components/trading/Toolbar.tsx` (+13 lines)
Replaced the single "Bulk Import" button with the new `ImportDropdown` component that offers both "Import Files" and "Import Folder" options. Added `onFolderImportClick` prop.

### `hooks/use-trades.ts` (+112 lines)
Added `folderInputRef` and `handleFolderUpload`. Folder upload groups CSV files by subdirectory name (used as broker hint), attempts parser auto-detection per group, processes each file through `processCsvData` with the resolved parser, and handles merge/upsert for both localStorage and cloud modes. Imports `detectParser`/`getParserById` from the new parser plugin system.

### `lib/csv-parser.ts` (+168/-56 lines)
Refactored to support the pluggable parser system. Added: `SIDE_ALIASES` map (SS, SELL SHORT, BUY TO COVER, BTO, STC, etc.), `COLUMN_ALIASES` map for header normalization, dedicated `normalizeRow`/`normalizeSide`/`parseCost` functions, per-row try/catch with warning collection, and an optional `BrokerParserConfig` parameter to `processCsvData`. Follow-up test-driven fix: partial-fill remainder executions now carry prorated commission/fees (prevents overcounting), and zero-quantity matched pairs are skipped to avoid emitting `NaN` trades when custom parsers return invalid qty.

### `lib/db.ts` (+37 lines)
Added four new tables to `initDb()`: `broker_sync_log` (tracks sync operations per user/account), `token_refresh_log` (audit trail for Schwab token refreshes), `discord_user_links` (maps Nexus users to Discord user/guild IDs), and `price_alerts` (symbol price alerts with above/below condition).

### `lib/schwab.ts` (+148/-65 lines)
Major reliability overhaul. Added per-user in-memory mutex (`refreshLocks` Map) to prevent concurrent token refresh races. Added a double-check read pattern (re-reads DB before refreshing in case another request already did it). Added single-retry with 1s delay for transient network errors. Added `logTokenRefresh()` to write audit rows to `token_refresh_log`. Added structured console logging for refresh events.

### `package.json` (+1 line)
Added `lightweight-charts` v5.1.0 dependency for the candlestick chart component.

### `tsconfig.json` (+1 line)
Added `"services"` to the `exclude` array so TypeScript doesn't try to type-check the Docker microservices (they have their own tsconfig files).

### `__tests__/csv-parser.test.ts` (+coverage)
Expanded from smoke tests to full unit coverage for date parsing edge cases, side/column alias normalization, partial fills across multiple symbols, unknown-side/zero-qty/unmatched warnings, parser exception handling, and parser-provided zero-qty edge safety.

### `__tests__/indicators.test.ts` (new)
Added deterministic unit tests for `sma`, `ema`, `bollingerBands`, `vwap`, `rsi`, and `macd`, including null warm-up alignment and signal/histogram alignment checks.

### `__tests__/backtesting-engine.test.ts` (new)
Added deterministic unit tests for `runBacktest()` covering long/short execution, forced close at end-of-data, zero-qty entry prevention via `Math.floor`, and aggregate stats/drawdown computation.

---

## New Files

### API Routes

#### `app/api/backtest/route.ts`
**Purpose:** Authenticated proxy to the backtest-gateway microservice. POST submits a job, GET polls by jobId. Returns 503 if the gateway is unreachable.
**Status:** Complete. Functional when the Docker services stack is running.

#### `app/api/discord/alerts/route.ts`
**Purpose:** CRUD for price alerts. GET returns active (untriggered) alerts for the authenticated user. POST creates a new alert with symbol, condition (above/below), and target price.
**Status:** Complete. Alert creation and listing work. No alert *evaluation* loop exists yet — alerts are stored but never checked against live prices.

#### `app/api/discord/link/route.ts`
**Purpose:** Links a Nexus user account to a Discord user ID + guild ID. GET lists existing links, POST upserts a link.
**Status:** Complete. Functional, but the Discord bot doesn't yet call this endpoint to auto-link on first interaction.

#### `app/api/schwab/accounts/route.ts`
**Purpose:** Lists Schwab brokerage accounts for the authenticated user. Calls `GET /trader/v1/accounts` with a valid access token. Handles rate limits (429).
**Status:** Complete.

#### `app/api/schwab/sync/route.ts`
**Purpose:** Imports trades from Schwab transaction history into the Nexus database. Accepts accountId + date range, enforces 90-day max range and 5-minute cooldown, fetches transactions, normalizes via `schwab-api` parser, runs through the existing FIFO matcher, upserts trades, and logs the sync.
**Status:** Complete. Working end-to-end. Uses `INSERT OR REPLACE` for trade upsert, which may overwrite user-added notes/tags on re-sync (see Remaining Work).

#### `app/api/webhooks/trade-event/route.ts`
**Purpose:** Inbound webhook endpoint for external events (trade_imported, sync_complete). Authenticated via Bearer token from `TRADE_WEBHOOK_SECRET` env var.
**Status:** Incomplete. Validates and accepts events but does nothing with them — contains `// TODO: Deliver webhook payload to Discord bot`.

### Components

#### `components/trading/BacktestResultsPanel.tsx`
**Purpose:** Renders backtest output: stats grid (9 metrics including win rate, Sharpe, drawdown), equity curve (Recharts AreaChart, downsampled to 200 points), and scrollable trade log table.
**Status:** Complete.

#### `components/trading/BrokerSyncTab.tsx`
**Purpose:** UI for the Broker Sync tab. Shows Schwab connection status, account selector, date range pickers, sync button with cooldown enforcement, and import results with warning display. Handles the Schwab OAuth popup flow via `postMessage`.
**Status:** Complete.

#### `components/trading/CandlestickChart.tsx`
**Purpose:** lightweight-charts v5 wrapper. Renders OHLCV candlestick + volume histogram, supports overlay indicators (SMA, EMA, Bollinger), and trade entry/exit markers via `createSeriesMarkers`. Dynamically imported (SSR disabled). Handles resize and cleanup.
**Status:** Complete.

#### `components/trading/ImportDropdown.tsx`
**Purpose:** shadcn DropdownMenu replacing the old "Bulk Import" button. Offers "Import Files" (multi-CSV select) and "Import Folder" (webkitdirectory) options.
**Status:** Complete.

### Lib — Indicators

#### `lib/indicators.ts`
**Purpose:** Pure client-side technical indicator calculations: SMA, EMA, Bollinger Bands, VWAP, RSI, MACD. All functions return `(number | null)[]` arrays aligned to input length with leading nulls for warm-up periods.
**Status:** Complete. SMA, EMA, Bollinger are used by CandlestickChart and backtesting strategies. VWAP, RSI, MACD are implemented but not yet exposed in the UI indicator toggles.

### Lib — Parser Plugin System

#### `lib/parsers/types.ts`
**Purpose:** TypeScript interfaces for the parser plugin system: `NormalizedExecution` (standardized trade row) and `BrokerParserConfig` (detect, extractDate, normalizeRow).
**Status:** Complete.

#### `lib/parsers/default.ts`
**Purpose:** Default parser for DAS Trader / generic CSV formats. Handles column alias mapping and side alias normalization. Exports `normalizeColumnNames` utility.
**Status:** Complete.

#### `lib/parsers/registry.ts`
**Purpose:** Parser registry with `registerParser`, `detectParser` (auto-detect by headers/rows), `getParserById`, and `getAllParsers`. Default parser is always the fallback.
**Status:** Complete. Currently only the default parser is registered. Schwab API parser exists but isn't registered in the CSV detection flow (it's used directly by the sync route).

#### `lib/parsers/schwab-api.ts`
**Purpose:** Normalizes Schwab API transaction objects into `NormalizedExecution`. Maps Schwab instruction codes (BUY, SELL_SHORT, BUY_TO_COVER, SELL_TO_CLOSE) to internal side codes. Extracts and sums fees from Schwab's nested fee structure.
**Status:** Complete.

#### `lib/parsers/index.ts`
**Purpose:** Barrel re-export for the parsers module.
**Status:** Complete.

### Lib — Backtesting

#### `lib/backtesting/engine.ts`
**Purpose:** Client-side backtest simulator. Takes OHLC candles + a `BacktestConfig` (entry/exit condition functions, position sizing, params). Runs a single-pass loop: check exit → check entry → mark-to-market. Closes open positions at end of data. Computes stats: win rate, profit factor, max drawdown, Sharpe ratio (annualized at sqrt(252)).
**Status:** Complete.

#### `lib/backtesting/strategies.ts`
**Purpose:** Three strategy definitions for the client-side backtester:
1. **SMA Crossover** — Long on bullish crossover, short on bearish crossover, with indicator caching.
2. **Mean Reversion (Bollinger Bounce)** — Long at lower band, exit at middle band.
3. **N-Period Breakout** — Long on new N-period high, exit on N-period low break.
**Status:** Complete. All three strategies work with the engine and UI.

### Services — Backtest Gateway

#### `services/backtest-gateway/src/index.ts`
**Purpose:** Express server (port 4000) that accepts backtest job submissions via POST, enqueues them in Redis/BullMQ, and supports polling for results via GET. Includes health check endpoint.
**Status:** Complete. Functional with Docker Compose.

#### `services/backtest-gateway/Dockerfile`, `package.json`, `tsconfig.json`
**Purpose:** Build/run config for the gateway container.
**Status:** Complete.

### Services — Backtest Worker

#### `services/backtest-worker/main.py`
**Purpose:** Python worker that polls BullMQ jobs from Redis and runs vectorized backtests using pandas/numpy. Currently implements `sma-crossover` strategy. Directly manipulates BullMQ Redis keys for job lifecycle.
**Status:** Partial. Only `sma-crossover` strategy is implemented. Missing: `mean-reversion`, `breakout`, and any custom strategy passthrough. The BullMQ Redis key manipulation is a fragile approach — it works but bypasses BullMQ's official protocol.

#### `services/backtest-worker/Dockerfile`, `requirements.txt`
**Purpose:** Build/run config for the Python worker container.
**Status:** Complete.

### Services — Discord Bot

#### `services/discord-bot/src/index.ts`
**Purpose:** Discord.js bot entry point. Registers slash commands on ready (guild-specific or global), dispatches interactions to command handlers.
**Status:** Complete.

#### `services/discord-bot/src/utils.ts`
**Purpose:** Shared utilities: `fetchNexusApi` (HTTP client with Bearer auth), `formatCurrency`, `pnlColor`, `createTradeEmbed`.
**Status:** Complete.

#### `services/discord-bot/src/commands/journal.ts`
**Purpose:** `/journal [date]` — Shows trades for a given date with summary embed + individual trade embeds (max 10).
**Status:** Complete.

#### `services/discord-bot/src/commands/stats.ts`
**Purpose:** `/stats [period]` — Performance summary (win rate, PnL, profit factor) over 30d/60d/90d/all.
**Status:** Complete.

#### `services/discord-bot/src/commands/pnl.ts`
**Purpose:** `/pnl [symbol]` — Cumulative PnL breakdown by symbol or for a specific ticker.
**Status:** Complete.

#### `services/discord-bot/src/commands/sync.ts`
**Purpose:** `/sync` — Triggers a Schwab broker sync from Discord. Calls POST `/api/schwab/sync`.
**Status:** Partial. The sync API requires `accountId` in the body but the Discord command doesn't pass one. Will fail at runtime.

#### `services/discord-bot/src/commands/alert.ts`
**Purpose:** `/alert <symbol> <condition> <price>` — Creates a price alert via the Nexus API.
**Status:** Partial. Creates alerts successfully but passes `price` as `body.price` while the API expects `body.targetPrice`. Will create alerts but the price field won't be saved.

#### `services/discord-bot/src/commands/backtest.ts`
**Purpose:** `/backtest <symbol> <strategy>` — Submits a backtest job and polls for results (3s intervals, 60s timeout). Displays results in an embed.
**Status:** Partial. Submits to the backtest API but doesn't send candle data (the gateway requires `candles` in the body). The backtest gateway will reject the request.

#### `services/discord-bot/src/deploy-commands.ts`
**Purpose:** Standalone script to deploy slash commands to Discord API.
**Status:** Complete.

#### `services/discord-bot/.env.example`, `Dockerfile`, `package.json`, `tsconfig.json`
**Purpose:** Build/run/config files for the Discord bot container.
**Status:** Complete.

#### `services/docker-compose.yml`
**Purpose:** Orchestrates all services: Redis, backtest-gateway, backtest-worker, discord-bot.
**Status:** Complete.

---

## Remaining Work

### Incomplete Features

1. **Webhook delivery** — `app/api/webhooks/trade-event/route.ts` accepts events but has no delivery logic. Needs to forward payloads to the Discord bot or a notification system.

2. **Price alert evaluation** — Alerts are created and stored but never evaluated against live market data. Needs a background job or cron that checks current prices against active alerts and triggers notifications.

3. **Discord `/sync` command** — Missing `accountId` parameter. Needs either a default account lookup or a command option for account selection.

4. **Discord `/alert` command** — Sends `price` field but API expects `targetPrice`. Field name mismatch.

5. **Discord `/backtest` command** — Doesn't include candle data in the submission. Needs to either fetch market data first or have the gateway fetch it.

6. **Python backtest worker** — Only implements `sma-crossover`. Missing `mean-reversion` and `breakout` strategies. The direct Redis key manipulation is fragile.

7. **RSI/MACD/VWAP indicator toggles** — The indicators are fully implemented in `lib/indicators.ts` but not yet wired into the CandlestickChart UI or indicator toggle buttons.

8. **Schwab sync re-import overwrites user data** — `INSERT OR REPLACE` in the sync route will overwrite user-added notes, tags, and initialRisk when trades are re-synced. Should use `INSERT ... ON CONFLICT DO UPDATE` with selective column updates.

9. **Parser auto-registration** — The `schwab-api` parser exists but isn't registered in the parser registry. CSV files from Schwab won't auto-detect; only API-based sync uses it.

10. **Folder import UX** — No progress indicator during multi-file folder import. Large folders may appear to hang.

### Known Bugs

- **`@ts-expect-error` on folder input** — `webkitdirectory` attribute requires a `@ts-expect-error` suppression in `app/page.tsx:105`. Not a functional bug but a type-safety concern.

- **Strategy indicator cache invalidation** — In `lib/backtesting/strategies.ts`, the SMA crossover cache comparison (`closesRef !== closes && closesRef?.length !== closes.length`) will fail to invalidate if the array length stays the same but contents change. Low-risk since candles don't mutate mid-backtest.

---

## Security Notes

### Schwab OAuth Token Handling
- Tokens stored in `schwab_tokens` table (Turso DB) with `access_token`, `refresh_token`, `expires_at`
- Per-user mutex prevents concurrent refresh races
- Single-retry on transient network errors during refresh
- Token refresh events are audited in `token_refresh_log`
- **Concern:** Tokens are stored in plain text in the database. Consider encrypting at rest if the DB is not already encrypted.
- **Concern:** The `refresh_token` is rotated by Schwab; if a refresh fails after the old token is invalidated but before the new one is saved, the user must re-authenticate.

### API Authentication
- All API routes use `requireUser()` → NextAuth session check
- Schwab endpoints additionally validate token existence via `getValidSchwabToken()`
- The webhook endpoint (`/api/webhooks/trade-event`) uses a shared Bearer secret (`TRADE_WEBHOOK_SECRET` env var) — not session-based auth

### Discord Bot Auth
- Bot authenticates to Nexus API using `TRADE_WEBHOOK_SECRET` as a Bearer token
- **Concern:** The bot sends this secret on every API call but the Nexus API routes use NextAuth sessions, not Bearer tokens. The bot's requests will likely fail auth. Needs either: (a) a service account / API key system, or (b) the bot to authenticate via a different mechanism.

### Environment Variables Required
- `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, `SCHWAB_API_BASE_URL` — Schwab OAuth
- `ALLOWED_EMAILS` — Comma-separated list of emails allowed to sign in
- `TRADE_WEBHOOK_SECRET` — Shared secret for webhook + bot auth
- `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` — Discord bot credentials
- `BACKTEST_GATEWAY_URL` — URL for the backtest gateway (default: `http://localhost:4000`)
- Standard NextAuth vars: `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Turso: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`

### Input Validation
- Market data route validates `periodType` and `frequencyType` against allowlists
- Sync route validates date ranges (max 90 days) and enforces 5-minute cooldown
- CSV parser has per-row try/catch with warning collection
- Price alerts validate condition enum (`above`/`below`) and targetPrice type

---

## Testing Status

### Framework Setup

| Target | Framework | Config | Run Command |
|--------|-----------|--------|-------------|
| TypeScript / Next.js | Vitest 4.x | `vitest.config.ts` | `npm test` (single run) / `npm run test:watch` (watch mode) |
| Python backtest-worker | pytest 8.x | listed in `services/backtest-worker/requirements.txt` | `pytest` (inside container or venv) |

Test files live in `__tests__/` at the project root (configured in `vitest.config.ts`). The `@/` path alias is resolved so tests can import app code directly.

### Existing Tests

- **`__tests__/csv-parser.test.ts`** (12 tests, all passing) — Covers date parsing edge cases, side alias resolution, column alias normalization, multi-symbol partial fill pairing, warning generation, parser exception handling, and zero-qty parser edge safety.
- **`__tests__/indicators.test.ts`** (7 tests, all passing) — Covers SMA, EMA, Bollinger Bands, VWAP, RSI, and MACD behavior with deterministic fixtures.
- **`__tests__/backtesting-engine.test.ts`** (5 tests, all passing) — Covers deterministic long/short trades, end-of-data forced close, zero-sized entries, and stats (win rate, PnL, drawdown, profit factor).

Current Vitest status: **3 test files, 24 tests passing** (`npm test`).

### Needs Tests (Priority Order)

1. **`lib/parsers/default.ts`** and **`lib/parsers/schwab-api.ts`** — Row normalization, column aliasing, Schwab transaction mapping.
2. **`lib/schwab.ts`** — Token refresh logic, mutex behavior, retry logic. Needs mocking.
3. **API routes** — Auth gating, input validation, error responses. Integration tests.
4. **`hooks/use-trades.ts`** — Folder upload grouping, merge/upsert logic. Needs React testing setup.
5. **`services/backtest-worker/main.py`** — Python backtest logic. Needs pytest (added to requirements.txt, available in Docker build).
