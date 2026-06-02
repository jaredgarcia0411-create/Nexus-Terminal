# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-02
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Active Spec — Sheets Sprint 6: Lineage, Watchlist Column + Auto-tag

Status: implemented 2026-06-02. Validation passed after Parts A/B/C: `npm run lint`, `npx tsc --noEmit`, and `npm test` (final: 105 files / 766 tests). Migration `drizzle/0046_equal_imperial_guard.sql` was generated, inspected as a single nullable `root_id` add, and applied with `npm run db:migrate`. `npm run workflow:audit` passed after the `AGENTS.md` Sheets bullet update. Manual smoke remains a Jared post-merge task.

Context: Sheets is feature-complete and smoke-tested (sharing, research import, reorder all confirmed working in a live session). This sprint is pre-prod cleanup. Two of the original five cleanup items — **tags wired into the sheet Tag column** and **icon-only toolbar buttons** — were already implemented in-session by Claude (see "Recently Completed → Sheets Sprint 6 small items"). This spec covers the remaining three.

Locked scoping decisions (confirmed with Jared 2026-06-02):
- **Saved Sheets** become a compact top bar with a dropdown, grouped by **name lineage** (a sheet + its duplicates nest together). Needs a `rootId` lineage column + migration.
- **Tag column** is single-select sourced from global trade tags (already shipped).
- **Add-to-Watchlist** column adds the row's ticker to **today's** watchlist, carrying the row's Tag.
- **Auto-tag fix** is server-side (the client trigger point in `hooks/use-trades.ts` is off-limits per the "no new logic in use-trades" rule).

> **DECISION (confirm before Codex runs) #1 — lineage backfill:** `rootId` is forward-only by default; sheets created/duplicated *before* this migration each become their own lineage (existing "Copy of …" duplicates will NOT auto-group). A1b below is an OPTIONAL one-time name-based backfill if Jared wants the existing pile grouped. Default = skip A1b.
> **DECISION #2 — manual trade auto-tag:** Part C fixes the **import** path only. Manual single-trade entry (`POST /api/trades`) is out of scope and stays as-is. Confirm that's acceptable.

---

### Part A — Saved Sheets: name lineage + top-bar dropdown

A1. **Schema + migration.** In `lib/db/schema.ts`, add to the `sheets` table (after `columnsVersion`):
```ts
rootId: text('root_id'),
```
`null` = the sheet is its own lineage root. **No FK** — keep it a plain nullable `text` (not a self-reference). A self-FK with `onDelete` would scatter a lineage when its head sheet is deleted; with a plain column the surviving members keep their shared `rootId` and A4 just picks a new head. Then from repo root: `npm run db:generate` (creates `drizzle/0046_*.sql`), then **`npm run db:migrate`** (NOT `db:push`). Confirm the generated SQL only adds the nullable `root_id` column.

