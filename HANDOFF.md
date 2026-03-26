# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts, Discord Research Report Extraction Phases 1-4, SSE Jarvis Streaming, Discord Research Schwab Validation, Research Tab Full Redesign, Direct Relay WebSocket, Macro Summary Upgrade, Charts Tab Drawing Tools, Schwab Relay Auth) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars

---

## Codebase Simplification — Phase 4

> Generated: 2026-03-24 | Phases 1-3 complete (948f120), Phase 4 remains
> Phase 1: dead code deletion (~700+ lines). Phase 2: bug-risk duplication. Phase 3: shared API route patterns. All done.

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
