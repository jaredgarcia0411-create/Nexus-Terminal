# Nexus Terminal — HANDOFF.md

> Updated: 2026-04-20
> Purpose: brief summary of recently completed work plus any active execution spec. Older implementation detail lives in git history and `specs/`.
> Historical completed sections were archived to keep this file focused. Agent Hardening #1 shipped in `7118598`; Agent Hardening #2 in `2a856f1`; Agent Hardening #3 in `bf13567`; Research agent report refinements in `9a69655` (2026-04-17); Trade Journal Enhancement (DRC + Weekly Review + Archive tab) shipped across `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153` (2026-04-19 → 2026-04-20); Tighten Trading Journal UI shipped in `f1fde41` (2026-04-20). See git history for full records.

## Current State

**Active spec:** `Spend Enforcement Fix` (below). Next up after this ships: approval gates from `FUTURE-PLANS.md` item 1.

## Validation Snapshot

Most recent validation (`2026-04-20`, Tighten Trading Journal UI):

- `npm run lint` — passed
- `npx tsc --noEmit` — passed
- `npm test` — passed (`52` files, `402` tests)

## Follow-Up Notes

- Production check: after deploy, verify `GET /api/cron/agent-retention` returns `200` when called with the existing project `CRON_SECRET`.
- After first production run of the refined research agents, confirm a Discord embed renders the gap table for a ticker with gap history and the "No historical gap data available." fallback for a ticker without — this was the bug the refactor targeted.

---

## Spend Enforcement Fix

> Generated: 2026-04-20 | Agent: nexus-architect (inline by plan agent)
> Status: PLANNED

### Goal

Make the per-user daily/monthly LLM spend limits actually trip. Today `agent_request_log.estimated_cost_cents` is written as `0` for every row, so `checkBudget()` sums to 0 forever and the daily $5 / monthly $100 limits never fire. Fix: compute real cost from token usage using a per-model pricing map, write fractional cents into the existing column (migrated from `integer` to `real`), and let the existing `BudgetExceededError` → `failureClass: 'policy'` hard stop take over.

### Approved decisions (locked)

1. Single-pass post-call real-cost write. No reservation or two-phase write. The race between two concurrent jobs for the same user is acknowledged as a known limitation and will be closed by FUTURE-PLANS item 3 (transactionality).
2. Pricing: static TypeScript config, not a DB table. Only `llama-3.3-70b-versatile` for now (Groq: `$0.59/1M` input, `$0.79/1M` output).
3. Schema: `agent_request_log.estimated_cost_cents` migrates from `integer` to `real` (Postgres single-precision float). Reason: at Groq rates many real calls cost < 1¢, which integer rounding collapses to 0. `real` preserves fractional accumulation so the sum crosses the limit at the correct time.
4. Unknown models → `console.warn` once and return cost `0`. The job still runs. The warning is the canary that tells us to add the model to the pricing map.
5. Budget env defaults unchanged (`AGENT_DAILY_BUDGET_CENTS=500`, `AGENT_MONTHLY_BUDGET_CENTS=10000`).

---

### Phase 1 — Add the pricing module

**File:** `lib/agents/model-pricing.ts`
**Action:** CREATE

1. Create a new file at `lib/agents/model-pricing.ts` with exactly this content:
   ```ts
   // Per-model LLM pricing for cost accounting.
   // Rates are cents per 1M tokens. Source: provider public pricing page.
   // Update when Groq (or a future provider) publishes new rates, or when a
   // new model is added to the rotation.

   interface ModelRate {
     inputCentsPerMToken: number;
     outputCentsPerMToken: number;
   }

   export const MODEL_PRICING: Record<string, ModelRate> = {
     'llama-3.3-70b-versatile': {
       inputCentsPerMToken: 59,
       outputCentsPerMToken: 79,
     },
   };

   /**
    * Cost in cents for a completed LLM call. Returns a float — fractional
    * cents are preserved so budget sums trip at the right threshold.
    * Unknown model → warns once and returns 0 (job continues).
    */
   export function estimateCostCents(
     model: string,
     inputTokens: number,
     outputTokens: number,
   ): number {
     const rate = MODEL_PRICING[model];
     if (!rate) {
       console.warn(
         `[model-pricing] Unknown model "${model}" — logging cost as 0. Add it to MODEL_PRICING in lib/agents/model-pricing.ts.`,
       );
       return 0;
     }

     const inputCost = (inputTokens / 1_000_000) * rate.inputCentsPerMToken;
     const outputCost = (outputTokens / 1_000_000) * rate.outputCentsPerMToken;
     return inputCost + outputCost;
   }
   ```
