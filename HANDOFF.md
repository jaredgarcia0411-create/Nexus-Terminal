# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-07
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---

## Open Follow-Ups

- **`BacktestStatsView` owner badge (likely same id mismatch):** `components/trading/BacktestStatsView.tsx` (Charts → Management) computes an owner badge with `review.session.userId === currentUserId`, where `currentUserId` comes from `hooks/use-backtest-stats.ts` (client session id). Before changing anything, check whether that hook's data endpoint already returns a server `currentUserId` (like `use-backtest-manager` does), then apply the same `serverUserId ?? sessionUserId` pattern.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

### Fix client/server user-id mismatch hiding backtest reviews

Status: completed 2026-06-07 (commit `b12e604`); reviewed against spec — READY TO SHIP.

Outcome:
- `GET /api/backtest/sessions` now returns canonical `currentUserId` (`authState.user.id`); `useBacktestSession` prefers `serverUserId ?? clientUserId`, exposes it, and trusts the server-scoped `session` directly (no id comparison) so in-progress sessions reload.
- `BacktestChartWorkspace` feeds the canonical id to `BacktestSimPanel`, fixing the empty review list / disabled Load for users whose auth id ≠ DB id. No `BacktestSimPanel` change; no migration.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (106 files / 794 tests), `npm run build` all green. Jared confirmed reviews reload in dev.

### Sheets Spec 3: R column + drop Sample + toolbar tweaks

Status: completed 2026-06-07 (commit `797f536`); reviewed against spec — READY TO SHIP.

Outcome:
- Extracted pure `realizedPnlFromActions` in `lib/backtest-stats.ts` as the single realized-P&L source; refactored `computeReviewStats` to delegate to it.
- Added a locked, read-only **R** column (last locked default, `'rmultiple'` type) showing each row's per-viewer ACTIVE-else-latest-REVIEWED R; retired the **Sample** column and taught `ensureLockedColumns` to strip retired locked keys; removed the dead Sample plumbing.
- New access-gated `GET /api/sheets/[id]/r-results`; `SheetsTab` fetches it and refetches on chart-dialog close; moved the Filter toolbar button between Add-column and Snapshot-&-reset.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (106 files / 793 tests), `npm run build` all green. No `schema.ts`/`drizzle/`/`services/` change; no migration.

Note: the review surfaced a pre-existing client/server user-id mismatch (saved reviews not displaying) — tracked as the current ACTIVE SPEC; not caused by this commit.

### Sheets Spec 2b: Sheet chart-cell sim workspace (frontend)

Status: completed 2026-06-07 (commit `24297a2`); reviewed against spec.

Outcome:
- Extracted the session-driven chart sim into `components/trading/BacktestChartWorkspace.tsx` (chart grid, trade menu, armed banner, sim panel, place-order dialog + all sim/session/transient state); `ticker`/`date` stay parent-owned via props + an `onAnchorChange` callback.
- `BacktestingTab` renders it with Charts-only chrome passed as slots (back-to-manager, lookup/name toolbar, `BacktestingSidebar` rail) and passes `activeBacktest` so the panel label is unchanged; each consumer adds a `key` so the workspace remounts cleanly per ticker/date/row.
- Sheet chart cells open a full-screen dialog rendering the workspace with `sheetRowId={row.__id}` for a per-row isolated sim (builds on 2a); `WatchlistTickerChart` import dropped from `SheetsTab`.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (106 files / 787 tests), `npm run build` all green. Charts no-regression + per-row isolation smoke remain a Jared post-merge task.

### Sheets Spec 2a: Per-row backtest-session isolation (backend only)

Status: completed 2026-06-07 (commit `f24121d`); reviewed against spec.

Outcome:
- Added nullable `backtest_sessions.sheet_row_id` (FK→`sheet_rows`, cascade) + index; migration `0047_smart_wallop.sql` (additive-only) applied via `npm run db:migrate`.
- Threaded an optional `sheetRowId` discriminator through the Zod upsert schema, `BacktestSession` type, the sessions route (GET active-match + reviews scoping; POST sheet-row access gate + the lookup fix using `isNull` for the Charts path; persisted on insert/update), and `useBacktestSession`.
- `BacktestingTab` untouched — Charts behaves identically (`sheetRowId` null = today). No UI; that's 2b.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (106 files / 787 tests) all green; new route + validation tests cover review scoping, access-gated persist, and 403 rejection. Charts no-regression smoke remains a Jared post-merge task.

### Sheets Spec 1: Per-column filtering + arrow-key row navigation

Status: completed 2026-06-07 (commit `91e49cf`); reviewed against spec.

