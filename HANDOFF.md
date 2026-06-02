# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-01
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Active Spec — Sheets Sprint 4: Research Notebook Core

Status: implemented 2026-06-01. Validation passed: `npm run lint`, `npx tsc --noEmit`, `npm test` (751 passed), and `npm run workflow:audit`. Manual authenticated smoke remains a Jared post-merge task per the acceptance criteria.

Goal: make the three locked default columns (Research Report, Chart, Add to Sample) actually do something, and let the Research page push a ticker into a sheet. This is the feature's actual value prop — those cells are inert placeholders today (`components/trading/SheetsTab.tsx:81` returns the bare column for `report`/`chart`/`action`).

Out of scope this sprint (Sprint 5+): templates / "start today's sheet", CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation, drag-reorder, self-leave/ownership-transfer, invite notifications.

Locked decisions:
- The cells reuse the existing watchlist viewers. `react-data-grid` rows are fixed-height, so open a **modal dialog** on click rather than expanding the row inline.
- The chart needs **no stored data** — it derives from the row's own `ticker` + `date` cell values. The report cell uses the stored `research_report` value (a `research_reports.id` string). Add-to-Sample stores nothing.
- Import appends one row with `values = { ticker, date, research_report? }`. `reportId` is **optional** here (unlike the watchlist button, which requires it — a sheet row is still useful with just ticker/date/chart). Dedupe by `(ticker, date)` within the sheet.
- The three cells work for **viewers too** (read-only viewing of a report/chart is fine; Add-to-Sample creates a sample set the acting user owns). Only text/select/checkbox *editing* stays gated by `canEditRows`.
- **No migration this sprint** — no schema change, so no `db:migrate` step.

### Part A — Interactive grid cells (`components/trading/SheetsTab.tsx`)

A1. Add imports:
- `import WatchlistReportInline from '@/components/trading/WatchlistReportInline';`
- `import WatchlistTickerChart from '@/components/trading/WatchlistTickerChart';`
- `import WatchlistSavePicker from '@/components/trading/WatchlistSavePicker';`
- From `@/components/ui/dialog`: `Dialog, DialogContent, DialogHeader, DialogTitle`.
- Add `FileText, LineChart` to the existing `lucide-react` import (line 5; `Plus` is already imported).
- `import type { SampleSetRow } from '@/lib/sample-set-csv';`

A2. Define a cell-actions type above `buildColumn`:
```ts
type CellActions = {
  openReport: (reportId: string) => void;
  openChart: (ticker: string, date: string) => void;
  addToSample: (ticker: string, date: string) => void;
};
```

A3. Change `buildColumn` to take `actions: CellActions` and replace the inert branch at line 81. Do **not** short-circuit report/chart/action when `!canEdit` — only return bare `base` for the *non-special* types when `!canEdit`. Restructure so:
- `checkbox` branch stays as-is.
- New branch: `if (column.type === 'report')` → `renderCell` reads `const reportId = String(row[column.key] ?? '').trim();`. Empty → render the muted dash cell; else a centered `FileText` icon button calling `actions.openReport(reportId)`.
- `if (column.type === 'chart')` → reads `const ticker = String(row.ticker ?? '').trim(); const date = String(row.date ?? '').trim();`. If `!ticker || !date` → dash; else centered `LineChart` button → `actions.openChart(ticker, date)`.
- `if (column.type === 'action')` → reads same `ticker`/`date`. If `!ticker` → dash; else centered `Plus` button → `actions.addToSample(ticker, date)`.
- After the three special branches: `if (!canEdit) return base;` then a new `date` branch (A3a, below), then the existing `select` / `TEXT_EDIT_TYPES` editor branches. The `date` branch must come **before** the `TEXT_EDIT_TYPES.includes(column.type)` check, because `TEXT_EDIT_TYPES` still contains `'date'` (`lib/sheets/grid.ts:28`) and would otherwise grab it first. Leave `TEXT_EDIT_TYPES` as-is — don't remove `'date'` from it (the values-extraction helpers rely on it elsewhere).

