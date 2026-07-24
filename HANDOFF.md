# Nexus Terminal - HANDOFF.md

> Updated: 2026-07-17
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-16, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Sheets Sprints 1-7 + Massive Wave 1-2, backtest user-id fixes, Filing headline parser, Calendar Year Overview, Workflow Maintenance, Nav Reorg, Sheets Today-filter + report-by-ticker/date, EODHD News API swap, Trade-Chart Annotations/Expand/Per-Chart-Timeframe/DAS Triangle Markers) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---

> Historical completed sections (Chart Loading & Text-Box Improvements, 2026-07-17) were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

---

## Open Follow-Ups

Playbook rich text:
- Roll `RichTextEditor` into the daily/weekly journal review sections (same `type: 'text'` pattern).
- Optional: Notion-style slash (`/`) command menu; checklists / code blocks / highlight.

Deferred Sheets roadmap (not started):
- Manual authenticated smoke for sharing (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation.

> Historical completed sections (Rich Text + Autosave for Reviews/Notes, Playbook Auto-Save + Font-Size, Playbook Rich Text, News Section Redesign, Filing Headline Parser, Unified News Feed, Mobile Optimization, Trade-Chart Annotations/Expand/Timeframe/Triangle Markers) were removed to keep this file focused. Use git history and the `specs/` directory for archived implementation detail.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.

---

## Recently Completed

### Daily/Weekly Review: Grade Transfer, Default VWAP, Missed Setups Block

Status: completed 2026-07-24.

Outcome:
- Weekly Review's Weekly Trades now pre-fills grades from that week's daily reviews; a grade saved on the weekly itself still wins.
- VWAP is a default overlay on every review chart — session-anchored on intraday frames, continuous on daily (`showVwap` prop through `CandlestickChart` → `AnnotatableChart` → `JournalTradeChart`/`ReviewTickerChart`).
- New Missed Setups block (ticker · tags · grade · inline annotatable chart) renders under Daily Trades in the Daily Review and under Weekly Trades read-only in the Weekly Review; stored in `reportData` under `__missedSetups`, so no schema or migration was needed.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (841 tests) all pass.
- Manual smoke in dev: missed setups add/edit/chart/save/reopen, grade transfer, and VWAP all confirmed working.
