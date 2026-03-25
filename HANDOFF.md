# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts, Discord Research Report Extraction Phases 1-4, SSE Jarvis Streaming, Discord Research Schwab Validation, Research Tab Full Redesign, Direct Relay WebSocket, Macro Summary Upgrade) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [x] Updated Charts tab drawing UX: left-aligned toolbar, double-click selection, per-drawing delete, and persisted Fibonacci levels.
- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars

---

## Schwab Relay Auth — Parallel Blocker

> Generated: 2026-03-16 | Status: OPEN

- Relay logs show repeated `Failed to load Schwab user preference (401)`.
- This keeps `realtime_quotes` stale or empty, which directly degrades Scanner results.
- Schwab refresh tokens expire every **7 days** — you need to re-login via the Schwab OAuth flow weekly.

### Next steps

1. Re-link Schwab account in the app (Markets tab → Schwab status)
2. After relinking, check Fly logs for `LOGIN successful, subscribing...` and quote-write activity
3. If 401 persists after fresh relink, investigate whether the relay is loading the correct tokens from the DB

---

## Codebase Simplification — Phases 2-4

> Generated: 2026-03-24 | Phases 1-2 complete, Phases 3-4 remain
> 5 parallel nexus-architect subagents audited every file in `lib/`, `lib/jarvis/`, `hooks/`, `app/api/`, and `components/trading/`.
> Phase 1 (dead code deletion) is done — ~700+ lines removed.
> Phase 2 (bug-risk duplication) is done — 0 lint/type errors, 207/207 tests passing.

### Phase 2: Fix Bug-Risk Duplication ✅

- **2.1** All component reads aligned to `trade.netPnl`; `pnl`/`executions` aliases retained for DB compat only
- **2.2** `askedgar/tldr` route now calls `runResearchTldr()` with optional `historicalSummary`/`discordReport` context
- **2.3** `parseResearchCommand` + `saveConversation` extracted to `lib/jarvis/chat-helpers.ts`
- **2.4** `SIDE_ALIASES`, `COLUMN_ALIASES`, `parseCost`, `parseTimeToSeconds`, `normalizeColumnNames` consolidated into `lib/parsers/utils.ts`

### Phase 3: Consolidate Shared API Route Patterns

**3.1** Wire `dbUnavailable()` into 17 routes that inline it (helper exists in `server-db-utils.ts`)
**3.2** Extract `requireCronSecret()` — copy-pasted in 2 cron routes → move to `lib/server-db-utils.ts`
**3.3** Extract `rateLimitExceededResponse()` — same 429 block in 4 jarvis routes → add to `lib/jarvis/rate-limit.ts`
**3.4** Extract `buildTradeInsertValues()` — 20+ field insert duplicated in 2 trade routes (note: import omits `notes` from conflict update intentionally)
**3.5** Extract `saveDiscordReports()` — same insert loop in 3 discord routes → `lib/discord/`
**3.6** Move `INDEX_SYMBOLS`/`COMMODITY_SYMBOLS`/`EQUITY_SYMBOLS` to `lib/massive-market.ts` (duplicated in 2 market routes)
**3.7** Move `ScannerSortKey`/`ScannerSortDir` types to `lib/types.ts` (can't import from `'use client'` hook into server route)
**3.8** Export `buildQueryString` from `use-scanner.ts` (duplicated in `use-market-stream.ts`)
**3.9** Smaller cleanups:
- `normalizeTimestamp()` duplicated in 2 trade routes → `lib/time-utils.ts`
- `toNumberOrUndefined()` duplicated in 2 routes → `lib/api-route-utils.ts`
- `requireDiscordConfig()` env check in 3 discord routes (+ status code inconsistency 400 vs 503)
- AskEdgar routes skip `logRouteError`/`internalServerError` → use standard helpers
- `askedgar/tldr` skips `parseAndValidate` → add Zod schema
- `market-data/stream` missing top-level try/catch
- Ticker normalize + regex repeated → use `TICKER_REGEX` from askedgar, create `normalizeTicker()`

### Phase 4: Component Dedup (touch as needed)

**4.1** Extract `AskEdgarEndpointResponse` interface (copy-pasted in 3 components) + shared helpers (`formatNumber`, `formatMoney`, `getField`, `riskClass`) → `lib/askedgar-utils.ts`
**4.2** Extract `buildTradeMarkers()` (duplicated in `JournalTradeChart.tsx` + `TradeDetailSheet.tsx`) → `lib/trading-utils.ts`
**4.3** Move chart color constants + `FRAME_CONFIG` to `lib/chart-timeframes.ts` (duplicated across 3 chart components)
**4.4** Wrap PerformanceTab symbol distribution in `useMemo` (non-memoized reduce at lines 71-88)
**4.5** Lower priority: `ResearchChart` reimplements chart lifecycle, duplicate stat calcs, duplicate pagination, double `fetchResults` on mount in `use-scanner.ts`, `sortTrades` alias

### Deferred

- `lib/trade-migration.ts` — keep until all users confirmed migrated from localStorage
- `lib/storage.ts` — tied to trade-migration
- Discord import/sync routes — headless but functional
- Jarvis research/trade-analysis routes — redundant with chat but functional
- `hooks/trade-utils.ts` → `lib/trade-utils.ts` rename — low priority
- `buildResearchPrompt` in prompts.ts — now dead but harmless
