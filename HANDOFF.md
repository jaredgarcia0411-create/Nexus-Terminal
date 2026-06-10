# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-10
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-16, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Sheets Sprints 1-7 + Massive Wave 1-2, backtest user-id fixes, Filing headline parser, Calendar Year Overview, Workflow Maintenance, Nav Reorg, Sheets Today-filter + report-by-ticker/date, EODHD News API swap) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---

## Open Follow-Ups

Deferred Sheets roadmap (not started):
- Manual authenticated smoke for sharing (invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation.

---

## Recently Completed

### News Section Redesign — Headline List + Inline Article Reader

Status: completed 2026-06-10 (commit `3dabcd0`, reviewed against spec).

Outcome:
- Research News tab is now a two-level UI: a card list of headlines (`relative time · absolute datetime · bold title`, no source label) that swaps into a full inline article reader with `← Back`, a `$TICKER` badge, long datetime, optional "Open original ↗", and the body split into paragraphs.
- Added `url` to `ResearchSnapshotNewsItem` (sourced from EODHD `link`) and two formatters in `lib/askedgar-utils.ts` (`formatRelativeTime`, `formatDateTimeLong`); dropped the dead Groq/JMT415 `formType` source logic.
- Post-review tweak: article body bumped `text-sm` → `text-base` per Jared.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (825 tests) — all pass.
- Manual dev-server smoke by Jared: list, reader swap, and "Open original" all good.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
