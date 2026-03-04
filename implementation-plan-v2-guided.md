# Nexus Terminal Implementation v2 - Guided Execution Plan

Source reviewed: `implementation-plan-v2.md`  
Guidance mode: `task-orchestrator` + targeted skill handoffs

## Review Findings to Address First

1. High - rollback plan conflicts with migration step  
   Location: `implementation-plan-v2.md:127`, `implementation-plan-v2.md:772`  
   Issue: Step A.2 renames `executions` to `execution_count`, but rollback requires both columns to exist for one release cycle.  
   Fix: Implement a two-phase migration: add `execution_count` first, backfill from `executions`, dual-read/dual-write during transition, then drop `executions` in a later migration.

2. High - parser rule can misclassify `B` in mixed long/short symbol sessions  
   Location: `implementation-plan-v2.md:181-187`  
   Issue: `B => cover if symbol has SS anywhere in file` fails when the same symbol has both long and short trades in one export.  
   Fix: Add position-state matching (open lots by symbol and time) and use a fallback warning path when side cannot be inferred unambiguously.

3. Medium - chart wiring dependency is incomplete  
   Location: `implementation-plan-v2.md:478`, `implementation-plan-v2.md:482`, `implementation-plan-v2.md:348`  
   Issue: B.2 depends on `rawExecutions` in detail data, but dependency list omits A.7/A.8 where detail fetching is wired.  
   Fix: Mark B.2 dependency as `A.1 + A.7 + A.8 + B.1`.

4. Medium - time-window logic for MFE/MAE lacks explicit timezone/date normalization  
   Location: `implementation-plan-v2.md:481`, `implementation-plan-v2.md:535-546`  
   Issue: HH:mm:ss-only comparison is ambiguous without date and timezone conversion against Schwab candle timestamps.  
   Fix: Normalize to exchange timezone (`America/New_York`) and compare epoch windows derived from `sortKey + entry/exit time`.

5. Medium - no final validation gate after UI overhaul  
   Location: `implementation-plan-v2.md:743-757`  
   Issue: Gates exist after steps 10 and 16, but none after D.1-D.4.  
   Fix: Add a final gate (`lint`, `tsc`, `test`, manual UI sanity pass) after step 20.

## Orchestration Contract

Objective: Execute implementation v2 with minimal regression risk while preserving tenant safety and parser correctness.

Constraints:
- Keep tenant isolation intact in all data access paths.
- Avoid destructive schema drops during first deployment pass.
- Keep CSV parser behavior deterministic and test-backed.
- Do not block delivery on non-critical UX polish.

Acceptance criteria:
1. Workstreams A-D complete with all checklist items satisfied.
2. Validation gates pass at A10, C3, and D4.
3. Security pass completed on data import/storage and Schwab-linked flows.
4. Guided plan produces a releasable branch with rollback path.

Assumptions:
- Existing files/paths in v2 plan are valid in repo.
- DAS files can include reverse-chronological rows and trailing commas.
- Schwab minute candles may be unavailable for older dates.

## Skill Handoff Schedule

- `task-orchestrator` (sequential, always-on): planning, sequencing, checkpoints, re-planning.
- `migrations-agent` (sequential): A.2, A.3, transitional schema rollout checks.
- `test-and-debug-agent` (sequential, gate): A.10, B.3, C.1/C.2 test hardening, full-suite gates.
- `security-review-agent` (sequential, post-core changes): after A.7/A.8 and after C.2.
- `doc-writer-agent` (parallel near end): update rollout notes/README/HANDOFF once behavior stabilizes.

## Guided Plan by Step

### Step 1 - A.1 Extend `lib/types.ts`

Owner: Core implementation  
Dependencies: none

Actions:
1. Add `Execution` interface.
2. Add trade fields (`grossPnl`, `netPnl`, `entryTime`, `exitTime`, `mfe`, `mae`, `bestExitPnl`, `exitEfficiency`, `rawExecutions`).
3. Rename `executions` to `executionCount` in type definitions.
4. Keep transitional alias `pnl` mapped to `netPnl` in conversion layers.

Validation:
- `npx tsc --noEmit`

Exit criteria:
- Types compile and all direct type references are updated or intentionally shimmed.

### Step 2 - A.2 Schema update (`lib/db/schema.ts`) - transitional strategy

Owner: `migrations-agent`  
Dependencies: Step 1

Actions:
1. Add `trade_executions` table with `(userId, tradeId)` FK cascade and index.
2. Add new trade analytics columns.
3. Add `execution_count` as a new column (do not drop `executions` yet).
4. Keep backward compatibility for one release.

Validation:
- `npx drizzle-kit generate`
- review generated SQL for safe additive migration

Exit criteria:
- Generated migration is additive and rollback-safe.

### Step 3 - A.3 Backfill SQL (`drizzle/backfill-v2.sql`)