A3a. Add a `DateCellEditor` component next to `SelectCellEditor` (mirror its exact shape), using a native date input so the cell always stores `YYYY-MM-DD`:
```tsx
function DateCellEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<GridRow>) {
  return (
    <input
      type="date"
      autoFocus
      className="h-full w-full border-2 border-ring bg-card px-1 text-sm text-foreground outline-none [color-scheme:dark]"
      value={(row[column.key] as string) ?? ''}
      onChange={(event) => onRowChange({ ...row, [column.key]: event.target.value }, true)}
      onBlur={() => onClose(true)}
    />
  );
}
```
Then in `buildColumn`: `if (column.type === 'date') return { ...base, renderEditCell: (props) => <DateCellEditor {...props} /> };`. The `[color-scheme:dark]` class matches the app's other native date inputs (`SheetFormDialog.tsx:90`). This applies to the locked `Date` column **and** any user-added date column.

Reuse the centered-button styling from `WatchlistEditor.tsx`'s `ReportCell`/`ChartCell` (`flex items-center justify-center` wrapper; button `rounded-md p-1 text-primary hover:bg-accent hover:text-primary/80`; dash cell `text-xs text-muted-foreground`). Keep it minimal — no new abstractions.

A4. In `SheetsTab`, add state near the other dialog state:
```ts
const [reportDialog, setReportDialog] = useState<{ reportId: string } | null>(null);
const [chartDialog, setChartDialog] = useState<{ ticker: string; date: string } | null>(null);
const [savePickerRows, setSavePickerRows] = useState<SampleSetRow[] | null>(null);
```
In the `gridColumns` `useMemo`, build the actions object and pass it to `buildColumn`:
```ts
const actions: CellActions = {
  openReport: (reportId) => setReportDialog({ reportId }),
  openChart: (ticker, date) => setChartDialog({ ticker, date }),
  addToSample: (ticker, date) => setSavePickerRows([{ ticker, date }]),
};
```
Add `actions`'s setters are stable, but `useMemo` deps must still satisfy lint — define `actions` inside the memo (it only uses `setState`, which is stable) so no new deps are needed.

A5. Render the overlays at the end of `SheetsTab`'s JSX, next to `ShareSheetDialog`:
- Report: `<Dialog open={!!reportDialog} onOpenChange={(o) => !o && setReportDialog(null)}>` → `DialogContent` with a `DialogHeader`/`DialogTitle` ("Research Report") and `{reportDialog && <WatchlistReportInline reportId={reportDialog.reportId} />}`.
- Chart: same pattern, title "Chart", body `{chartDialog && <WatchlistTickerChart ticker={chartDialog.ticker} date={chartDialog.date} />}`.
- Save picker: `{savePickerRows && <WatchlistSavePicker open onOpenChange={(o) => !o && setSavePickerRows(null)} seedRows={savePickerRows} />}`.

### Part B — Import route (`app/api/sheets/[id]/append-research-row/route.ts`, new file)

Mirror `app/api/sheets/[id]/rows/route.ts` for structure and `app/api/daily-reviews/append-watchlist/route.ts` for dedupe.

B1. Add to `lib/validations/sheets.ts` (reuse the existing `DATE_REGEX` const):
```ts
export const appendResearchRowSchema = z.object({
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9.\-^]{1,10}$/, 'Valid ticker required'),
  date: z.string().trim().regex(DATE_REGEX, 'date must be YYYY-MM-DD'),
  reportId: z.string().min(1).max(128).optional(),
});
```

B2. `POST(request, context: { params: Promise<{ id: string }> })`:
1. `requireUser()` → on error return it.
2. `parseAndValidate(request, appendResearchRowSchema)`.
3. `getDb()` / `dbUnavailable()`; `ensureUser(db, authState.user)`.
4. `const { id } = await context.params;` `const role = await getSheetRole(db, id, authState.user.id);` → `null` ⇒ 404 `{ error: 'Sheet not found' }`; `viewer` ⇒ 403 `{ error: 'Forbidden' }`.
5. Load existing rows in **one** query: `select({ position: sheetRows.position, values: sheetRows.values }).from(sheetRows).where(eq(sheetRows.sheetId, id))`. Use this single result for both dedupe and position (no second select — keeps it aligned with how `__tests__/sheets-routes.test.ts` queues one select result per query). Dedupe: if any `v = row.values as Record<string, unknown>` has `String(v.ticker ?? '').toUpperCase() === ticker && String(v.date ?? '') === date` → return `Response.json({ duplicate: true })`.
6. Compute next `position` from that same result: `existing.length ? Math.max(...existing.map((r) => r.position)) + 1 : 0`.
7. `const values: Record<string, unknown> = { ticker, date }; if (reportId) values.research_report = reportId;`
8. Insert into `sheetRows` (same fields as rows route: `sheetId, position, values, createdByUserId, updatedByUserId, updatedAt`), `.returning()`. Return `Response.json({ row, duplicate: false }, { status: 201 })`.
9. `try/catch` → `logRouteError('sheets.id.append-research-row', error)` then `internalServerError()`.

