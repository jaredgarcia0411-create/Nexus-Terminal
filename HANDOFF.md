# Nexus Terminal - HANDOFF.md

> Updated: 2026-06-02
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-15, Tier 1 Cleanup, Chart Drawings, Multi-Day Charts, CSV/Cover-Close flows, Workflow Maintenance) were removed to keep this file focused. Use git history and `docs/repo-cleanup.md` for archived implementation detail.

---

## ACTIVE SPEC — Scanner Epic 1: Schema + JSONLogic Engine + Seed Rule

> Source of truth: `docs/scanner-build.md`. This spec executes **Epic 1 only**. Do not build the worker, UI, or backtest — those are Epics 2–5.
> Two deviations from the doc, decided with Jared (rationale below): (a) the engine lives in `lib/scanner/`, not `services/scanner/src/engine/`; (b) Epic 1 lands only the `scanner_definitions` table, not all 6.

### Phase 1 kickoff — human setup BEFORE running Codex (Jared does these)
This whole build happens in a **git worktree on a throwaway Neon branch**, never on `main`/prod (see `docs/scanner-build.md` → "Build discipline" + "Validation: 30-day parallel run"). Do these in order. **Do not run Codex until step 4 is done** — Step 5 of the spec runs `db:migrate`, and it must hit the Neon branch, not prod.