Owner: `migrations-agent`  
Dependencies: Step 2

Actions:
1. Backfill `execution_count` from legacy `executions`.
2. Backfill `gross_pnl`, `net_pnl`, `entry_time`, `exit_time`.
3. Ensure update predicate does not overwrite already-migrated rows unintentionally.
4. Add comments describing idempotency expectations.

Validation:
- Dry-run on staging dataset.
- Verify row counts changed and spot-check sample rows.

Exit criteria:
- Script is idempotent and preserves legacy `pnl`.

### Step 4 - A.5 Parser interface update (`lib/parsers/types.ts`)

Owner: Core implementation  
Dependencies: Step 1

Actions:
1. Add optional `buildContext`.
2. Update `normalizeRow` signature with optional context arg.
3. Keep existing parser compatibility unchanged.

Validation:
- `npx tsc --noEmit`

Exit criteria:
- Existing parser implementations compile without behavior changes.

### Step 5 - A.4 DAS parser (`lib/parsers/das-trader.ts`, `lib/parsers/index.ts`)

Owner: Core implementation  
Dependencies: Step 4

Actions:
1. Implement DAS detection (`Route`, `Account`, `Type`, ignoring empty headers).
2. Implement two-pass context.
3. Add position-state guard for mixed long/short same-symbol edge case.
4. Default commission/fees to zero.
5. Register parser in index.

Validation:
- targeted parser unit tests (new DAS cases)

Exit criteria:
- Parser handles user samples and edge ambiguity produces deterministic behavior or warnings.

### Step 6 - A.6 CSV pipeline (`lib/csv-parser.ts`)

Owner: Core implementation  
Dependencies: Steps 1, 4, 5

Actions:
1. Remove `TYPE -> Side` alias mapping.
2. Sort execution buckets by time before matching.
3. Preserve full `rawExecutions` in trade assembly.
4. Compute `grossPnl`, `netPnl`, `entryTime`, `exitTime`.
5. Consolidate duplicate same-time/same-price fills without losing totals.

Validation:
- existing parser tests + DAS-specific tests

Exit criteria:
- FIFO matching is chronological and execution-level records are preserved.

### Step 7 - A.9 Global rename (`trade.executions` -> `trade.executionCount`)

Owner: Core implementation  
Dependencies: Step 1

Actions:
1. Update UI and non-parser consumers using integer execution count.
2. Keep `rawExecutions` usage scoped to detail contexts.
3. Remove stale type references.

Validation:
- `rg -n "trade\\.executions" .`
- `npm run lint`
- `npx tsc --noEmit`

Exit criteria:
- No remaining integer-field collisions.

### Step 8 - A.7 API + server mapping

Owner: Core implementation  
Dependencies: Steps 2, 6, 7

Actions:
1. Import route writes trade + `trade_executions` in one transaction.
2. Trade detail route returns `rawExecutions`.
3. Trade list route remains lightweight (no execution join).
4. Map all new fields in `toTrade`.
5. During transition, support both `executions` and `execution_count` reads if needed.

Validation:
- route-level tests or manual API checks with sample payloads

Exit criteria:
- API contracts are stable for list and detail use-cases.

### Step 9 - A.8 Hook updates (`hooks/use-trades.ts`)

Owner: Core implementation  
Dependencies: Step 8

Actions:
1. Pass execution payload through import flow.
2. Add lazy detail fetch for execution-heavy view.
3. Align API mapping with new fields.
4. Ensure local storage fallback serializes/deserializes `rawExecutions`.

Validation:
- import + reload + detail open manual workflow

Exit criteria:
- UI can fetch and render execution detail from API/local fallback.

### Step 10 - A.10 Test updates/additions

Owner: `test-and-debug-agent`  
Dependencies: Steps 5, 6, 8, 9

Actions:
1. Update existing csv parser tests for renamed fields.
2. Add new DAS parser test suite (8+ cases).
3. Add assertions for gross/net/time fields and `rawExecutions`.
4. Include mixed-side ambiguity tests and reverse-order matching tests.

