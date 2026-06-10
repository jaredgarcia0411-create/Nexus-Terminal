# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-09
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-16, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Sheets Sprints 1-7 + Massive Wave 1-2, backtest user-id fixes, Filing headline parser, Calendar Year Overview, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---

## Open Follow-Ups

Deferred Sheets roadmap (not started):
- Manual authenticated smoke for sharing (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation.

---

## Recent Completed Context

### Sheets — "Today" Quick Filter Toggle

Status: completed 2026-06-10 (commit `c151f3b`).

Outcome:
- `SheetsTab` toolbar gains a `CalendarCheck` toggle (live sheet only, `!activeSheet.rootId`) that filters the grid to rows dated today, independent of the per-column `filterMode` and composable with it.
- Toggling clears the row selection; on dated/snapshot sheets the filter self-disables so switching never traps an empty grid.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (824 passed).

### Sheets Report Column — Resolve by Ticker + Date at Render Time

Status: completed 2026-06-10 (commit `280d904`).

Outcome:
- New `lib/sheets/report-lookup.ts` (`resolveReportIdsByTickerAndDate`) + `GET /api/sheets/[id]/report-ids` return a `TICKER|YYYY-MM-DD` → reportId map (NY generation date, newest per ticker+date, no freshness window).
- `SheetsTab` report cell now prefers the row's stored `research_report` value and only falls back to a same-date resolved report when empty; map refetches on sheet load + window focus. Fixes reports added before generation finished, without back-filling stale reports onto historical rows.
- `ResearchTickerView` fires `prefetchResearchReport(ticker)` on add so generation is guaranteed to start. Daily/Weekly review panels left on the untouched stored-value path.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (824 passed; +4 new tests covering the helper, viewer access, and the different-date no-backfill case).

Known edge (not fixed, matches existing date handling): the row's stored date is browser-local while the report date is NY — if your browser TZ differs from ET, a late-night add could land on different days and not auto-resolve.

- **Sheets → Daily/Weekly Trades (commits `3c0f397`→`ddbd097`):** retired the editable review Watchlist; sheet columns flagged `asTags` now auto-tag matching trades (same ticker + date) on import and sheet-row edits via `lib/sheets/trade-tags.ts`; new `/api/sheets/research-rows` feeds the panel's Report column. Daily/Weekly "Trades" panel gained editable Grade (saved in `reportData.__tradeGrades`), Report inline-expand, and a Notes button opening the global Trade Review; Trade Review now shows Notes above Overview. Old reviews keep their watchlist as a read-only `ArchivedWatchlist` block (data preserved in `__watchlist`, never re-written). Deleted `WatchlistEditor`/`WatchlistSavePicker`/`WatchlistTickerChart`, `lib/watchlist-server.ts`, append-watchlist route; slimmed `lib/watchlist.ts`. Validated: `npm run lint`, `npx tsc --noEmit`, `npm test` (820 passed). Follow-up: tag *removal* on cell-clear intentionally not implemented (additive-only).
- **Team-Wide Tags:** added shared `team_tags` + `/api/team-tags`, moved Sheets/review watchlist tag options to `useTeamTags`, added Manage Team Tags, and dropped the unused `watchlist_theses` route/table.
- **Sheets Frontend Wave (commits `6d770e1` / `a6abece` / `0f43f23` / `a9a0f65` / `02ffa48`):** removed Watch as a locked default column, added float shorthand display, date sort/manual-drag mode, multi-select columns, and an edit-column dialog.
- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.
- **Sheets (Sprints 1-7 + Massive Wave 1-2):** 3-table model + editable grid + sharing, lineage/snapshot, `(ticker,date)`-dedupe research-row append, CSV import with mapping review, Massive volume/float fill, locked R column. Latest commits `abe6a9a` / `c6630b7` / `c9b1bf7`.
- **Navigation Reorganization (commits `09c5aea` + `8c46c56` + review edits):** Management split into top-level **Trades** (History · Performance · Career P/L · Playbook) and **Journal** (Calendar · Reviews); **Sheets** promoted to its own top-level tab; **Charts** now uses a `Charts · Backtests` sub-nav and the old manager back-arrow/"Backtest Manager" title+divider were removed. Mobile bottom bar collapses Journal/Charts behind a **More** menu; shortcuts + command palette renumbered 1-6. Trades/Journal sub-tab state is keyed per group (`nexus.trades.subTab` / `nexus.journal.subTab`) with distinct React `key`s on each `ManagementTab` so the two tabs no longer share state; Trades/Journal top padding tightened to `py-4`. Validated: `npm run lint`, `npx tsc --noEmit`, `npm test` (817 passed).

---

## Implementation Style

Write the simplest correct code that satisfies the active spec. Specifically:

- Match the existing conventions in the file you're editing. Do not introduce new patterns, helpers, abstractions, or file layouts unless the spec explicitly calls for them.
- No future-proofing. No feature flags, no "in case we need it later" parameters, no extracted helpers that have a single caller. If a value is only used once, inline it.
- No defensive code at internal boundaries. Trust your own code and framework guarantees; validate only at system boundaries: user input, external APIs, and DB reads of untrusted JSON.
- No comments unless the why is non-obvious (a hidden constraint, a workaround, a surprising invariant). Don't restate what the code says.
- If a step in this spec looks more complex than it needs to be, flag it and propose the simpler version before implementing — don't silently "improve" the spec, but don't write code that's more elaborate than the problem requires either.
- If you spot an existing simpler pattern in the codebase that fits, use it instead of writing new code.

This is a personal trading platform built solo. Readability > cleverness; debuggable > elegant; small diff > sweeping refactor. Three similar lines beats a premature abstraction.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