### Part C — "Add to Sheets" button (`components/trading/ResearchTickerView.tsx`)

C1. At line 118, render `<AddToSheetsButton ticker={ticker} />` alongside `<AddToWatchlistButton ticker={ticker} />` (wrap both in a `flex items-center gap-2` if not already).

C2. New `AddToSheetsButton` component in the same file, modeled on `AddToWatchlistButton` but using the dropdown primitive `@/components/ui/dropdown-menu` (`DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem`):
- State: `const [sheets, setSheets] = useState<{ id: string; name: string }[]>([]);` and `saving`.
- `reportId` from `getCachedReportId(ticker)` (optional — read it at click time so a late-arriving report is included).
- Fetch the sheet list when the menu opens (`onOpenChange` true) or on mount: `GET /api/sheets`, keep only `s.role === 'owner' || s.role === 'editor'`, `!s.isTemplate`, `s.archivedAt === null`. Map to `{ id, name }`.
- Trigger button: styled like the enabled `AddToWatchlistButton` (`Plus` icon + "Add to Sheets"), always enabled.
- Menu items: one per sheet. Empty list → a single disabled item "No sheets yet".
- On item click: `POST /api/sheets/{id}/append-research-row` with `{ ticker, date: format(new Date(), 'yyyy-MM-dd'), reportId: getCachedReportId(ticker) ?? undefined }`. Parse `{ duplicate }`. Toast: duplicate → ``${ticker} is already in "${name}"``; else ``Added ${ticker} to "${name}"``. Failure → `toast.error('Failed to add to sheet')`. (`format` and `toast` are already imported in this file.)

### Part D — Tests, validation, docs

D1. Tests:
- Add `appendResearchRowSchema` cases to the validations coverage (valid row; bad ticker; bad date; reportId optional). Put them where the other sheets validation tests live.
- Add an append-research-row route test in `__tests__/sheets-routes.test.ts` following the existing patterns there: appends a row for an editor; a second identical call returns `{ duplicate: true }` and does not add a row; `viewer` → 403; unknown sheet id → 404.

D2. Run from repo root: `npm run lint` && `npx tsc --noEmit` && `npm test`. No migration this sprint.

D3. Update `AGENTS.md` to document the full Sheets surface now that import + interactive cells exist (the roadmap deferred this until import landed). Then run `npm run workflow:audit` because a workflow asset changed.

### Acceptance criteria
- Report cell with a stored reportId opens the report in a dialog; empty cell shows a dash.
- Chart cell opens the chart for the row's `ticker` + `date`; missing either shows a dash.
- Date cells (locked `Date` column and any user-added date column) edit via a native date picker that stores `YYYY-MM-DD`.
- Add-to-Sample opens the sample-set save picker seeded with the row's ticker + date.
- All three cells work for viewers as well as editors/owners.
- "Add to Sheets" lists only the user's editable, non-template, non-archived sheets and appends `{ ticker, date, research_report? }`, deduping by `(ticker, date)`.
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run workflow:audit` all green.
- Manual authenticated smoke (Jared, post-merge): open a report cell, open a chart cell, add a row to a sample set, and use "Add to Sheets" from Research including the duplicate path.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

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
- CSV export, archive/unarchive UI, undo/redo, polling/SSE invalidation, drag-reorder rows/columns.

(Research "Add to Sheets" import + interactive `report`/`chart`/`action` cells + the `AGENTS.md` Sheets-surface update are the **active Sprint 4 spec** above.)

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
