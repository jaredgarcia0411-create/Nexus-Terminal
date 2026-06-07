# Parked: Scanner Epic 1 — execution handoff

> Parked from `HANDOFF.md` on 2026-06-07 to make room for the Sheets Spec 1 work.
> This is the execution copy; the canonical source of truth is `docs/scanner-build.md`.
> Nothing here has been executed yet — it is still waiting on Jared's manual worktree + Neon-branch setup (Phase 1 below). To resume, move this block back into `HANDOFF.md` as the active spec.

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

5. **Run Codex** from inside `../nexus-scanner`, pointed at this active spec. It executes Steps 1–6 below (install dep → types → engine → schema → migration+seed → tests) against the branch.

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