2. No default export. No other functions. No extra imports.

**Acceptance:**
- [ ] File exists at `lib/agents/model-pricing.ts`.
- [ ] `MODEL_PRICING['llama-3.3-70b-versatile']` equals `{ inputCentsPerMToken: 59, outputCentsPerMToken: 79 }`.
- [ ] `estimateCostCents('llama-3.3-70b-versatile', 1_000_000, 1_000_000)` returns `138`.
- [ ] `estimateCostCents('unknown-model', 100, 100)` returns `0` and logs exactly one `console.warn`.
- [ ] `estimateCostCents('llama-3.3-70b-versatile', 0, 0)` returns `0`.

---

### Phase 2 — Wire real cost into the tracking entry

**File:** `lib/agents/blueprint-runner.ts`
**Action:** MODIFY

1. Add this import with the other relative imports near the top of the file. Preserve existing import ordering — place it alphabetically among sibling `./` imports:
   ```ts
   import { estimateCostCents } from './model-pricing';
   ```
2. Locate `buildLlmTrackingEntry` (currently starts at line 128). At **line 167** the current code is:
   ```ts
       estimatedCostCents: 0,
   ```
   Replace that exact line with:
   ```ts
       estimatedCostCents: estimateCostCents(modelUsed, inputTokens, outputTokens),
   ```
3. Do NOT change anything else in this file. Token extraction (lines 145-151), model resolution (lines 153-156), and all 5 call sites of `buildLlmTrackingEntry` (lines ~279, 306, 310, 314, 321) remain as-is.

**Acceptance:**
- [ ] Exactly one import added at the top of `blueprint-runner.ts`.
- [ ] Exactly one value replaced inside `buildLlmTrackingEntry` (line 167).
- [ ] No other edits to `blueprint-runner.ts`.

---

### Phase 3 — Preserve fractional cents at the DB write boundary

**File:** `lib/agents/runtime-limits.ts`
**Action:** MODIFY

1. Locate `recordLlmAttempt` at line 171. At **line 182** the current code is:
   ```ts
       estimatedCostCents: Math.round(entry.estimatedCostCents),
   ```
   Replace with:
   ```ts
       estimatedCostCents: entry.estimatedCostCents,
   ```
   **Why:** after Phase 4 the column is `real`, so it accepts floats. Keeping `Math.round` here would defeat the migration — every per-call cost would be re-rounded to an integer cent before insert, re-introducing the same 0-cost accumulation bug the migration fixes.
2. Do NOT change `checkBudget`, `loadUserCost`, `readAggregateNumber`, `loadUserRequestCount`, or any other function in this file. `Number(row?.[key] ?? 0)` at line 48 already coerces both integer and float values returned by `SUM()`.

**Acceptance:**
- [ ] Line 182 no longer wraps `entry.estimatedCostCents` in `Math.round`.
- [ ] No other changes to `runtime-limits.ts`.

---

### Phase 4 — Schema: migrate `estimated_cost_cents` to `real`

**File:** `lib/db/schema.ts`
**Action:** MODIFY

1. At the top of the file, confirm `real` is imported from `drizzle-orm/pg-core`. If it is not present in the existing import list, add it (preserve alphabetical ordering of named imports). Do not remove any existing imports. Example of the resulting line (your existing list will vary):
   ```ts
   import { pgTable, text, integer, real, timestamp, index, jsonb /* ... other existing ... */ } from 'drizzle-orm/pg-core';
   ```