Outcome:
- Toolbar **Filter** toggle (all roles). While on, columns lock (no resize/reorder/row-drag, drag-handle hidden, grid renders bare without DndContext) and filterable headers (`text/number/url/date/select/checkbox`) show a `Popover` filter trigger that replaces the delete-X on user columns; active filters are highlighted and AND together.
- Pure `filterGridRows(rows, columns, filters)` helper in `lib/sheets/grid.ts` (returns same ref when no active filter) drives the grid's `visibleRows`; filters clear when the mode turns off (ephemeral).
- Arrow-nav shipped (not deferred): Up/Down + Enter move between rows in text-like cells via `focusAdjacentEditableInput` (aria-colindex DOM walk + `data-cell`/`data-rowidx` fallback); select/date arrows left native.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (106 files / 783 tests) all green. Client-only — no `services`/API/DB/migration. Manual smoke remains a Jared post-merge task.

### Filing headline parser (Research Filings)

Status: completed 2026-06-02 (commit `95ab4c7`); reviewed against spec.

Outcome:
- New pure `summarizeFilingMetadata()` in `lib/sec/filing-summary.ts`: form-type taxonomy + 8-K item map (drops `9.01` exhibit companion, keeps first two items), `/A` → "amended"; unknown forms keep the old `primaryDocDescription || "${formType} filing"` fallback.
- Wired into `zipFilingColumns` in `lib/sec/submissions.ts` so first-party SEC headlines flow to Research > Filings with no normalizer/UI change; `items` + `primary_doc_description` stay intact.
- Tests in `__tests__/sec-filing-summary.test.ts` (path chosen so vitest's `__tests__/**` glob runs them); `sec-submissions.test.ts` expectations updated.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (106 files / 777 tests) all green. No `services`/API/DB/migration.

### Calendar: Year Overview + day $/R sizing

Status: completed 2026-06-02 (commit `7c76446`); reviewed + final polish applied.

Outcome:
- New **Year Overview** mode on the Calendar sub-tab: a toggle shows 12 compact mini-month calendars (`MiniMonthCalendar` + `YearOverview`), each day tinted by net daily P&L; **Open** swaps the full calendar to that month, **Active** marks the open one, back arrow resets to the current month.
- `TradingCalendar` gained an optional controlled `month`/`onMonthChange` (mirrors `selectedDate`); `dailyPnlByDate` helper added to `lib/journal-aggregates.ts` (+3 tests).
- Day & weekly `$/R` numbers bumped one step and de-bolded — spec set `$` to `font-semibold`; post-review dropped to `font-medium` (matches `R`) to kill the remaining grain.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (105 files / 772 tests) all green. No `services`/API/DB/migration.

### Sheets - Sprint 7: Snapshot & Reset flow

Status: completed 2026-06-02 (commit `ef7b591`); reviewed + UI polish applied (commit `cd5fafb`).

Outcome:
- `/duplicate` route repurposed to `/snapshot`: saves a dated frozen copy into the sheet's lineage, then clears the original's rows. Owner-gated; copy-then-clear in one transaction. No migration.
- Originals (`rootId == null`) display today's date (display-only); snapshots show their frozen date. Research "Add to Sheets" lists originals only.
- Post-ship polish (cd5fafb): sheet action buttons consolidated into one top-right cluster, delete-sheet moved to the toolbar, reduced section padding, styled portal tooltip on text cells, explicit grid column widths to fix resize reflow, Journal tab renamed to Calendar with Sheets as the default Management tab.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (105 files / 769 tests) all green.

### Sheets - Sprint 6: Lineage, Watchlist Column + Auto-tag

Status: completed 2026-06-02 (commit `9628b34`); reviewed + UI tweaks applied.

Outcome:
- `rootId` lineage column (migration `0046`); duplicates join their source's lineage; Saved Sheets became a compact top-bar dropdown + History past-versions menu.
- Locked **Watch** column adds a row's ticker (with its Tag) to today's watchlist; `ensureLockedColumns` injects new locked defaults into older sheets at read-time and re-syncs locked column names from the defaults.
- Import auto-tagging: `lib/watchlist-server.ts` applies a date's watchlist tags to imported trades server-side (no daily-review save needed).
- Post-review tweaks: removed card chrome from the sheets bar; Add Row → `Rows3`, Add Column shares the Add Row primary styling; date moved beside the title; `Research Report` → `Report`, `Add to Sample` → `Sample`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (766 passed) all green; migration applied.
- Manual smoke (lineage grouping, watchlist add, import auto-tag) remains a Jared post-merge task.

### Sheets - Sprint 6 small items (tags + icon toolbar)

Status: completed in-session by Claude 2026-06-02. Validated: `npm run lint`, `npx tsc --noEmit`, `npm test` (756 passed).

Outcome:
- The locked **Tag** column now sources its select options from the user's global trade tags (fetched from `/api/tags` in `SheetsTab`, injected onto the `tag` column in the `gridColumns` memo). Keeps sheet tags consistent with trade tags.
- The sheet toolbar buttons are now **icon-only** (`size="icon-sm"`) with native `title` hover tooltips + `aria-label` (Add row / Add column / Duplicate / Rename / Share / Delete-selected / Delete sheet). No new Tooltip dep — matches the existing `title=` pattern on the report/chart cells.

### Sheets - Sprint 5: Reorder Rows/Columns + Delete Columns

Status: completed 2026-06-02 (commit `eb0ed1f`). Validated: `npm run lint`, `npx tsc --noEmit`, `npm test` (756 passed), `npm run workflow:audit`.

Outcome: drag-reorder rows (@dnd-kit drag-handle column, editor+owner) persisting to `sheet_rows.position`; native rdg column reorder + ×-on-hover column delete (owner-only, reusing `updateColumns`); orphaned cell data left dormant. No migration.

### Sheets - Sprint 4: Research Notebook Core

Status: completed 2026-06-01 (commit `65ecd1e`).

Outcome:
- Locked `report`/`chart`/`action` cells are live (report dialog, ticker+date chart, sample-set save picker); they work for viewers too.
- Date/select/text cells render as always-visible inline inputs (`renderCell`) instead of the spec's `renderEditCell` editors — this was the fix for a crash (Codex had used the canary-only `useEffectEvent`) and the visible-date-selector issue.
- New `POST /api/sheets/[id]/append-research-row` (auth + role gate + `(ticker, date)` dedupe) and an "Add to Sheets" dropdown on the Research page.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (751 passed) all green; reviewed against spec.
- Manual authenticated smoke (open report/chart cells, save to sample set, Add to Sheets incl. duplicate) remains a Jared post-merge task.

### Sheets - Sprint 1: Data Layer

Status: completed 2026-06-01 (commit `176e525`).

Outcome:
- 3-table model shipped (`sheets`, `sheet_rows`, `sheet_members`) with migration `0045`, columns folded into a `columns` jsonb + `columnsVersion` guard.
- Access-checked routes from day one via `getSheetRole`: list/create, get/patch/delete (owner-only edits), duplicate, row append + optimistic-version patch/delete.
- Validation in `lib/validations/sheets.ts` (hard bounds) + 12 vitest cases.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (736 passed) all green.
- Migration generated + applied (`npm run db:migrate`).

### Sheets - Sprint 2: Management UI + Editable Grid

Status: completed 2026-06-01 (commit `da1bba0`).

Outcome:
- First Sheets UI: `Sheets` subtab under Management — list rail, create/rename/duplicate/delete, `react-data-grid` editable grid with text/select/checkbox editors, optimistic save with 409 conflict toasts.
- `hooks/use-sheets.ts` owns all data + mutations; pure grid helpers in `lib/sheets/grid.ts` (unit-tested).
- Grid themed via `.sheets-grid` mapping `--rdg-*` vars onto app semantic tokens (follows light/dark).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (740 passed) all green.
- Authenticated browser smoke not run (no `agent-browser` in Codex sandbox); deferred surfaces (`report`/`chart`/`action` cells, tag options, sharing) are not built yet, not broken.

Known cosmetic debt (rolled into Sprint 3): `SheetFormDialog` date input + `AddColumnDialog` type select dropped the `[color-scheme:dark]` class the rest of the app uses.

### Sheets - Sprint 3: Sharing / Members

Status: completed 2026-06-01 (commit `93c3646`).

Outcome:
- Owner-only member routes: add-by-email (`POST .../members`), editor/viewer role change + remove (`PATCH`/`DELETE .../members/[userId]`), with the owner's membership immutable (never assigned/changed/removed via these routes).
- `use-sheets` gained `addMember`/`updateMemberRole`/`removeMember` (local `members` updates, surfaces server error text); new owner-only `ShareSheetDialog` wired into `SheetsTab`.
- Cleared Sprint-2 `[color-scheme:dark]` debt on `SheetFormDialog` date input + `AddColumnDialog` type select; added `sheets-members` validation tests.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (744 passed) all green.
- Manual authenticated sharing smoke not run (no `agent-browser` in Codex sandbox) — still pending.

### Roadmap (deferred — Sheets, Sprint 5+)
- **Manual authenticated smoke for sharing** (still pending: invite logged-in coworker, flip role, remove; unknown-email error; viewer read-only / editor sees no manage buttons).
- Self-leave (non-owner removing own membership), ownership transfer, email/invite-link notifications for users who haven't signed in.
- Templates / per-day "start today's sheet" flow beyond plain Duplicate.
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation. (drag-reorder rows/columns + tags-in-Tag-column shipped; lineage UI + Watch column + import auto-tag shipped in Sprint 6; Snapshot & Reset shipped in Sprint 7.)

(Research "Add to Sheets" import + interactive `report`/`chart`/`action` cells + the `AGENTS.md` Sheets-surface update shipped in Sprint 4 — see Recently Completed.)

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
