# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-31
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-14, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Recent Completed Context

- **Sprint 12 - Scanner Cost & Telemetry:** added structured AskEdgar fan-out logs and moved Dashboard scanner aggregate cache from module memory into `askedgar_cache`.
- **Sprint 13 - Dashboard MDR Scan Retirement:** removed Dashboard MDR UI/routes/cron/evaluator exports while intentionally leaving `mdr_triggers` schema/data for a later migration.
- **Sprint 14 - Daily Review Tag Centralization:** made trade tags the shared Watchlist/Daily Trades tagging model, added tag rename/merge management, and removed watchlist-thesis UI usage while keeping the legacy route/table.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests for `TradesTab`, `TradeDetailSheet`, `ResearchTickerView`, Playbook route, and Playbook UI smoke flows. Lazy-loaded `BacktestingTab` only at the `app/page.tsx` Charts-tab boundary. Plain `npm run build` output for `/` improved from `388 kB` / `559 kB First Load JS` before the dynamic import to `355 kB` / `526 kB First Load JS` after it.

---

## Sprint 16 - Cleanup: Legacy DB Column Drop

> Status: READY NEXT - isolated final cleanup sprint

Keep this migration sprint separate for a clean revert path.

Current verified migration target:

- `lib/db/schema.ts` still defines legacy `trades.pnl` and `trades.executions`.
- `lib/server-db-utils.ts` still has `toTrade()` fallback logic:
  - `row.netPnl === 0 && row.pnl !== 0 ? row.pnl : row.netPnl`
  - `row.executionCount === 1 && row.executions !== 1 ? row.executions : row.executionCount`
- Trade write paths still populate legacy columns in routes such as:
  - `app/api/trades/route.ts`
  - `app/api/trades/[id]/route.ts`
  - `app/api/trades/import/route.ts`
  - `app/api/trades/import-raw/route.ts`
  - `app/api/trades/merge/route.ts`
  - `app/api/trades/cover/route.ts`

Do not start Sprint 16 until Sprint 15 is complete and committed.

---

## Implementation Style

Write the simplest correct code that satisfies the active spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless the spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries: user input, external APIs, and DB reads of untrusted JSON.
- No comments unless the why is non-obvious.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
