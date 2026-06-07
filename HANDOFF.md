# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-07
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

> **Parked:** the Scanner Epic 1 execution spec was moved to `specs/scanner-epic1-handoff.md` (not started — still waiting on the worktree + Neon-branch setup). Move it back here when you're ready to run it.

---

## COMPLETED — Sheets Spec 2b: Sheet chart-cell sim workspace (frontend)

Status: completed 2026-06-07; ready for Jared post-merge smoke.

Outcome:
- Extracted the chart sim workspace into `components/trading/BacktestChartWorkspace.tsx`, including session loading, order placement, risk persistence, review actions, forward-day controls, chart-state capture, and the place-order dialog.
- `BacktestingTab` now owns Charts-only view/navigation chrome and passes the manager button, lookup/name toolbar, and `BacktestingSidebar` rail as slots. It also passes the active backtest summary because the live `BacktestSimPanel` uses it for named-backtest save/review behavior.
- Sheet chart cells now pass `sheetRowId={row.__id}` into a full-screen workspace dialog, giving each sheet row its own isolated sim session. `WatchlistTickerChart` was removed from `SheetsTab` imports.

Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` (106 files / 787 tests), and `npm run build` all passed. No `services/` changes.

> Builds on 2a (shipped, commit `f24121d`), which added per-row backtest-session isolation via an optional `sheetRowId`. **2b is the UI half:** extract the Charts chart-workspace into a shared `BacktestChartWorkspace` component, then mount it in a full-screen dialog launched from the sheet's chart cell, passing `sheetRowId` so each row gets its own isolated sim. The Charts tab must look and behave **exactly** as today after this refactor.
> The Scanner Epic 1 spec stays parked in `specs/scanner-epic1-handoff.md`.

### Design (read first)
Today the entire chart workspace lives inline in `BacktestingTab.tsx` inside the `view.kind === 'chart'` block (lines ~346–558) plus its supporting state/handlers (lines ~118–296). We pull the **session-driven core** (chart grid + trade menu + armed banner + sim panel + place-order dialog, and the state that drives them) into a new reusable component. The bits that are specific to the Charts tab — the back-to-Manager button, the ticker **lookup form** / backtest-name, and the **selection rail** (`BacktestingSidebar`, which browses sample-sets/system tickers) — stay in `BacktestingTab` and are passed into the workspace as **slots**. The sheet dialog passes none of those slots, so a sheet row gets the full sim minus the Charts-only navigation chrome. This matches the locked decisions: **full-screen dialog · full sim parity · one isolated session per row · extract & share.**

Ownership split:
- **Parent owns** `ticker`/`date` (Charts keeps them in `view`; the sheet keeps them in `chartDialog`). Parent passes them down controlled, plus an `onAnchorChange` callback the workspace calls when the chart shifts its anchor date.
- **Workspace owns** everything session/sim/transient: `rightCollapsed` (+ its localStorage persistence), `riskDollars` (+ `nexus-default-risk` persistence), `armedAction`, `pendingOrder`, `extraSessionsForward`, `latestChartStateRef`, the `useBacktestSession` call, the `esc` hotkey, and all the handlers (`updateRisk`, `placeAction`, `handleArmedClick`, `handleChartStateChange`). `backtestId`, `sheetRowId`, `autoLoadReviewId`, `currentUserId` come in as props.

Why slots instead of a `variant` flag: two consumers with a few differing nodes — explicit optional `ReactNode` slots (and one render-prop for the right panel) keep Charts' current DOM/layout byte-for-byte while letting the sheet omit chrome. No `variant: 'charts' | 'sheet'` enum (that pattern hides branching and is the kind of indirection we avoid).

### Step 1 — Create `components/trading/BacktestChartWorkspace.tsx` (NEW, `'use client'`)
Move the chart-workspace core out of `BacktestingTab`. The component renders the **grid layout div that is currently the inner content of the `view.kind === 'chart'` `motion.div`** (the `className={rightCollapsed ? ... : ...}` grid at lines ~352–557) as its root element, plus the `<BacktestPlaceOrderDialog>` (lines ~561–573) after it (wrap both in a fragment).

1. Props interface:
   ```ts
   import { type ReactNode } from 'react';
   import type { BacktestActionType } from '@/lib/types';

   interface BacktestChartWorkspaceProps {
     ticker: string | null;
     date: string | null;
     currentUserId: string | null;
     backtestId?: string | null;       // Charts backtest context; null elsewhere
     sheetRowId?: string | null;       // sheet-row isolation key; null on Charts
     autoLoadReviewId?: string | null; // Charts manager "launch with review"; null elsewhere
     onAnchorChange?: (date: string) => void;
     headerLeft?: ReactNode;           // top bar left slot (Charts: back-to-manager button)
     toolbarLeft?: ReactNode;          // second-row left slot (Charts: lookup form OR backtest name)
     renderRightPanel?: (simPanel: ReactNode) => ReactNode; // wrap the sim panel (Charts: BacktestingSidebar)
   }
   ```
   Default `backtestId`, `sheetRowId`, `autoLoadReviewId` to `null` in the destructure.

2. **Move into this component, verbatim, from `BacktestingTab`:** the state/refs/handlers at lines ~118–296 that the chart block uses — `rightCollapsed` (+ its persistence `useEffect`, the `getInitialRightCollapsed` helper, and the `CHARTS_RIGHT_COLLAPSED_KEY` constant), `riskDollars` (+ `getInitialRiskDollars`, the `nexus-default-risk` writes inside `updateRisk`), `armedAction`, `pendingOrder`, `extraSessionsForward`, `latestChartStateRef`, the `useBacktestSession` call, the read-only chart-state reset `useEffect`, `handleChartStateChange`, the `useHotkeys('esc', ...)`, `effectiveRiskDollars`, `chartGridKey`, `updateRisk`, `placeAction`, `handleArmedClick`. Bring the matching imports (`useBacktestSession`, `BacktestChartGrid`, `BacktestSimPanel`, `BacktestTradeMenu`, `BacktestPlaceOrderDialog` + its `BacktestOrderDraft` type, `Button`, `Input`, `useHotkeys`, the lucide icons actually used by the moved markup, `BacktestActionType`/`BacktestChartState` types).

3. **`selected`** inside the workspace is derived from the `ticker`/`date` props: `const selected = ticker && date ? { ticker, date } : null;`.

4. **`useBacktestSession`** call uses the props: `{ ticker, date, riskDollars, backtestId, sheetRowId, autoLoadReviewId }`. (2a already added `sheetRowId` to the hook input.)

5. **Anchor change:** the chart grid's `onAnchorChange` must call the prop. Define a local `const handleAnchorChange = useCallback((newDate: string) => { setExtraSessionsForward(0); onAnchorChange?.(newDate); }, [onAnchorChange]);` and pass it to `<BacktestChartGrid onAnchorChange={handleAnchorChange} />`. (The old version also mutated `view.date`; that now happens in the parent via the callback.)

6. **Slots in the markup:**
   - Top bar left cell (currently the back-to-manager `<button>`): replace with `{headerLeft}`.
   - Second toolbar's left cell (currently the `!view.id ? <lookup form> : <backtest name>`): replace with `{toolbarLeft}`.
   - The top-bar **center** (ticker/date display) and the **collapse toggle** (top-bar right) stay in the workspace — both consumers want them.
   - **Right panel:** today the sim panel is passed as `topPanel` into `<BacktestingSidebar>`. Build the sim panel element once as a `const simPanel = (<BacktestSimPanel ... />)` using the workspace's session state (same props as today, but `activeBacktest` derives from the `backtestId` prop — since the workspace no longer has `view.name`/`view.userId`, pass `activeBacktest={null}` for now; the backtest name/owner display is Charts-sidebar chrome that the sidebar itself reloads from `activeBacktestId`, so this is not a regression — confirm in smoke). Then render `{renderRightPanel ? renderRightPanel(simPanel) : <aside className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-border bg-background"><div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{simPanel}</div></aside>}` in the `{!rightCollapsed ? ... : null}` slot.
   - **Place-order dialog:** render `<BacktestPlaceOrderDialog>` (moved verbatim) as the second fragment child, after the grid div.

> Note on `activeBacktest`: in the current Charts code the sim panel receives `activeBacktest` built from `view.id/name/userId`. The sidebar (Charts-only) already independently fetches the backtest by `activeBacktestId`. Passing `activeBacktest={null}` to the sim panel changes only what the **panel** itself shows for an active-backtest label. If smoke shows the Charts panel lost a needed label, add an optional `activeBacktest?: {id,name,userId} | null` prop to the workspace and have `BacktestingTab` pass it; the sheet passes nothing. Prefer the no-prop version unless smoke proves it's needed — don't add the prop speculatively.

### Step 2 — Refactor `BacktestingTab.tsx` to use the workspace
1. Delete the moved state/handlers/effects/constants/imports from Step 1.2 (now in the workspace). Keep everything tied to view-switching and Charts chrome: `view`, the `CHARTS_VIEW_KEY`/`CHARTS_LAST_TICKER_KEY` persistence, `getInitialView`, `getPersistedTicker`, `todayIsoDate`, `lookupTicker`/`lookupDate` + `handleLookupSubmit` + `lookupValid`, `openChartView`, `handleSelect`, `resetTransientState`, `autoLoadReviewId`, the mount-hydrate effect, manager/stats views.
2. `handleAnchorChange` here becomes the callback the workspace calls: keep it updating `view.date` (`setView((c) => c.kind === 'chart' ? { ...c, date: newDate } : c)`), drop the `setExtraSessionsForward(0)` line (the workspace resets its own forward count).
3. Replace the entire inner content of the `view.kind === 'chart'` `motion.div` with:
   ```tsx
   <BacktestChartWorkspace
     ticker={view.ticker}
     date={view.date}
     currentUserId={currentUserId}
     backtestId={view.id}
     autoLoadReviewId={autoLoadReviewId}
     onAnchorChange={handleAnchorChange}
     headerLeft={
       <button type="button" onClick={() => setView({ kind: 'manager' })} /* ...existing back-button markup... */ >
         <ChevronLeft className="h-3.5 w-3.5" /> Backtest Manager
       </button>
     }
     toolbarLeft={
       !view.id
         ? <form onSubmit={handleLookupSubmit} /* ...existing lookup form... */ />
         : <div className="flex min-w-0 items-center px-2"><span className="truncate text-sm font-medium text-foreground">{view.name ?? 'Backtest'}</span></div>
     }
     renderRightPanel={(simPanel) => (
       <BacktestingSidebar
         selected={view.ticker && view.date ? { ticker: view.ticker, date: view.date } : null}
         onSelect={handleSelect}
         activeBacktestId={view.id}
         topPanel={simPanel}
       />
     )}
   />
   ```
   Keep the surrounding `<motion.div key="chart" ...>` wrapper exactly as-is so Charts' transitions are unchanged. Move the back-button and lookup-form JSX from their old inline positions into these slots verbatim (same classNames/handlers).
4. `BacktestingSidebar`, `BacktestPlaceOrderDialog`, `BacktestChartGrid`, `BacktestSimPanel`, `BacktestTradeMenu`, `useBacktestSession`, `useHotkeys`, `Input`, `Search` import: remove any that are now only used by the workspace; keep `BacktestingSidebar`, `Button`, `Input`/`Search` (lookup form), `ChevronLeft` (back button), the manager/stats imports. Let `npm run lint` flag unused imports and remove them.

### Step 3 — Sheet chart cell → full-screen workspace dialog (`components/trading/SheetsTab.tsx`)
1. Add `import { useSession } from 'next-auth/react';` and inside `SheetsTab()` derive `const { data: session } = useSession(); const currentUserId = (session?.user as { id?: string | null } | undefined)?.id ?? null;` (the sim panel needs the viewer id for review ownership).
2. Add `import BacktestChartWorkspace from '@/components/trading/BacktestChartWorkspace';` and remove the `WatchlistTickerChart` import (it stays in the repo — Watchlist still uses it — just drop it here).
3. `chartDialog` state: change to carry the row id — `useState<{ ticker: string; date: string; rowId: string } | null>(null)` (line 573).
4. `CellActions.openChart` signature (line 229) → `openChart: (ticker: string, date: string, rowId: string) => void;`. The chart cell `renderCell` (line ~428) calls `actions.openChart(ticker, date, String(row.__id))` — **`row.__id` is the sheet-row id** (GridRow stores it as `__id`, not `id`). The `actions` impl (line 662) becomes `openChart: (ticker, date, rowId) => setChartDialog({ ticker, date, rowId })`.
5. Replace the chart `<Dialog>` (lines ~1098–1105) with a **full-screen** dialog hosting the workspace:
   ```tsx
   <Dialog open={!!chartDialog} onOpenChange={(open) => !open && setChartDialog(null)}>
     <DialogContent className="h-[100dvh] w-screen max-w-none gap-0 rounded-none border-0 p-0 sm:max-w-none">
       <DialogHeader className="sr-only"><DialogTitle>Chart</DialogTitle></DialogHeader>
       {chartDialog ? (
         <div className="flex h-full min-h-0 flex-col overflow-hidden p-3 pt-9">
           <BacktestChartWorkspace
             ticker={chartDialog.ticker}
             date={chartDialog.date}
             sheetRowId={chartDialog.rowId}
             currentUserId={currentUserId}
             onAnchorChange={(date) => setChartDialog((c) => (c ? { ...c, date } : c))}
           />
         </div>
       ) : null}
     </DialogContent>
   </Dialog>
   ```
   - `max-w-none`/`w-screen`/`h-[100dvh]`/`rounded-none`/`p-0` override the primitive's `sm:max-w-lg` cap (dialog.tsx line 64) to make it full-screen. `pt-9` leaves room for the Radix close (×) button at `top-4 right-4`. The `sr-only` header keeps an accessible title without visible chrome (Radix requires a `DialogTitle`).
   - The wrapping `div` must give the workspace a real height (the workspace grid uses `min-h-0 flex-1`), hence `flex h-full min-h-0 flex-col`.
   - No `headerLeft`/`toolbarLeft`/`renderRightPanel` → the workspace renders its default plain-`<aside>` sim panel, no back button, no lookup form, no selection rail. Esc closes the dialog (returns to the row) — acceptable; do not add custom esc handling.

### Validation (run from repo root, report pass/fail for each)
1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. `npm run build` — this is a real component refactor touching imports/JSX across two large client components; the lint+tsc gates miss production-build issues, so build before declaring done.
- No `services/` → skip `typecheck:services`. No workflow assets → skip `workflow:audit`.

### Manual smoke (Jared, post-merge)
- **Charts unchanged:** open Charts, lookup a ticker, arm + place a trade, adjust risk, +/- forward days, collapse/expand panel, save a review, reload (returns to chart), back to Manager, launch a backtest with a review. All identical to before.
- **Sheet sim:** add two rows with the **same ticker + date**; open each row's chart cell → full-screen workspace; place a trade in row A; confirm row B's chart opens to an **empty** session (isolation works — this is what 2a enabled). Save a review in row A, reopen row A → its review is there; row B does not show row A's review.
- Esc (or ×) closes the dialog back to the sheet.

### Acceptance criteria
- New `BacktestChartWorkspace` renders the full sim workspace and is used by **both** `BacktestingTab` (with slots) and the sheet chart-cell dialog (no slots).
- Charts tab behavior + layout unchanged (lookup, back-to-manager, selection rail, reviews, risk, forward days, collapse all work as before).
- Sheet chart cell opens a full-screen dialog with a working, **per-row isolated** sim (passes `sheetRowId={row.__id}`); two rows sharing a ticker/date do not share a session or reviews.
- `WatchlistTickerChart` import removed from `SheetsTab` (component itself retained for Watchlist).
- lint + tsc + test + build all green.

### Out of scope (Spec 3 — do NOT build here)
The R locked default column showing the row's sim R-result, and removing the `add_to_sample` default column.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

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