2. Locate the `agentRequestLog` table definition (currently starts at line 286). At **line 296** the current column is:
   ```ts
     estimatedCostCents: integer('estimated_cost_cents').default(0),
   ```
   Replace with:
   ```ts
     estimatedCostCents: real('estimated_cost_cents').default(0),
   ```
3. Do NOT change any other column in this table or any other table.

**Action:** CREATE migration via drizzle-kit

4. From the repo root, run:
   ```bash
   npm run db:generate
   ```
   Drizzle-kit will produce:
   - A new `drizzle/0021_<random-name>.sql` with the `ALTER COLUMN ... SET DATA TYPE real` statement.
   - An updated `drizzle/meta/0021_snapshot.json`.
   - An updated `drizzle/meta/_journal.json` with the new entry.
5. Open the generated SQL file and verify it contains a single `ALTER TABLE "agent_request_log" ALTER COLUMN "estimated_cost_cents" SET DATA TYPE real` (default may also be emitted). If drizzle-kit emits anything unrelated — other columns, other tables, drops — STOP and report. That would mean schema.ts has drift unrelated to this spec and must be investigated before proceeding.
6. Commit all three generated files alongside the `schema.ts` change.

**Why a migration, not `db:push`:** `db:push` is dev-only and skips the numbered migration history that production deploys rely on.

**Acceptance:**
- [ ] `lib/db/schema.ts` declares `estimated_cost_cents` as `real`.
- [ ] `real` is in the `drizzle-orm/pg-core` import.
- [ ] New file `drizzle/0021_*.sql` exists with exactly one `ALTER COLUMN` statement targeting `agent_request_log.estimated_cost_cents`.
- [ ] `drizzle/meta/0021_snapshot.json` and updated `drizzle/meta/_journal.json` are committed.

---

### Phase 5 — Tests

**File:** `__tests__/agent-model-pricing.test.ts`
**Action:** CREATE

1. Create a new vitest file following the repo convention. Mirror the import + mock style in `__tests__/agent-runtime-limits.test.ts`. Cover these cases:
   - **Exact math:** `estimateCostCents('llama-3.3-70b-versatile', 1_000_000, 1_000_000)` equals `138`.
   - **Small call stays fractional (critical):** `estimateCostCents('llama-3.3-70b-versatile', 3_000, 500)` — use `expect(...).toBeCloseTo(0.2165, 4)`. This is the direct proof that the 0-cent bug is dead.
   - **Zero tokens:** `estimateCostCents('llama-3.3-70b-versatile', 0, 0)` equals `0`.
   - **Unknown model:** `estimateCostCents('unknown-xyz', 100, 100)` equals `0` AND a `vi.spyOn(console, 'warn')` fires exactly once with a message containing `"Unknown model"`.
   - **Empty-string model:** same as unknown — returns `0`, warns once.
2. Use `vi.spyOn(console, 'warn').mockImplementation(() => {})` in `beforeEach` and restore in `afterEach`.

**File:** `__tests__/agent-blueprint-runner.test.ts`
**Action:** MODIFY

3. Find the existing test around line 307 that verifies `recordLlmAttempt` is called on a successful step (look for the test covering the two-repair-attempts case — its mock already supplies token counts). Extend the assertion so the tracking entry passed to `recordLlmAttempt` has `estimatedCostCents > 0` when a known model (`llama-3.3-70b-versatile`) and non-zero tokens are returned from the mocked LLM call.
4. If the existing test mocks a model name that is NOT in `MODEL_PRICING`, update the mock to use `llama-3.3-70b-versatile` so the cost lookup hits a real rate. Do not change the scenario logic.
5. Do not delete or rewrite existing tests. Add the new assertion inside the existing test block.

**File:** `__tests__/agent-runtime-limits.test.ts`
**Action:** MODIFY