A1b. *(OPTIONAL — only if DECISION #1 = backfill.)* In the same migration file, append a one-time `UPDATE` that sets `root_id` for existing sheets by stripping leading `Copy of ` prefixes from `name`, grouping per `owner_user_id` + base name, and pointing each group's members at the earliest-created sheet's id. Best-effort only; leave `root_id` null where ambiguous.

A2. **Lineage assignment in routes.**
- `app/api/sheets/[id]/duplicate/route.ts`: in the insert `.values({...})`, add `rootId: source.rootId ?? source.id`. (A duplicate joins the source's lineage; duplicating a root points at the root's id.)
- `app/api/sheets/route.ts` POST: leave `rootId` unset (null) — fresh sheets are their own root.

A3. **Expose `rootId` in the list API.** In `app/api/sheets/route.ts` GET, add `rootId: sheets.rootId` to the `.select({...})`. In `hooks/use-sheets.ts`, add `rootId: string | null` to `SheetListItem`.

A4. **Group + UI in `components/trading/SheetsTab.tsx`.** Replace the left `<aside>` rail (the `lg:w-36` sidebar) with a compact bar **above** the sheet card. Grouping logic (pure, can live inline or in `lib/sheets/`):
- `groupKey = sheet.rootId ?? sheet.id`.
- Build groups from `visibleList`; within each group, the **head** = the sheet with the most recent `sheetDate` (fall back to `updatedAt`); the remaining members are the lineage's "past versions", sorted newest-date-first.
- The bar shows: a **lineage picker** (shadcn `DropdownMenu`) listing each group's head by name → opening one calls `sheets.openSheet(head.id)`; the **New sheet** `+` button (keep existing behavior); and — when the active sheet's lineage has past versions — a small **history icon button** (`History` from lucide, `h-4 w-4`, the `Icon button` hover pattern) to the right that opens a second `DropdownMenu` listing past versions by `sheetDate` → selecting one opens it.
- Dropdowns MUST use `bg-popover text-popover-foreground` (per the sheet/share dropdown token note), NOT `bg-accent`.
- Keep loading/empty states. The section is `bg-card border border-border rounded-2xl` if standalone, or fold into the existing sheet card header — match the surrounding density (see `frontend-design` skill).

A5. Tests: extend `__tests__/sheets-routes.test.ts` — duplicating a sheet sets `rootId = source.rootId ?? source.id` (assert the insert payload). No grouping unit test required unless you extract the grouping helper into `lib/sheets/` (if you do, add a small test there).

### Part B — Add-to-Watchlist default column

B1. **Column type.** In `lib/sheets/columns.ts`: add `'watchlist'` to the `SheetColumnType` union; append to `DEFAULT_SHEET_COLUMNS` (after `add_to_sample`): `{ key: 'add_to_watchlist', name: 'Watch', type: 'watchlist', locked: true }`. Also add `'watchlist'` to `SHEET_COLUMN_TYPES` in `lib/validations/sheets.ts` so column patches still validate.

B2. **Make it appear on existing sheets (no data migration).** In `lib/sheets/columns.ts`, add and export:
```ts
// Ensures every locked default column is present (older sheets snapshotted their
// columns before new defaults existed). Keeps existing order, appends missing
// locked defaults in canonical order. Pure — no DB.
export function ensureLockedColumns(columns: SheetColumn[]): SheetColumn[] { /* ... */ }
```
Apply it in `app/api/sheets/[id]/route.ts` GET, which currently does `return Response.json({ sheet, rows, members, role })` — change to `return Response.json({ sheet: { ...sheet, columns: ensureLockedColumns(sheet.columns) }, rows, members, role })`. (New sheets get the column from the default; old sheets get it injected at read-time. Read-time injection alone doesn't bump `columnsVersion`; it only persists if the owner later reorders/deletes columns and the client sends the full set back — which is fine since the Watch column is locked and non-deletable.)

B3. **Append endpoint.** Reuse `app/api/daily-reviews/append-watchlist/route.ts` — make it accept a bare ticker with tags and no report:
- `bodySchema`: make `reportId` **optional** (`z.string().min(1).max(128).optional()`); add `tags: z.array(z.string().trim().min(1).max(64)).max(10).optional()`.
- `newRow`: `tags: tags ?? []`; include `reportId` only when present (spread `...(reportId ? { reportId } : {})`).
- Dedupe: when `reportId` is present keep today's `(ticker, reportId)` check; when absent, dedupe on `ticker` alone (no-op if that ticker is already pinned for the date). This stays backward-compatible with the Research "+ Add to Watchlist" caller.

B4. **Cell in `SheetsTab.tsx`.** Extend `CellActions` with `addToWatchlist: (ticker: string, tag: string) => void;`. In the `gridColumns` actions object:
```ts
addToWatchlist: (ticker, tag) => {
  const date = format(new Date(), 'yyyy-MM-dd'); // import { format } from 'date-fns'
  void fetch('/api/daily-reviews/append-watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, ticker, tags: tag ? [tag] : [] }),
  }).then((res) => {
    if (res.ok) toast.success(`${ticker} added to today's watchlist`);
    else toast.error('Failed to add to watchlist');
  });
},
```
(Import `toast` from `sonner`.) In `buildColumn`, add a `column.type === 'watchlist'` branch mirroring the `'action'` branch (the add-to-sample `+` button): render an `Eye` (or `ListPlus`) lucide icon button, hidden (`—`) when the row has no ticker; onClick → `actions.addToWatchlist(String(row.ticker ?? '').trim(), String(row.tag ?? '').trim())`. Works for viewers too (same as report/chart/sample cells — they're read actions, not row edits).

B5. Tests: in `__tests__/` for the append-watchlist route — appending with `tags` and no `reportId` writes a row with those tags; backward-compat: the existing reportId path still works; `ensureLockedColumns` unit test (missing `add_to_watchlist` gets appended; already-present is untouched; order preserved).

### Part C — Watchlist auto-tag on import (server-side)

Root cause (confirmed): watchlist→trade tagging only runs in `DailyReportSheet.handleSave` (`components/trading/DailyReportSheet.tsx:196`), against trades present at save time. Imports land later via `/api/trades/import-raw` and never get tagged. The natural client trigger (`processImportFiles` in `hooks/use-trades.ts`) is off-limits per the no-new-logic-in-use-trades rule, so the fix is server-side.

C1a. **Widen the matcher's param type** (so the server can call it without constructing full `Trade` objects). In `lib/watchlist.ts`, `buildWatchlistTradeTagAssignments` only reads `.id`, `.symbol`, `.tags`. Change its first parameter from `trades: Trade[]` to `trades: Array<{ id: string; symbol: string; tags?: string[] }>`. `Trade` still satisfies this, so the existing `DailyReportSheet` caller and `__tests__/watchlist.test.ts` keep typechecking; the `Trade` import there can stay (or drop if now unused). This is the only change to the existing file.

C1b. **Server helper.** New file `lib/watchlist-server.ts`:
```ts
export async function applyWatchlistTagsForDate(db, userId: string, date: string): Promise<void>
```
(`db` is the `getPoolDb()` handle passed from the route — type it to match how other server helpers type their db param.)
- Load the daily review for `(userId, date)`; `coerceWatchlistRows(reportData[WATCHLIST_REPORT_KEY])` (import `coerceWatchlistRows`, `WATCHLIST_REPORT_KEY` from `@/lib/watchlist` — these are type-only/server-safe; the existing append-watchlist route already imports from there server-side). If no review or empty watchlist → return.
- Load `trades` for `(userId, date)` selecting `{ id: trades.id, symbol: trades.symbol }` (`trades.date` is a `text` column, `trades.userId` exists — see the `import-raw` `openRows` query).
- Build assignments with `buildWatchlistTradeTagAssignments(rows, watchlist)` where `rows` is the `{ id, symbol }[]` from the select (the widened type accepts it; the inserts below are `onConflictDoNothing`, so already-present tags are skipped).
- For each assignment: `insert(tags).values({ userId, name }).onConflictDoNothing()` for every tag, then `insert(tradeTags).values({ userId, tradeId, tag }).onConflictDoNothing()`. (Mirror the tag-write pattern in `app/api/tags/route.ts` PATCH.)
- No transaction needed; keep it best-effort.

C2. **Call it after import.** In `app/api/trades/import-raw/route.ts` POST, **after** the existing transaction commits (just before building the `Response`), add:
```ts
try {
  await applyWatchlistTagsForDate(db, authState.user.id, sortKey);
} catch (err) {
  logRouteError('trades.import-raw.watchlist-tags', err);
}
```
`sortKey` is the imported date. The catch ensures a tagging failure never fails an import. The client already calls `refreshTrades()` after import, so the new tags show up with no client change.

C3. Tests: new `__tests__/watchlist-server.test.ts` — a trade whose symbol matches a watchlisted ticker for that date gets the watchlist tag inserted; no daily review → no inserts; non-matching symbol → no inserts; tag already present → `onConflictDoNothing` (no error). Follow the route-test DB-mock style.

### Validation (run after EACH part)
- `npm run lint` && `npx tsc --noEmit` && `npm test`.
- Part A only: `npm run db:migrate` was run and committed alongside `drizzle/0046_*.sql`.
- If `AGENTS.md` Sheets bullet is updated (note lineage grouping + Watch column), run `npm run workflow:audit`.

### Acceptance criteria
- **A:** Sheets show as a compact top-bar dropdown (no left rail). Duplicates of the same lineage nest under one head; a history icon reveals past dated versions. New duplicates link to their source's lineage.
- **B:** Every sheet (new and pre-existing) shows a locked "Watch" action column. Clicking it adds the row's ticker — with its Tag — to today's watchlist; a toast confirms; re-clicking the same ticker is a no-op.
- **C:** Importing trades for a date auto-applies that day's watchlist tags to matching tickers, with no manual review save. The daily-review-save path still works (complementary). Manual single-trade entry is unchanged (per DECISION #2).
- All four validations green; migration committed.
- Manual smoke (Jared, post-merge): duplicate a sheet across two dates and confirm grouping; add a ticker to the watchlist from a sheet; import a CSV for a watchlisted ticker and confirm the trade is auto-tagged.

### Notes for Codex
- Parts are independent — A (UI + migration), B (column + endpoint), C (import tagging) can land as separate commits.
- Do NOT touch `hooks/use-trades.ts` for Part C — the fix is entirely server-side.
- For A, prefer `DropdownMenu` (shadcn, already in `components/ui/`) over a hand-rolled menu; tokens `bg-popover text-popover-foreground`.
- `ensureLockedColumns` must be pure and order-stable so it doesn't churn `columnsVersion` or reorder a user's columns.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

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
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation. (drag-reorder rows/columns + tags-in-Tag-column shipped; lineage UI + Watch column + import auto-tag are the active Sprint 6 spec above.)

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
