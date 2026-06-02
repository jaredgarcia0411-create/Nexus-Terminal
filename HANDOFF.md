# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-02
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Active Spec — Calendar: Year Overview + day $/R sizing

Status: implemented 2026-06-02. Validation passed: `npm run lint`, `npx tsc --noEmit`, `npm test` (105 files / 772 tests), `npm run workflow:audit`. No `services/` changes; no API/DB/migration.

Goal: Add a **Year Overview** mode to the Calendar sub-tab (Management → Calendar — the tab formerly "Journal"; internal sub-tab key is still `journal`, file `components/trading/JournalTab.tsx`). The default Calendar view is unchanged — current-month full calendar + day cards. A new **Year Overview** button enters a mode that shows, top to bottom: a header bar (back arrow + centered "Year Overview" title + year toggle), the opened month's full calendar, then a grid of 12 compact mini-month calendars. Clicking a month's **Open** button jumps the full calendar to that month; the opened month's card reads **Active**. Clicking dates on the full calendar still drives the existing daily-review / trades flow. Also bump the day $/R numbers on the full calendar one step and drop the bold — they look grainy.

Purely client-side: no API, no DB, no migration. All data comes from the already-in-memory `filteredTrades`.

Confirmed decisions (Jared, 2026-06-02):
- Two modes via a toggle. Default = today's behavior; the back arrow returns to the current month.
- Mini-month days are **display-only** (tinted by net P&L). Navigation is the **Open** button; date-level review still happens on the full calendar.
- Year-toggle years are derived from trades, plus the current year.
- $/R sizing: $ → `text-base` (16px) `font-semibold`; R → `text-sm` (14px) `font-medium`. Bold dropped on both day cells and the weekly-total column.

### Step 1 — Daily P&L helper
File `lib/journal-aggregates.ts`. Add after `isCrossDayTrade`:
```ts
// Net P&L per calendar day (bucketed by close date) for the mini-month
// calendars. Skips still-open trades.
export function dailyPnlByDate(trades: Trade[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const trade of trades) {
    if (trade.isOpen) continue;
    const key = bucketKey(trade);
    map.set(key, (map.get(key) ?? 0) + trade.netPnl);
  }
  return map;
}
```

### Step 2 — Test the helper
File `__tests__/journal-aggregates.test.ts`. Add a `describe('dailyPnlByDate', ...)` that reuses the existing `makeTrade(...)` fixture helper at the top of the file (and adds `dailyPnlByDate` to the `@/lib/journal-aggregates` import). Cover: (a) multiple trades on the same day sum into one key; (b) `isOpen` trades are excluded; (c) a cross-day trade (set via `closedAt` one day after `date`) buckets under its close date.

### Step 3 — MiniMonthCalendar component
New file `components/trading/MiniMonthCalendar.tsx`. A compact, display-only month grid. Follow the frontend-design skill for tokens/radii.
Props:
```ts
interface MiniMonthCalendarProps {
  monthDate: Date;                 // any date inside the month to render
  pnlByDate: Map<string, number>;
  isActive: boolean;               // this month is the one open in the full calendar
  onOpen: () => void;
}
```
Build the grid with date-fns:
```ts
const monthStart = startOfMonth(monthDate);
const days = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(endOfMonth(monthStart)) });
```
Layout:
- Card: `rounded-xl border border-border bg-card p-4`.
- Header: `mb-3 flex items-center justify-between`.
  - Left: `<span className="text-sm font-semibold text-foreground">{format(monthDate, 'MMMM, yyyy')}</span>`.
  - Right: Open/Active button — `rounded-md px-3 py-1 text-xs font-medium transition-colors`, `onClick={onOpen}`. Active → `border border-primary/40 bg-primary/10 text-primary` reading "Active"; inactive → `bg-accent text-muted-foreground hover:bg-accent/80 hover:text-foreground` reading "Open".