1. **Create the worktree + branch.** From the main checkout (`/home/jared/Nexus-Terminal`):
   ```bash
   git worktree add ../nexus-scanner -b scanner-v1
   cd ../nexus-scanner
   npm install            # worktrees do not share node_modules — fresh install needed
   ```
   (A worktree is a second working folder on the same repo, checked out to its own branch `scanner-v1`. The main checkout is untouched. The Epic 1 spec is already committed to `main`, so it's present here.)

2. **Create a Neon branch** in the Neon dashboard (branch off the production DB). Copy its connection string. (A Neon branch is a copy-on-write clone — migrations/test rows hit the branch, never prod.)

3. **Point the worktree at the branch.** Edit `../nexus-scanner/.env.local` and replace **only** `DATABASE_URL` with the Neon branch connection string. Leave every other value alone. (Claude will not touch `.env*` files — this step is yours.)

4. **Confirm** `../nexus-scanner/.env.local` `DATABASE_URL` points at the **branch**, not prod. This is the safety gate for the migration in Step 5 of the spec.

5. **Run Codex** from inside `../nexus-scanner`, pointed at this `HANDOFF.md` active spec. It executes Steps 1–6 below (install dep → types → engine → schema → migration+seed → tests) against the branch.

6. **When Codex reports back**, run `/review` with Claude to check the diff against this spec.

**Branch lifecycle:** `scanner-v1` is the home for Epics 1–3. Do **not** merge to `main` (which applies the migration to prod Neon) until you're ready to start the 30-day parallel run (Phase 2). Build → validate on the branch → merge once when the worker is ready to run live alongside the old scanner.

### Goal
Land the foundation for the custom scanner: a typed snapshot contract, a JSONLogic rule evaluator, the `scanner_definitions` table, and one **editable starter rule seeded as DB data** (not a hardcoded strategy). Fully unit-tested. No worker, no Polygon calls, no UI, no deploy.

### Why these deviations
- **Engine in `lib/scanner/`:** Epic 4's backtest endpoint is a Vercel route (`app/api/scanner/backtest`) that must import the evaluator. `services/` is excluded from the root `tsconfig.json` and built separately, so an engine living there can't be imported by app routes. `lib/` is the shared layer importable by app routes, the `services/` worker (Epic 2), and tests — mirroring how `lib/agents/` already powers the `services/` agent workers.
- **Only `scanner_definitions` now:** the other five tables (`scanner_runs`, `scanner_results`, `scanner_health`, `market_snapshots`, `scanner_tickers`) are written exclusively by the Epic 2 worker. Creating them empty weeks early adds unused schema. They land with the code that uses them in Epic 2.

### Design notes (read before coding)
- **Rules are data, never code.** Thresholds live in `scanner_definitions.rules` (JSONLogic AST in a `jsonb` column). Do not put any price/gap/volume constant in a `.ts` file. Tuning a rule = a DB update, never a code change.
- **The snapshot type is the worker↔rule contract.** Epic 1 defines the TypeScript shape and tests the engine against hand-built fixtures. The Epic 2 worker will populate these fields from Polygon; Epic 1 does not fetch anything.
- **The starter rule deliberately adds no exclusion filters.** AH-only gappers pass because `gapPercent` is best-of-PM/AH and `extendedHoursVolume` includes after-hours volume; fresh IPOs pass because nothing filters on `sessionsListed`. That is the point — the old TradingView scanner missed both.

### Step 1 — Add the dependency
```
npm install json-logic-js @types/json-logic-js
```
Confirm both land in `package.json` (`json-logic-js` in deps, `@types/json-logic-js` in devDeps). Do not delete or regenerate `package-lock.json` — let `npm install` update it.

### Step 2 — `lib/scanner/types.ts` (CREATE)
Define the snapshot contract and rule type. The `ScannerSnapshot` is the normalized shape the worker will emit (not raw Polygon fields).

```ts
import type { RulesLogic } from 'json-logic-js';

export interface ScannerSnapshot {
  ticker: string;
  tickerType: string;            // 'CS' | 'OTC' | 'ETF' | ... (from scanner_tickers, Epic 2)
  exchange: string;
  price: number;                 // last trade price
  priorClose: number;            // prior regular-session close
  gapPercent: number;            // best of PM/AH move vs priorClose
  dayVolume: number;
  preMarketVolume: number;
  afterHoursVolume: number;
  extendedHoursVolume: number;   // preMarketVolume + afterHoursVolume
  preMarketChange: number | null;
  afterHoursChange: number | null;
  sharesOutstanding: number | null;
  marketCap: number | null;
  sessionsListed: number | null; // trading sessions since IPO/list date; null if unknown
}

export type ScannerRule = RulesLogic;
```
If `RulesLogic` is not exported by `@types/json-logic-js` in the installed version, fall back to `export type ScannerRule = Record<string, unknown>;` and note it in the handoff.

### Step 3 — `lib/scanner/engine.ts` (CREATE)
Thin, pure wrapper. One exported function.

```ts
import jsonLogic from 'json-logic-js';

import type { ScannerRule, ScannerSnapshot } from './types';

// Evaluate a JSONLogic rule against one normalized snapshot row.
// json-logic-js `apply` returns the rule's result; a filter rule yields a boolean.
// Coerce with `=== true` so a malformed rule returning a truthy non-boolean
// can never silently count as a match.
export function evaluateRule(rule: ScannerRule, snapshot: ScannerSnapshot): boolean {
  return jsonLogic.apply(rule as Parameters<typeof jsonLogic.apply>[0], snapshot) === true;
}
```
Keep it to this one function. The worker/backtest will `.filter()` snapshot arrays themselves later — do not add a batch helper with no caller in Epic 1.

### Step 4 — Add `scanner_definitions` to `lib/db/schema.ts`
Append after the `sheetMembers` table (end of file). Match existing conventions (see `playbookStrategies` / `marketPulseDailyBars`). `boolean`, `integer`, `jsonb`, `timestamp` are already imported at the top of the file.

```ts
// Custom scanner rule presets. Rules are JSONLogic ASTs stored as data so
// thresholds are tuned via DB updates, never code changes. Worker tables
// (runs/results/health/snapshots/tickers) land in Epic 2 with the worker.
export const scannerDefinitions = pgTable('scanner_definitions', {
  id: text('id').primaryKey(),                 // slug, e.g. 'gap-momentum'
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  rules: jsonb('rules').notNull(),             // JSONLogic AST
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

### Step 5 — Generate + seed + apply the migration
1. `npm run db:generate` — produces a new `drizzle/00XX_*.sql` for the `scanner_definitions` table.
2. **Hand-append the seed** to the generated SQL file (same pattern as `drizzle/0019_clever_zodiak.sql`), after the `CREATE TABLE` statement:
```sql
--> statement-breakpoint
-- Seed: starter scanner rule (editable DB data, NOT a hardcoded strategy).
-- Jared's starting params: price >= $0.10, best PM/AH move >= 20%, PM+AH volume >= 500k.
-- No OTC/IPO/AH exclusions on purpose — those are the names the old scanner missed.
INSERT INTO "scanner_definitions" ("id", "name", "description", "rules", "enabled", "version")
VALUES (
  'gap-momentum',
  'Gap Momentum (starter)',
  'Starter rule. price >= 0.10 AND best PM/AH move >= 20% AND PM+AH volume >= 500k. Edit freely — this is data, not code.',
  '{"and":[{">=":[{"var":"price"},0.1]},{">=":[{"var":"gapPercent"},20]},{">=":[{"var":"extendedHoursVolume"},500000]}]}'::jsonb,
  true,
  1
)
ON CONFLICT ("id") DO NOTHING;
```
3. `npm run db:migrate` (the safe wrapper — **never** `db:push`). This is a required step; the table + seed must actually exist in the DB.
4. Verify: `npm run db:studio` (or a quick query) shows one `scanner_definitions` row with id `gap-momentum`.

### Step 6 — `__tests__/scanner-engine.test.ts` (CREATE)
Vitest, `import { describe, expect, it } from 'vitest'`, import `evaluateRule` from `@/lib/scanner/engine` and `ScannerSnapshot` from `@/lib/scanner/types`. Define the starter rule inline as a fixture (it is the same AST seeded above) plus a `baseSnapshot` helper that returns a fully-qualifying row, with per-test overrides.

Cover at minimum:
1. **Match:** a snapshot at price 5, gapPercent 35, extendedHoursVolume 2_000_000 → `true`.
2. **Below price floor:** price 0.05 (others qualifying) → `false`.
3. **At price floor boundary:** price 0.10 → `true` (>= is inclusive).
4. **Below gap:** gapPercent 15 → `false`.
5. **Below volume:** extendedHoursVolume 400_000 → `false`.
6. **AH-only gapper passes:** preMarketVolume 0, afterHoursVolume 600_000, afterHoursChange 25, preMarketChange null, gapPercent 25, extendedHoursVolume 600_000 → `true` (proves AH-only names are not excluded).
7. **Fresh IPO passes:** sessionsListed 3, otherwise qualifying → `true` (proves IPOs < 20 sessions are not excluded).
8. **Non-boolean safety:** a rule of `{ "var": "price" }` (returns a number, not a bool) → `evaluateRule` returns `false` (proves the `=== true` coercion).

### Validation (run from repo root, report pass/fail for each)
1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`  (new `scanner-engine` tests must pass; full suite stays green)
- `services/` is untouched, so `npm run typecheck:services` is not required.
- No workflow assets changed, so `npm run workflow:audit` is not required.

### Acceptance criteria
- `json-logic-js` + `@types/json-logic-js` installed; lockfile updated via `npm install`.
- `lib/scanner/types.ts` exports `ScannerSnapshot` + `ScannerRule`.
- `lib/scanner/engine.ts` exports `evaluateRule(rule, snapshot): boolean` and nothing else.
- `scanner_definitions` table exists in `schema.ts` + applied migration; one seeded `gap-momentum` row present.
- No price/gap/volume thresholds appear in any `.ts` file — only in the seeded JSONLogic.
- `__tests__/scanner-engine.test.ts` covers all 8 cases above and passes.
- lint + tsc + test all green.

### Out of scope (do NOT do in Epic 1)
Worker, Docker, Polygon fetch, the other 5 tables, `/scanner-debug` page, heartbeat badge, backtest endpoint, any UI, any change to `app/api/tradingview/gainers/route.ts` or `app/api/dashboard/scanner-state/route.ts`.

---

## Recent Completed Context

- **Sprint 14 - Daily Review Tag Centralization:** trade tags are now the shared Watchlist/Daily Trades tagging model; added tag rename/merge management.
- **Sprint 15 - Cleanup Test Coverage + Backtesting Lazy Loading:** added focused tests and lazy-loaded `BacktestingTab` at the Charts-tab boundary.
- **Repo cleanup (`docs/repo-cleanup.md`):** completed; repo is in good standing as of 2026-06-01.
- **Sprint 16 - Legacy DB Column Drop:** closed as won't-do (commit `9da2d49`). Legacy `trades.pnl` / `trades.executions` stay in place.

---

## Recently Completed

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