Validation gate A:
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`

Exit criteria:
- Gate A fully passes before any downstream workstream proceeds.

### Step 11 - B.1 `useCandleData` hook

Owner: Core implementation  
Dependencies: Step 10

Actions:
1. Implement fetch wrapper for `/api/schwab/market-data`.
2. Add null-symbol short-circuit.
3. Add cache keying by symbol/timeframe.
4. Surface typed loading/error states including 401/404/429.

Validation:
- hook tests or component harness checks

Exit criteria:
- Hook is stable and non-chatty under rerender.

### Step 12 - B.2 Wire chart into detail sheet

Owner: Core implementation  
Dependencies: Steps 8, 9, 11

Actions:
1. Build marker conversion from `rawExecutions`.
2. Request candles with explicit date + timezone normalization.
3. Add timeframe selector state and refetch behavior.
4. Handle missing Schwab connection gracefully.

Validation:
- open/close detail sheet for imported + preexisting trades

Exit criteria:
- Chart + markers render consistently with valid time alignment.

### Step 13 - B.3 Chart resize/cleanup

Owner: `test-and-debug-agent`  
Dependencies: Step 12

Actions:
1. Verify chart dispose path on sheet unmount.
2. Validate resize observer behavior on panel changes.
3. Confirm volume panel layout.

Validation:
- manual devtools check + targeted rendering test

Exit criteria:
- No leak/error across repeated open-close cycles.

### Step 14 - C.1 MFE/MAE engine (`lib/mfe-mae.ts`)

Owner: Core implementation + `test-and-debug-agent`  
Dependencies: Steps 11, 12

Actions:
1. Implement calculation with direction-aware formulas.
2. Normalize candle time filtering using epoch windows.
3. Clamp `exitEfficiency` to 0..1.
4. Return `null` when window coverage is absent.

Validation:
- deterministic unit tests for long/short, no-window, clamp behavior

Exit criteria:
- Numeric outputs match fixture expectations.

### Step 15 - C.2 Batch MFE/MAE after import

Owner: Core implementation  
Dependencies: Steps 9, 14

Actions:
1. Group by `(sortKey, symbol)` to reduce candle fetches.
2. Enforce request pacing (>=200ms).
3. Compute per-trade metrics with partial-failure tolerance.
4. Persist updates and progress notifications.

Validation:
- import batch test with mixed old/new trade dates

Exit criteria:
- Recent trades get metrics, old trades cleanly remain null.

### Step 16 - C.3 Manual recalculation actions

Owner: Core implementation  
Dependencies: Step 15

Actions:
1. Add single-trade recalc action in detail sheet.
2. Add bulk recalc action in table toolbar.
3. Add success/failure toasts.

Validation gate B:
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`

Exit criteria:
- Manual and bulk recalc flows are functional and stable.

### Step 17 - D.1 TradeDetailSheet tab redesign

Owner: Core implementation  
Dependencies: Steps 12, 16

Actions:
1. Implement 4-tab layout (Overview, Chart, Executions, Notes).
2. Render all new metrics with null-safe placeholders.
3. Add execution table with sort and running PnL.
4. Preserve tab state while sheet remains open.

Validation:
- desktop + mobile manual UI pass

Exit criteria:
- Detail sheet is complete, readable, and responsive.

### Step 18 - D.2 Journal day-card layout

Owner: Core implementation  
Dependencies: Step 17

Actions:
1. Convert day grouping to card layout.
2. Add daily summary row and expandable trade list.
3. Keep descending-date ordering.

Validation:
- visual and interaction checks with multi-day dataset

Exit criteria:
- Journal supports quick day-level scanning and expansion.

### Step 19 - D.3 Dashboard KPI additions

Owner: Core implementation  
Dependencies: Steps 14, 15

Actions:
1. Add KPI cards for MFE/MAE and exit efficiency.
2. Add gross/net toggle with global consistency.
3. Show `-` placeholders when insufficient data exists.

Validation:
- regression check for existing KPI cards and filters

Exit criteria:
- KPI panel reflects new analytics without breaking existing stats.

### Step 20 - D.4 Reports panels

Owner: Core implementation + `test-and-debug-agent`  
Dependencies: Steps 18, 19

Actions:
1. Add Win vs Loss Days panel.
2. Add Drawdown shaded chart with peak-based starts.
3. Add Tag Breakdown that counts each trade PnL once per tag.

Validation gate C (final):
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- manual UI sanity: dashboard, reports, detail sheet, journal

Exit criteria:
- All planned analytics/report visuals render correctly and pass final gate.

## Security Checkpoints (Mandatory)

Checkpoint S1 (after Step 9): `security-review-agent`
- Verify tenant scoping on import/list/detail/bulk endpoints.
- Confirm broker `Account` field is not persisted/logged.
- Confirm no overbroad DB reads for execution data.

Checkpoint S2 (after Step 16): `security-review-agent`
- Verify Schwab request pacing cannot be bypassed via UI spam.
- Verify recalculation endpoints/actions enforce authorization and input validation.

## Release and Rollback Notes

Release approach:
1. Deploy additive schema + dual-read compatibility.
2. Deploy parser/API/hook updates.
3. Run backfill and verify.
4. Deploy UI/reporting changes.
5. Drop legacy `executions` column in a later migration after one stable release cycle.

Rollback approach:
1. Disable DAS parser registration if parsing issues are found.
2. Keep legacy column and compatibility reads during transition.
3. Gate MFE/MAE UI display behind null-safe checks so analytics failures do not block journal/trade usage.
