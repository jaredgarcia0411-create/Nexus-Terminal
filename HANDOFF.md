# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-02
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## Active Spec - Filing headline parser (Research Filings) v1

Goal: replace generic filing headlines (`10-Q filing`, `Current report`) on Research > Filings with deterministic, trader-readable labels built from SEC metadata we already fetch. Metadata-only. No LLM, no filing-body fetch, no DB migration, no type changes.

Status: completed 2026-06-02 in-session. Implemented parser in `lib/sec/filing-summary.ts`, wired `lib/sec/submissions.ts`, and added runnable coverage in `__tests__/sec-filing-summary.test.ts` because `vitest.config.ts` only includes `__tests__/**/*.test.{ts,tsx}`. Validation passed: `npm run lint`, `npx tsc --noEmit`, `npm test` (106 files / 777 tests). No `services/`, migration, DB, normalizer, or UI changes.

Background (already true, do not change): Research Filings are sourced first-party from SEC via `lib/sec/submissions.ts` → `getResearchFilings()`, registered as the `sec-filings` endpoint. `SecFiling` already carries `form_type`, `items` (8-K item codes), and `primary_doc_description`. Today `submissions.ts:149` sets `headline = primaryDocDescription || "${formType} filing"` and discards `items`. The normalizer prefers `headline` first (`snapshot-normalizer.ts:271`), so fixing the headline at the source flows to the UI with no normalizer edits. The UI shows `formType` in its own column (`_shared.tsx:72`), so the headline must NOT repeat the form code.

### Step 1 — Create `lib/sec/filing-summary.ts`

Export one pure function. No imports, no side effects.

```ts
export interface FilingSummaryInput {
  formType: string;
  items: string | null;
  primaryDocDescription: string | null;
}

export function summarizeFilingMetadata(input: FilingSummaryInput): string
```

Logic, in order:

1. `const form = input.formType.trim().toUpperCase();`
2. `const isAmended = form.endsWith('/A');`
3. `const base = isAmended ? form.slice(0, -2) : form;` (strip the `/A` suffix for matching)
4. **8-K branch** — if `base === '8-K'`:
   - Extract codes: `const codes = (input.items ?? '').match(/\d\.\d{2}/g) ?? [];`
   - If more than one code AND `9.01` is present, drop `9.01` (it's an exhibit companion): filter it out.
   - Map remaining codes through `EIGHT_K_ITEMS` (below), drop unrecognized, take the first **two**, join with `', '`.
   - `core` = that joined string if non-empty, else `'current report'`.
5. **Other forms** — else, `core = baseFormLabel(base)` (helper below). If it returns `null` (unknown form), return the existing fallback unchanged: `return input.primaryDocDescription?.trim() || \`${input.formType} filing\`;`
6. Apply amended prefix: `return isAmended ? \`amended ${core}\` : core;`

`EIGHT_K_ITEMS` (flat `Record<string,string>`):
```
1.01 material definitive agreement
1.02 termination of material agreement
2.01 completion of acquisition or disposition
2.02 results of operations
2.03 creation of a material financial obligation
3.01 exchange listing / delisting notice
3.02 unregistered sale of equity
5.02 director/officer change
5.03 charter/bylaw amendment
5.07 shareholder vote results
7.01 Regulation FD disclosure
8.01 other event
9.01 financial statements and exhibits
```

`baseFormLabel(form: string): string | null` — `form` is already uppercased with `/A` stripped. Use a simple if/return chain (match the project's plain style):
```
10-Q                       -> quarterly report
10-K                       -> annual report
20-F or 40-F               -> annual report (foreign issuer)
6-K                        -> foreign issuer report
S-1|S-3|S-4|S-8|S-11       -> registration statement
F-1|F-3|F-4                -> registration statement
424[AB]\d?                 -> prospectus supplement
425                        -> merger/business-combination communication
DEF...14[AC]               -> proxy statement
PRE...14[AC]               -> preliminary proxy statement
SC 13G | SCHEDULE 13G      -> beneficial ownership report
SC 13D | SCHEDULE 13D      -> beneficial ownership report
3 | 4 | 5                  -> insider ownership report
144                        -> proposed sale of securities
(anything else)            -> null
```
For the regex forms use anchored tests, e.g. `/^S-(1|3|4|8|11)$/`, `/^F-(1|3|4)$/`, `/^424[AB]\d?$/`, `/^(SC ?)?13G$/`, `/^SCHEDULE ?13G$/` (and the 13D variants), proxies `form.startsWith('DEF') && /14[AC]/.test(form)` / `form.startsWith('PRE') && /14[AC]/.test(form)`.

### Step 2 — Wire into `lib/sec/submissions.ts`

1. Add import at top: `import { summarizeFilingMetadata } from '@/lib/sec/filing-summary';`
2. In `zipFilingColumns`, replace line 149:
   ```ts
   const headline = description.trim() || `${formType} filing`;
   ```
   with:
   ```ts
   const headline = summarizeFilingMetadata({
     formType,
     items,
     primaryDocDescription: description.trim() || null,
   });
   ```
   (`items` and `description` are already in scope above this line.)
3. Update the `SecFiling.headline` JSDoc comment (line 28) to: `// deterministic parsed label from form type + 8-K items; falls back to primary_doc_description or "${form_type} filing"`.

Do not touch the normalizer or the UI. `primary_doc_description` and `items` remain stored intact for debugging.

### Step 3 — Tests `lib/sec/filing-summary.test.ts` (vitest)

Cover:
- `10-Q` → `quarterly report`; `10-Q/A` → `amended quarterly report`.
- `8-K` items `"5.02"` → `director/officer change`; items `"2.02,9.01"` → `results of operations` (9.01 dropped as companion); items `"9.01"` alone → `financial statements and exhibits`; items `null`/`""` → `current report`; three+ items → only first two labels.
- `8-K/A` items `"5.03"` → `amended charter/bylaw amendment`.
- `S-1` → `registration statement`; `S-1/A` → `amended registration statement`; `424B5` → `prospectus supplement`; `SC 13G/A` → `amended beneficial ownership report`.
- Unknown form `"NT 10-Q"` with `primaryDocDescription "Notification of late filing"` → returns that description; unknown form with null description → `NT 10-Q filing`.

### Validation
`npm run lint` · `npx tsc --noEmit` · `npm test`. (`lib/sec/` is not under `services/`, so `typecheck:services` is not required.) No migration, no `db:migrate`.

### Acceptance
- Common forms (10-Q/K, 8-K with items, S-1/S-3, 424B*, proxies, ownership) render a readable headline; the form code is not duplicated in the headline.
- Unknown forms behave exactly as today.
- No LLM call, no body fetch, no schema change.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

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