6. Find the existing `checkBudget` suite. Add one new test case: given several rows inserted with fractional `estimatedCostCents` values that each individually round to 0 but whose sum exceeds a lowered daily limit, `checkBudget` throws `BudgetExceededError` with `limitType: 'daily'`.
   - Concrete shape: in the test's fixture setup, insert 10 rows each with `estimatedCostCents: 0.4` for the current UTC day. Stub `getLlmBudgetConfig` to return `dailyBudgetCents: 2` for this case. Verify `checkBudget` rejects with `BudgetExceededError`. Under the old `integer` schema each row would have been rounded to `0` and the sum would be `0`, so this test would have passed broken code silently — it is now a guardrail against regressing the fractional behavior.
7. Do not remove or rewrite existing test cases.

**Acceptance:**
- [ ] `__tests__/agent-model-pricing.test.ts` exists and all 5 cases pass.
- [ ] Blueprint-runner test asserts non-zero cost on a successful step.
- [ ] Runtime-limits test has a new case proving fractional accumulation trips the daily budget.
- [ ] All previously passing tests still pass.

---

### Phase 6 — Validation

From repo root `/home/jared/Nexus-Terminal`, run in order:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

Skip `npm run typecheck:services` — no files under `services/` are touched. Skip `npm run workflow:audit` — no workflow assets changed.

**Manual sanity check (optional, dev DB only):**
4. `npm run db:migrate` against a dev database.
5. Trigger one blueprint run via the normal UI flow.
6. Query: `SELECT model_used, input_tokens, output_tokens, estimated_cost_cents FROM agent_request_log ORDER BY created_at DESC LIMIT 5;` — confirm `estimated_cost_cents` is a non-zero fractional value for successful rows.

---

### Files NOT to touch

- `lib/agents/llm-client.ts` — token extraction from `payload.usage` already works.
- `lib/agents/types.ts` — `TokenTrackingEntry.estimatedCostCents: number` already accepts floats; no signature change.
- `app/api/agents/admin/stats/route.ts` — reads the column via `asNumber(row.estimatedCostCents)`, already coerces both int and float. Will start reporting real numbers automatically once rows are populated.
- `scripts/ops/agent-observability.sql` — `SUM(estimated_cost_cents)` works on `real` unchanged.
- `lib/llm-client.ts` — legacy, not used by blueprint steps.

### Known limitation (deferred)

Two concurrent jobs for the same user can both pass `checkBudget` in parallel before either writes its log row. Window is small but real. Explicitly deferred to FUTURE-PLANS item 3 (transactionality + dependency tracking), which will fold in a reserve-then-reconcile pattern.

---

### Files Changed Summary

| File | Action | Approx. lines changed | Risk |
|---|---|---|---|
| `lib/agents/model-pricing.ts` | CREATE | ~35 | LOW |
| `lib/agents/blueprint-runner.ts` | MODIFY | 2 (1 import + 1 value swap) | LOW |
| `lib/agents/runtime-limits.ts` | MODIFY | 1 (remove `Math.round` wrapper) | LOW |
| `lib/db/schema.ts` | MODIFY | 2 (column type + import) | MEDIUM |
| `drizzle/0021_*.sql` | CREATE (via `db:generate`) | ~3 | MEDIUM |
| `drizzle/meta/0021_snapshot.json` | CREATE (via `db:generate`) | auto | LOW |
| `drizzle/meta/_journal.json` | MODIFY (via `db:generate`) | 1 entry | LOW |
| `__tests__/agent-model-pricing.test.ts` | CREATE | ~60 | LOW |
| `__tests__/agent-blueprint-runner.test.ts` | MODIFY | ~3 | LOW |
| `__tests__/agent-runtime-limits.test.ts` | MODIFY | ~20 | LOW |

Risk rationale: medium-risk items are the column type migration and the `real` import in `schema.ts`. Both are isolated and reversible via a follow-up migration if anything surfaces in production.

---

### Verification Steps

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`

(Skip `typecheck:services` and `workflow:audit` — no touched files require them.)

---

### Open Questions for Codex

None — the plan is locked.
