# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts, Discord Research Report Extraction Phases 1-4, SSE Jarvis Streaming, Discord Research Schwab Validation, Research Tab Full Redesign, Direct Relay WebSocket, Macro Summary Upgrade, Charts Tab Drawing Tools, Schwab Relay Auth) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars

---

## Codebase Simplification — Phases 3-4

> Generated: 2026-03-24 | Phases 1-2 complete, Phases 3-4 remain
> Phase 1 (dead code deletion) is done — ~700+ lines removed.
> Phase 2 (bug-risk duplication) is done — 0 lint/type errors, 207/207 tests passing.

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