- Weekday row: `grid grid-cols-7`, each `text-center text-[10px] font-bold tracking-widest text-muted-foreground` (Sun..Sat).
- Day grid: `grid grid-cols-7 gap-1`. Per day:
  - `const key = format(day, 'yyyy-MM-dd'); const pnl = pnlByDate.get(key) ?? 0; const inMonth = isSameMonth(day, monthStart);` (the `?? 0` keeps `pnl` typed as `number`, so the comparisons below don't trip `strictNullChecks`).
  - base: `flex h-8 items-center justify-center rounded text-sm font-mono tabular-nums`
  - `!inMonth` → add `text-muted-foreground/30`
  - `inMonth && pnl > 0` → `bg-emerald-500/10 text-emerald-400`
  - `inMonth && pnl < 0` → `bg-rose-500/10 text-rose-400`
  - `inMonth` otherwise (no trades / breakeven) → `text-foreground`
  - content `{format(day, 'd')}`
- No per-day `onClick`.

### Step 4 — YearOverview component
New file `components/trading/YearOverview.tsx`. Renders only the 12-card grid (the header bar lives in JournalTab).
Props:
```ts
interface YearOverviewProps {
  trades: Trade[];
  year: number;
  activeMonth: Date;
  onOpenMonth: (monthDate: Date) => void;
}
```
Body:
```tsx
const pnlByDate = useMemo(() => dailyPnlByDate(trades), [trades]);
const months = Array.from({ length: 12 }, (_, m) => new Date(year, m, 1));
return (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {months.map((m) => (
      <MiniMonthCalendar
        key={m.getMonth()}
        monthDate={m}
        pnlByDate={pnlByDate}
        isActive={isSameMonth(m, activeMonth)}
        onOpen={() => onOpenMonth(m)}
      />
    ))}
  </div>
);
```
Imports: `useMemo` (react); `isSameMonth` (date-fns); `dailyPnlByDate` (`@/lib/journal-aggregates`); `MiniMonthCalendar`; `Trade` type (`@/lib/types`).

### Step 5 — TradingCalendar: controlled month + $/R sizing
File `components/trading/TradingCalendar.tsx`.
1. Add to `TradingCalendarProps` (mirror the existing controlled `selectedDate` pattern):
```ts
month?: Date;
onMonthChange?: (month: Date) => void;
```
2. Destructure with renames in the component signature: `month: controlledMonth`, `onMonthChange`.
3. Replace `const [currentMonth, setCurrentMonth] = React.useState(new Date());` with:
```ts
const [internalMonth, setInternalMonth] = React.useState(new Date());
const currentMonth = controlledMonth !== undefined ? controlledMonth : internalMonth;
const setMonth = (next: Date) => {
  if (onMonthChange) onMonthChange(next);
  else setInternalMonth(next);
};
```
4. `nextMonth` → `setMonth(addMonths(currentMonth, 1))`; `prevMonth` → `setMonth(subMonths(currentMonth, 1))`.
5. $/R sizing (drop bold, bump one step):
   - Day $ div (`getPnLColor(stats.pnl)`): `${isMobile ? 'text-[13px]' : 'text-[14px]'} font-bold` → `${isMobile ? 'text-[13px]' : 'text-base'} font-semibold`.
   - Day R div: `${isMobile ? 'text-[12px]' : 'text-[13px]'} font-medium opacity-60` → `${isMobile ? 'text-[12px]' : 'text-sm'} font-medium opacity-60`.
   - Weekly $ div: `text-[14px] font-bold` → `text-base font-semibold`.
   - Weekly R div: `text-[13px] font-medium opacity-70` → `text-sm font-medium opacity-70`.

### Step 6 — JournalTab: mode state + restructure
File `components/trading/JournalTab.tsx`.
1. Imports: add `ArrowLeft, LayoutGrid` to the lucide-react import; add `import YearOverview from '@/components/trading/YearOverview';`.
2. New state (near the other `useState`s):
```ts
const [yearOverview, setYearOverview] = useState(false);
const [calMonth, setCalMonth] = useState<Date>(() => new Date());
const [overviewYear, setOverviewYear] = useState<number>(() => new Date().getFullYear());
```
3. Available years (after the `dayCards` / `displayedDayCards` memos):
```ts
const availableYears = useMemo(() => {
  const years = new Set<number>([new Date().getFullYear()]);
  for (const trade of filteredTrades) years.add(trade.date.getFullYear());
  return [...years].sort((a, b) => a - b);
}, [filteredTrades]);
```
4. Top toolbar (the first `flex flex-wrap items-center justify-between` row): keep the search input as the left child. Replace the right child (currently the `{selectedIds.size > 0 ? (...) : null}` block) so the risk/tag controls AND a new Year Overview button share the right side:
```tsx
<div className="flex flex-wrap items-center gap-2">
  {selectedIds.size > 0 ? (
    <div className="animate-in slide-in-from-right-2 fade-in flex items-center gap-2">
      {/* …existing Set Risk + Add Tag controls, unchanged… */}
    </div>
  ) : null}
  {!yearOverview ? (
    <button
      type="button"
      onClick={() => { setOverviewYear(calMonth.getFullYear()); setYearOverview(true); }}
      className="flex items-center gap-2 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
    >
      <LayoutGrid className="h-4 w-4" /> Year Overview
    </button>
  ) : null}
</div>
```
5. Year-overview header bar — render directly **above** `<TradingCalendar …>`, only when `yearOverview`:
```tsx
{yearOverview ? (
  <div className="grid grid-cols-3 items-center">
    <button
      type="button"
      onClick={() => { setYearOverview(false); setCalMonth(new Date()); setSelectedDate(null); setDrcDate(null); }}
      className="flex h-8 w-8 items-center justify-center justify-self-start rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label="Back to calendar"
      title="Back to calendar"
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
    <h3 className="justify-self-center text-base font-semibold text-foreground">Year Overview</h3>
    <div className="flex items-center gap-1 justify-self-end rounded-lg border border-border bg-accent p-0.5">
      {availableYears.map((y) => (
        <button
          key={y}
          type="button"
          onClick={() => setOverviewYear(y)}
          className={`rounded-md px-3 py-1 text-sm tabular-nums transition-colors ${y === overviewYear ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {y}
        </button>
      ))}
    </div>
  </div>
) : null}
```
6. `<TradingCalendar>` call: add `month={calMonth}` and `onMonthChange={setCalMonth}` (keep existing `trades`, `selectedDate`, `onDayClick`, `onWeekClick`).
7. Directly **below** `<TradingCalendar>` and **above** the day-cards `<div className="space-y-4">`, render the grid only in overview mode:
```tsx
{yearOverview ? (
  <YearOverview
    trades={filteredTrades}
    year={overviewYear}
    activeMonth={calMonth}
    onOpenMonth={(d) => setCalMonth(d)}
  />
) : null}
```

Behavior recap: default = current-month calendar + day cards (+ a "Year Overview" button). Year Overview = header bar + full calendar (controlled month) + 12 mini-months; Open swaps the month, Active marks the open one, back arrow resets to the current month and exits. The day-cards list and DailyReportSheet / WeeklyReviewSheet stay below in both modes, so date clicks still open reviews/trades.

### Validation
- `npm run lint` && `npx tsc --noEmit` && `npm test`.
- No `services/` change → `typecheck:services` not required. No migration.

### Acceptance criteria
- Calendar tab still opens on the current month with day cards (unchanged), plus a Year Overview button.
- Year Overview shows 12 mini-months for the selected year, each tinted by daily P&L, with Open/Active buttons; the year toggle lists trade years + the current year.
- Opening a month moves the full calendar to it (Active highlight); clicking a date there still opens the daily review and narrows the day list.
- Back arrow returns to the current-month default view.
- Day and weekly $/R numbers are one step larger and no longer bold (no grain).

### Notes for Codex
- No API/DB/migration — client-only.
- Reuse `dailyPnlByDate`, `formatCurrency` / `formatR` / `getPnLColor`, `bucketKey` — don't write new P&L math.
- Keep `TradingCalendar` generic: the controlled `month` mirrors the existing controlled `selectedDate`; do not add overview-specific logic inside it.
- Follow the frontend-design skill for the new components (semantic tokens, radius hierarchy, calendar-header type).

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

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
