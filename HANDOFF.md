# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Sprint 1 is complete. Older completed sections and manual-spec cleanup notes were removed from this file; use git history and `AEV2_PLAN.md` for archived detail.

### Workflow Tooling Note

- 2026-04-06: Added a repo-maintained Codex `commit` alias skill in [`codex-skills/commit/`](/home/jared/Nexus-Terminal/codex-skills/commit) and UI metadata for [`codex-skills/nexus-commit/`](/home/jared/Nexus-Terminal/codex-skills/nexus-commit) so Codex can surface a user-facing commit entry point while keeping `nexus-commit` as the canonical workflow.

---

## AEV2 Sprint 1 — Foundation + Schema

> Generated: 2026-04-06 | Agent: Codex
> Status: COMPLETE

### Summary

- Landed the Sprint 1 contract surface in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts), [`lib/agents/llm-client.ts`](/home/jared/Nexus-Terminal/lib/agents/llm-client.ts), [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts), and [`lib/agents/prompts/`](/home/jared/Nexus-Terminal/lib/agents/prompts).
- Added the V1 agent tables in [`lib/db/schema.ts`](/home/jared/Nexus-Terminal/lib/db/schema.ts), generated and applied [`drizzle/0019_clever_zodiak.sql`](/home/jared/Nexus-Terminal/drizzle/0019_clever_zodiak.sql), and updated the Drizzle metadata.
- Seeded `system-agent-user` plus the three foundational `agent_registry` rows and re-verified the repo baseline.

### Validation

- `npm run db:migrate` ✅
- `npm run db:generate` ✅
- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅

### Archive Note

- The detailed Phase 1 / Phase 2 / Phase 3 notes were intentionally removed from `HANDOFF.md` now that Sprint 1 is closed.

---

## AEV2 Sprint 2 — Queue and Worker Core

> Generated: 2026-04-07 | Agent: Codex
> Status: COMPLETE

### Objective

Build the shared runtime layer under `lib/agents/` so the queue, memory, blueprint, and checkpoint contracts are safe before any `/api/agents/*` routes or Docker service wiring are added.

### Summary

- Landed the full Sprint 2 runtime layer in [`lib/agents/db.ts`](/home/jared/Nexus-Terminal/lib/agents/db.ts), [`lib/agents/queue.ts`](/home/jared/Nexus-Terminal/lib/agents/queue.ts), [`lib/agents/runtime-limits.ts`](/home/jared/Nexus-Terminal/lib/agents/runtime-limits.ts), [`lib/agents/memory.ts`](/home/jared/Nexus-Terminal/lib/agents/memory.ts), [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts), [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts), and [`lib/agents/checkpoints.ts`](/home/jared/Nexus-Terminal/lib/agents/checkpoints.ts).
- Added the Sprint 2 type additions in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts): `CircuitBreakerState`, `QueueClaimResult`, `RateLimitExceededError`, `CircuitOpenError`, and the narrowed `StepLogEntry.status`.
- Added focused coverage in [`__tests__/agent-db.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-db.test.ts), [`__tests__/agent-queue.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-queue.test.ts), [`__tests__/agent-runtime-limits.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-runtime-limits.test.ts), [`__tests__/agent-memory.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-memory.test.ts), [`__tests__/agent-context.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-context.test.ts), [`__tests__/agent-blueprint-runner.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprint-runner.test.ts), and [`__tests__/agent-checkpoints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-checkpoints.test.ts).
- Kept Sprint 2 library-only: no `/api/agents/*`, no `services/**` work, no Compose cleanup, and no legacy `agent_memory` usage.

### Validation

- `npx vitest run __tests__/agent-db.test.ts __tests__/agent-queue.test.ts __tests__/agent-runtime-limits.test.ts __tests__/agent-memory.test.ts __tests__/agent-context.test.ts __tests__/agent-blueprint-runner.test.ts __tests__/agent-checkpoints.test.ts` ✅
- `npm run lint` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅

### Current State

- Sprint 1 contracts remain the base surface in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts), [`lib/agents/llm-client.ts`](/home/jared/Nexus-Terminal/lib/agents/llm-client.ts), and [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts).
- Sprint 1 schema remains the live storage contract in [`lib/db/schema.ts`](/home/jared/Nexus-Terminal/lib/db/schema.ts) and [`drizzle/0019_clever_zodiak.sql`](/home/jared/Nexus-Terminal/drizzle/0019_clever_zodiak.sql), including `agent_jobs`, `agent_reports`, `agent_memory_v2`, `agent_step_effects`, `agent_job_checkpoints`, and `agent_scheduled_runs`.
- Root TypeScript still excludes [`services/`](/home/jared/Nexus-Terminal/services), so Sprint 3 worker/service wiring remains a separate validation problem.
- Legacy `agent_memory` still exists in [`lib/db/schema.ts`](/home/jared/Nexus-Terminal/lib/db/schema.ts), but Sprint 2 runtime code uses `agent_memory_v2` exclusively.
- [`services/docker-compose.yml`](/home/jared/Nexus-Terminal/services/docker-compose.yml) still reflects older runtime assumptions and remains intentionally untouched in Sprint 2.

### Scope

- In scope: `AEV2-301` through `AEV2-306`, shared runtime helpers under `lib/agents/`, and focused Vitest coverage under [`__tests__/`](/home/jared/Nexus-Terminal/__tests__).
- Out of scope: `/api/agents/*` routes, Discord delivery, Compose changes, service folders, `/tmp/healthy` heartbeat file wiring, and seed-data import work.

### Planned File Actions

- Create [`lib/agents/db.ts`](/home/jared/Nexus-Terminal/lib/agents/db.ts) for Docker-side DB access and agent DB type aliases.
- Create [`lib/agents/queue.ts`](/home/jared/Nexus-Terminal/lib/agents/queue.ts) for claim / renew / complete / fail / retry helpers with lease fencing.
- Create [`lib/agents/runtime-limits.ts`](/home/jared/Nexus-Terminal/lib/agents/runtime-limits.ts) for token logging, budget checks, circuit-breaker logic, and rate-limit checks.
- Create [`lib/agents/memory.ts`](/home/jared/Nexus-Terminal/lib/agents/memory.ts) for `agent_memory_v2` reads and writes.
- Create [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts) for context assembly from memory, macro reports, conversation history, and recent trades.
- Create [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts) for ordered step execution, validation, `previousOutput`, and `step_log` persistence.
- Create [`lib/agents/checkpoints.ts`](/home/jared/Nexus-Terminal/lib/agents/checkpoints.ts) for save/load resume payloads from `agent_job_checkpoints`.
- Keep the Sprint 2 library split exactly as listed above. Do not introduce the reference-doc module split (`circuit-breaker.ts`, `rate-limit.ts`, `retry.ts`, `token-tracking.ts`, `prompts.ts`, `config.ts`, `worker.ts`) yet unless a tiny additive helper is unavoidable for types or tests.
- Create focused tests:
  - [`__tests__/agent-db.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-db.test.ts)
  - [`__tests__/agent-queue.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-queue.test.ts)
  - [`__tests__/agent-runtime-limits.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-runtime-limits.test.ts)
  - [`__tests__/agent-memory.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-memory.test.ts)
  - [`__tests__/agent-context.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-context.test.ts)
  - [`__tests__/agent-blueprint-runner.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprint-runner.test.ts)
  - [`__tests__/agent-checkpoints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-checkpoints.test.ts)
- Modify [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts) only if additive helper contracts are truly missing.
- Update [`HANDOFF.md`](/home/jared/Nexus-Terminal/HANDOFF.md) as each checkpoint closes.

### Security And Correctness Notes

- Do not reuse [`lib/db.ts`](/home/jared/Nexus-Terminal/lib/db.ts) directly for Docker runtime work. Mirror its shape in [`lib/agents/db.ts`](/home/jared/Nexus-Terminal/lib/agents/db.ts) so Vercel and Docker boundaries stay explicit.
- Every queue mutation after claim must match on `id + locked_by + lease_version`. Matching on `id` alone is a bug.
- `step_log` stays metadata-only. Do not store raw LLM payloads, prompts, or external API documents there.
- Macro context must query [`agent_reports`](/home/jared/Nexus-Terminal/lib/db/schema.ts) with `report_type = 'macro-summary'`. Do not recreate `macro_summaries`.
- Resume safety in Sprint 2 depends on both checkpoints and durable side-effect markers. Use [`agent_step_effects`](/home/jared/Nexus-Terminal/lib/db/schema.ts) for any side-effecting step that can be retried; do not postpone all idempotency work to the Discord-delivery sprint.
- Do not touch `.env`, `.env.local`, or secret values while implementing Sprint 2.

### Execution Contracts

These rules are part of the Sprint 2 implementation contract. Codex should be able to build the runtime from this section plus the live repo without consulting `AGENTIC_EXPANSIONV2.md`.

#### Additive Type Contracts (`lib/agents/types.ts`)

Sprint 2 makes the following targeted changes to `lib/agents/types.ts`. Add the new interfaces immediately above `export class BlueprintValidationError` (the first error class in the file).

```ts
export interface CircuitBreakerState {
  consecutiveFailures: number;
  openedAt: string | null; // ISO timestamp when breaker opened, null when closed
}

export interface QueueClaimResult {
  job: AgentJob;
  leaseVersion: number;
}
```

Sprint 2 also adds two error classes immediately after `BudgetExceededError` (matching its style — extend `Error`, set `name`, accept the offending agent for diagnostics):

```ts
export class RateLimitExceededError extends Error {
  constructor(public agentId: AgentId, public userId: string) {
    super(`rate limit exceeded for user ${userId}`);
    this.name = 'RateLimitExceededError';
  }
}

export class CircuitOpenError extends Error {
  constructor(public agentId: AgentId, public openedAt: string) {
    super(`circuit breaker open for ${agentId} since ${openedAt}`);
    this.name = 'CircuitOpenError';
  }
}
```

Sprint 2 also narrows one existing type:

- In `StepLogEntry`, change `status: 'pending' | 'running' | 'completed' | 'failed'` to `status: 'running' | 'completed' | 'failed'`. `'pending'` was speculative — Sprint 2 never writes it. There are no Sprint 1 callers of `StepLogEntry`, so narrowing is safe and stops opencode from inadvertently emitting `'pending'`.

No other type additions or modifications are permitted in Sprint 2. In particular, do not change `Blueprint`, `BlueprintStep`, `StepInput`, `StepResult`, `StepMetadata`, `AgentJob`, `AgentContext`, `AgentMemoryRow`, `BudgetExceededError`, or `BlueprintValidationError`.

**Validation framework lock-in.** `BlueprintStep.inputSchema` and `BlueprintStep.outputSchema` are typed as `unknown` in `types.ts`, but Sprint 2 must treat them as **Zod schemas only** (`import { ZodSchema } from 'zod'`). The runner calls `schema.safeParse(payload)` and, on failure, throws `new BlueprintValidationError(step.name, 'input' | 'output', parseResult.error)`. Do not introduce a second validation framework. Steps that have no schema must leave the field `undefined`; an `undefined` schema means "skip validation for this hop."

#### Test Strategy

All Sprint 2 tests use hand-rolled Drizzle mock objects following the pattern in `__tests__/server-db-utils.test.ts`. No real database connection. Mock the `db` argument directly in each test by building fluent-chain objects with `vi.fn()`.

For queue tests, the mock's `.returning()` call should return `[]` (zero rows updated) to simulate stale-worker rejection, and `[updatedRow]` to simulate successful claim. For runtime-limits and context tests, mock the Drizzle `.select().from().where()` chain to return controlled rows.

#### `lib/agents/db.ts`

- Export `getAgentDb()` as the Docker/runtime DB seam. It returns a singleton `NeonDatabase<typeof schema>` (WebSocket pool only — Docker runtime does not need a separate HTTP read path). Mirror the singleton pattern in [`lib/db.ts`](/home/jared/Nexus-Terminal/lib/db.ts) without importing `getDb()` or `getPoolDb()`.
- Export `type AgentDb = NeonDatabase<typeof schema>` as the only type alias. All other Sprint 2 modules import `AgentDb` from this file.
- Import schema directly from [`lib/db/schema.ts`](/home/jared/Nexus-Terminal/lib/db/schema.ts).
- Return `null` when `DATABASE_URL` is missing, matching the repo's existing DB-helper pattern. (Docker crash-fast on null is deferred to the Sprint 3 worker loop — Sprint 2 callers must handle null.)

#### `lib/agents/queue.ts`

- Claim exactly one eligible queued job for a target `agent_id`, ordered by `priority DESC, created_at ASC`.
- A job is eligible to claim only when `status = 'queued'` and `next_retry_at IS NULL OR next_retry_at <= now()`.
- Claim must be a single `UPDATE...WHERE...RETURNING` statement, not a SELECT followed by UPDATE. A subquery or CTE is allowed to preserve `priority DESC, created_at ASC` ordering safely, but the final UPDATE must still re-check `status = 'queued'` and `next_retry_at` eligibility so concurrent claimers get zero rows. Do not use `SELECT ... FOR UPDATE SKIP LOCKED` for Sprint 2 job claiming.
- Claim semantics must atomically set:
  - `status = 'processing'`
  - `started_at = COALESCE(started_at, now())`
  - `attempt = attempt + 1`
  - `locked_by = workerId` (a stable string passed in by the caller, format `${agentId}:${process.pid}` — queue helpers accept `workerId: string` as a parameter, they do not generate identity internally)
  - `lock_expires_at = now() + interval '5 minutes'`
  - `last_heartbeat_at = now()`
  - `lease_version = lease_version + 1`
- Return type: `QueueClaimResult | null` (defined in `types.ts`). Return `null` when no eligible job exists (zero rows returned from the UPDATE).
- Export exactly these helpers:
  - `claimNextQueuedJob(db, agentId, workerId): Promise<QueueClaimResult | null>`
  - `renewJobLease(db, jobId, lockedBy, leaseVersion): Promise<boolean>`
  - `heartbeatJob(db, jobId, lockedBy, leaseVersion): Promise<boolean>`
  - `completeJob(db, jobId, lockedBy, leaseVersion, result): Promise<boolean>`
  - `failJob(db, jobId, lockedBy, leaseVersion, errorMessage): Promise<boolean>`
  - `scheduleJobRetry(db, jobId, lockedBy, leaseVersion, nextRetryAt, errorMessage?): Promise<boolean>`
  - `persistStepLog(db, jobId, lockedBy, leaseVersion, stepLog): Promise<boolean>`
- Renew, complete, fail, heartbeat, and retry-scheduling writes must all match on `id + locked_by + lease_version`.
- Renew, complete, fail, heartbeat, schedule-retry, and `persistStepLog` return `true` when one row was updated and `false` when zero rows matched because lease ownership changed. Zero-row stale-lease results are expected control flow, not thrown errors.
- Heartbeat updates `last_heartbeat_at = now()` and extends `lock_expires_at` by 5 minutes (same duration as claim).
- `complete job` means: set `status = 'completed'`, set `result`, set `completed_at = now()`, clear `locked_by`, `lock_expires_at`, `last_heartbeat_at`, `next_retry_at`, and `error_message`.
- `fail job` means: set `status = 'failed'`, set `error_message`, set `completed_at = now()`, clear `locked_by`, `lock_expires_at`, `last_heartbeat_at`, and `next_retry_at`. Preserve `result` as-is.
- `schedule retry` means: set `status = 'queued'`, set `next_retry_at` to the computed delay, null out `locked_by`, `lock_expires_at`, and `last_heartbeat_at`. Preserve `started_at` (records when the job first began processing) and preserve prior `step_log`.
- `persistStepLog(db, jobId, lockedBy, leaseVersion, stepLog)` writes to `agent_jobs.step_log` fenced on `id + locked_by + lease_version`. The blueprint runner calls this — it does not write to `agent_jobs` directly.
- **Columns the queue helpers must NEVER touch.** `progress_note` is reserved for future runner-driven user-visible status writes and is not in scope for Sprint 2 — every queue helper must leave `progress_note` unchanged (do not include it in any `set()` clause). `max_attempts` is configuration set at job creation time only — it is read by the caller deciding whether to call `failJob` vs `scheduleJobRetry`, but no queue helper writes to it. `created_at` is database-managed and is never set by helpers.
- **Canonical claim SQL shape.** Codex must implement the claim using a CTE that selects exactly one candidate job ID and an UPDATE that re-checks eligibility on the matched row. Use `drizzle-orm`'s `sql` template literal for the CTE, since Drizzle's query builder does not express CTE-driven UPDATE in a single statement. The shape is:

  ```ts
  // Inside claimNextQueuedJob(db, agentId, workerId):
  const rows = await db.execute(sql`
    WITH candidate AS (
      SELECT id
      FROM agent_jobs
      WHERE agent_id = ${agentId}
        AND status = 'queued'
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    )
    UPDATE agent_jobs
    SET status = 'processing',
        started_at = COALESCE(started_at, now()),
        attempt = attempt + 1,
        locked_by = ${workerId},
        lock_expires_at = now() + interval '5 minutes',
        last_heartbeat_at = now(),
        lease_version = lease_version + 1
    WHERE id = (SELECT id FROM candidate)
      AND status = 'queued'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    RETURNING *;
  `);
  ```

  The trailing `WHERE status = 'queued' AND (next_retry_at IS NULL OR ...)` clause is required, not stylistic — it makes concurrent claimers race-safe by guaranteeing zero rows for losers.

- **Result shape for `claimNextQueuedJob`.** Map the returned row into `QueueClaimResult { job, leaseVersion }` where `leaseVersion` is the post-increment value (i.e., the value that the worker now owns and must use for every subsequent fenced write). Return `null` when `rows.length === 0`.
- All other helpers (`renewJobLease`, `heartbeatJob`, `completeJob`, `failJob`, `scheduleJobRetry`, `persistStepLog`) may use the Drizzle ORM builder (`db.update().set().where()`) with `and()` / `eq()` / `sql` helpers from `drizzle-orm`, since their UPDATE shape does not need a CTE.
- Stale-job reaper wiring remains out of scope for Sprint 2, but the queue helpers must be written so Sprint 3 can call them without changing lease semantics.

#### `lib/agents/runtime-limits.ts`

The blueprint runner is the primary caller of all functions in this module. Each exported guard function must accept `(db: AgentDb, userId: string, agentId: AgentId)` as its first three parameters so the runner can forward job context without re-reading from the DB.

**Exported function signatures.** The module must export exactly these five functions and no others:

```ts
// Pre-step guards. Each throws on rejection (BudgetExceededError, RateLimitExceededError,
// CircuitOpenError) and resolves with no value when allowed. Never returns a boolean — the
// throw path is the rejection signal.
export function checkBudget(db: AgentDb, userId: string, agentId: AgentId): Promise<void>;
export function checkRateLimit(db: AgentDb, userId: string, agentId: AgentId): Promise<void>;
export function checkCircuitBreaker(db: AgentDb, userId: string, agentId: AgentId): Promise<void>;

// Post-LLM bookkeeping. Called by the runner once per LLM attempt (including each repair
// retry). This is ONE atomic-ish helper that does two things in sequence: inserts the
// agent_request_log row, then applies the success/failure breaker update for the same
// attempt. The two writes do not need to share a DB transaction — order matters but partial
// success is acceptable (telemetry row may exist without breaker update on crash; the next
// attempt simply re-evaluates breaker state from agent_registry.config).
export function recordLlmAttempt(
  db: AgentDb,
  entry: TokenTrackingEntry,
): Promise<void>;

// Direct breaker mutators, exported for tests. The runner does NOT call these directly —
// it calls recordLlmAttempt, which calls these internally. They are exported so
// agent-runtime-limits.test.ts can verify open/reset behavior without faking an LLM call.
export function recordBreakerFailure(db: AgentDb, agentId: AgentId): Promise<void>;
export function recordBreakerSuccess(db: AgentDb, agentId: AgentId): Promise<void>;
```

`recordLlmAttempt` derives the agent and user from the `entry` argument (`entry.userId`, `entry.agentId`), so it does not take them as separate parameters. The three guard functions take them explicitly because they run before any `entry` exists.

- Keep Sprint 2 runtime limits consolidated in this file even though the reference architecture later splits them.
- **Token logging:** Writes to `agent_request_log`; do not invent a second token ledger. When mapping `TokenTrackingEntry` to the DB insert, convert `success` to an integer: `success: entry.success ? 1 : 0` (the schema column is `integer`, the TS type is `boolean`). Call `Math.round()` on `estimatedCostCents` before insert (schema is `integer`; fractional values will be silently truncated by Postgres). One `agent_request_log` row is inserted per LLM attempt; repair retries get their own row with the same `userId + agentId + mode + lane` so daily/monthly budget math counts them.
- **Budget checks (`checkBudget`):** Call `getLlmBudgetConfig()` from [`lib/agents/llm-client.ts`](/home/jared/Nexus-Terminal/lib/agents/llm-client.ts) — read `dailyBudgetCents` and `monthlyBudgetCents` from the returned `LlmBudgetConfig`. Daily check sums `estimated_cost_cents` in `agent_request_log` where `user_id = ?` AND `created_at >= start of current UTC calendar day`. Monthly check uses `created_at >= first of the current UTC calendar month`. Both checks are scoped per `userId` only, not per `userId + agentId`. Throw `new BudgetExceededError(agentId, 'daily')` or `new BudgetExceededError(agentId, 'monthly')` on violation. The check fails fast — it runs before any LLM call so no token is wasted on a doomed request.
- **Rate limiting (`checkRateLimit`):** DB-backed, queries `agent_request_log` for the requesting user. The V1 limit is 30 requests per rolling hour: count rows where `user_id = ?` AND `created_at >= now() - interval '1 hour'`. Scoped per `userId` only. Throw `new RateLimitExceededError(agentId, userId)` when the count is `>= 30`.
- **Circuit breaker (`checkCircuitBreaker`):** `agent_registry.config.circuitBreaker` is the only authoritative breaker state. `agent_request_log` remains telemetry only and must not be scanned to recompute breaker state. Throw `new CircuitOpenError(agentId, openedAt)` when the breaker is open and within the 60s reset window. See breaker policy below for the open/reset state machine.
- Circuit-breaker policy for Sprint 2:
  - Scope is per `agentId` (one breaker per `agent_registry` row), not per user.
  - Open after 5 consecutive failed LLM requests for that agent.
  - `recordBreakerFailure(db, agentId)` increments `consecutiveFailures` with a single SQL UPDATE against `agent_registry.config` and sets `openedAt = now()` only when the post-increment counter reaches 5. Use Postgres `jsonb_set` so the increment is atomic — no read-modify-write in TypeScript. Canonical shape:

    ```ts
    // Inside recordBreakerFailure(db, agentId):
    await db.execute(sql`
      UPDATE agent_registry
      SET config = jsonb_set(
        jsonb_set(
          config,
          '{circuitBreaker,consecutiveFailures}',
          to_jsonb(COALESCE((config #>> '{circuitBreaker,consecutiveFailures}')::int, 0) + 1)
        ),
        '{circuitBreaker,openedAt}',
        CASE
          WHEN COALESCE((config #>> '{circuitBreaker,consecutiveFailures}')::int, 0) + 1 >= 5
            THEN to_jsonb(now()::text)
          ELSE config #> '{circuitBreaker,openedAt}'
        END
      )
      WHERE id = ${agentId};
    `);
    ```

  - `recordBreakerSuccess(db, agentId)` resets breaker state to `{ consecutiveFailures: 0, openedAt: null }` with a single SQL UPDATE that overwrites the `circuitBreaker` key directly.
  - `checkCircuitBreaker(db, userId, agentId)` reads `agent_registry.config.circuitBreaker` for the agent. If `openedAt` is `null`, allow work. If `openedAt` is less than 60 seconds old, throw `CircuitOpenError`. If `openedAt` is 60 or more seconds old, the function MUST first call `recordBreakerSuccess(db, agentId)` to clear the breaker, then return (allow). Sprint 2 has no half-open mode.
  - If `agent_registry.config` does not yet contain a `circuitBreaker` key for an agent, treat the breaker as closed (`{ consecutiveFailures: 0, openedAt: null }`). The first failure or success write will create the key via `jsonb_set`.

#### `lib/agents/memory.ts`

- All reads and writes use [`agent_memory_v2`](/home/jared/Nexus-Terminal/lib/db/schema.ts) only. Do not import or reference the legacy `agent_memory` table.
- Memory helpers must always scope by both `user_id` and `agent_id`.
- Upserts must honor the live unique key on `(user_id, agent_id, category, key)`.
- Export two functions:
  - `getMemory(db: AgentDb, userId: string, agentId: AgentId, category?: MemoryCategory): Promise<AgentMemoryRow[]>`
  - `upsertMemory(db: AgentDb, row: Omit<AgentMemoryRow, 'id' | 'createdAt' | 'updatedAt'>): Promise<void>`
- No other exports are needed in Sprint 2.

#### `lib/agents/context.ts`

Export a single function: `buildContext(db: AgentDb, userId: string, agentId: AgentId): Promise<AgentContext>`. No additional exports needed.

- Build context from live repo tables only:
  - memory from `agent_memory_v2` (call `getMemory` from `lib/agents/memory.ts`)
  - macro summary from the latest published `agent_reports` row where `user_id = 'system-agent-user'`, `agent_id = 'orchestrator'`, `report_type = 'macro-summary'`, and `status = 'published'`, ordered by `created_at DESC LIMIT 1`. Return `null` if no row exists.
  - conversation history from `agent_conversations`
  - trade context from `trades`
- Default query scope for Sprint 2:
  - latest 20 conversation rows for `user_id + agent_id`, ordered by `created_at DESC`
  - latest 20 trades for `user_id`, ordered by `sort_key DESC` (the existing index `idx_trades_user_sort_key` makes this cheap)
- Empty-state behavior: when no rows exist for any source, `buildContext` must return the literal shape below. The runner relies on this exact contract — never throw, never return `null` at the top level.

  ```ts
  // Empty-state return value when every source query returns zero rows:
  {
    recentTrades: [],
    macroSummary: null,
    memory: [],
    conversationHistory: [],
  } satisfies AgentContext
  ```

  When some sources return rows and others don't, populate the ones that have rows and use the empty values above for the rest. Each source query is independent — a missing macro summary must not block trade or memory loading.
- Route-level session narrowing is deferred to Sprint 3 API work. Sprint 2 context assembly should stay deterministic and library-only.

#### `lib/agents/blueprint-runner.ts`

**Exported function signature.** Exactly one export:

```ts
export interface RunBlueprintOptions {
  signal?: AbortSignal;
  // Optional caller-supplied lockedBy / leaseVersion override. Sprint 2 callers
  // (tests + Sprint 3 worker) pass the values returned from claimNextQueuedJob.
  lockedBy: string;
  leaseVersion: number;
}

export interface RunBlueprintResult {
  status: 'completed' | 'failed';
  finalOutput: unknown;       // last successful step's StepResult.data, or null on failure
  failureReason?: string;     // human-readable error class + message when status === 'failed'
  stepsExecuted: number;      // number of steps the runner actually invoked (after resume skip)
}

export function runBlueprint(
  blueprint: Blueprint,
  job: AgentJob,
  config: AgentConfig,
  db: AgentDb,
  options: RunBlueprintOptions,
): Promise<RunBlueprintResult>;
```

The runner does NOT call `completeJob` / `failJob` itself — it returns `RunBlueprintResult` and lets the caller (Sprint 3 worker loop) decide whether to call `completeJob`, `failJob`, or `scheduleJobRetry` based on the failure class. Sprint 2 tests can call `completeJob` directly after `runBlueprint` returns.

**Behavior contract:**

- Executes ordered steps without importing route code (`app/api/**`) or service entrypoints (`services/**`). The runner is library-only.
- The runner fetches context once before step iteration by calling `buildContext(db, job.userId, job.agentId)` from `lib/agents/context.ts`. It must not issue a second memory query; `stepInput.memory` is assigned from `context.memory`.
- Before executing any step (including the first), the runner calls **in this order**: `checkBudget(db, job.userId, job.agentId)`, `checkRateLimit(db, job.userId, job.agentId)`, then `checkCircuitBreaker(db, job.userId, job.agentId)`. If any check throws, the runner does NOT execute the step. It catches the error, classifies it (`BudgetExceededError` → `failureClass: 'policy'`; `RateLimitExceededError` → `failureClass: 'policy'`; `CircuitOpenError` → `failureClass: 'dependency'`), persists a `failed` `step_log` entry for the current step, and returns `{ status: 'failed', finalOutput: null, failureReason: <error.message>, stepsExecuted }`.
- The runner calls `step.run(stepInput)` to execute any step type (`code` or `llm`). It constructs `StepInput` with **exactly this field mapping**:

  ```ts
  const stepInput: StepInput = {
    jobInput: job.input,            // raw job payload — same value for every step
    previousOutput,                 // null for step 1, prior StepResult.data thereafter
    memory: context.memory,         // from buildContext, never re-queried per step
    context,                        // full AgentContext from buildContext
  };
  ```

  Note that `job.input` maps to `stepInput.jobInput`. The field rename is intentional — `StepInput` already exists in `lib/agents/types.ts` and the runner must conform to it.

- `previousOutput` is `null` for step 1 and the `StepResult.data` from the immediately preceding step thereafter. It is NOT a merged aggregate of all prior steps — each step is responsible for forwarding what downstream steps need.
- **Input validation** uses the handoff payload for the current step:
  - Step 1: if `step.inputSchema` is defined, run `step.inputSchema.safeParse(job.input)`.
  - Step 2+: if `step.inputSchema` is defined, run `step.inputSchema.safeParse(previousOutput)`.
  - On failure, throw `new BlueprintValidationError(step.name, 'input', parseResult.error)` and short-circuit the run with `failureClass: 'contract'`. `inputSchema` never validates the full `StepInput` object — only the handoff payload.
- **Output validation** runs against `result.data` when `step.outputSchema` is defined: `step.outputSchema.safeParse(result.data)`. On failure, follow the repair-retry rules below.
- **Repair retry policy** (LLM steps only):
  - When an `llm` step's output validation fails, the runner calls `step.run(stepInput)` exactly one more time (one repair retry). Sprint 2 enforces a hard cap of 1 repair retry per step regardless of `StepMetadata.maxRepairAttempts`. `maxRepairAttempts` is reserved for future use and must not be read by the Sprint 2 runner.
  - Repair retries do NOT increment `agent_jobs.attempt`. `attempt` is the job-level retry counter, owned by the queue, not the runner.
  - Each LLM attempt — original AND repair retry — gets its own `agent_request_log` row via `recordLlmAttempt`. This means the daily/monthly budget check counts repair retries against the user's quota.
  - If the repair retry also fails output validation, throw `new BlueprintValidationError(step.name, 'output', parseResult.error)` and short-circuit with `failureClass: 'contract'`.
  - For `code` steps, there is no repair retry. A failed `code` step short-circuits immediately with the error mapped to `failureClass: 'transient'` if the step throws, or `'contract'` if `outputSchema` rejects the result.
- **LLM bookkeeping path.** After every `llm` attempt (success OR failure, original OR repair retry), the runner calls `recordLlmAttempt(db, entry)` from `runtime-limits.ts` exactly once for that attempt. The `entry: TokenTrackingEntry` object is built from the LLM response: `userId = job.userId`, `agentId = job.agentId`, `mode = job.jobType`, `lane` from `step.metadata.lane ?? 'background'`, plus the response's token counts, model, duration, and `success` boolean. `code` steps do NOT call `recordLlmAttempt` — they don't consume LLM tokens.
- **`step_log` persistence.** Persist `step_log` after each meaningful state transition by calling `persistStepLog(db, job.id, options.lockedBy, options.leaseVersion, updatedStepLog)` from `lib/agents/queue.ts` (which fences on `id + locked_by + lease_version`). The runner does NOT write to `agent_jobs` directly. The persisted entries must contain only these fields:

  ```ts
  // StepLogEntry shape that the runner writes:
  {
    step: string,                    // step.name
    status: 'running' | 'completed' | 'failed',  // narrowed — no 'pending'
    startedAt: string,               // ISO timestamp set when runner enters the step
    completedAt?: string,            // ISO timestamp set when step finishes (success or failure)
    attempt: number,                 // job.attempt (NOT the repair retry counter)
    validatorResult?: 'pass' | 'fail',
    tokensUsed?: number,             // sum of all attempts' tokens for this step (including repair retry)
    errorClass?: string,             // failureClass when status === 'failed'
  }
  ```

  Each step writes one entry to `step_log` when it transitions from `running` → `completed` or `running` → `failed`. The runner appends to the existing array; it does not replace or de-duplicate.

- **`persistStepLog` stale-lease handling.** If `persistStepLog` returns `false` (zero rows updated because lease ownership changed), the runner must abort immediately with `{ status: 'failed', finalOutput: null, failureReason: 'lease lost during step_log persistence', stepsExecuted }`. Continuing to execute further steps after a stolen lease is a correctness bug.
- **Resume integration.** Before iterating steps, the runner calls `loadCheckpoint(db, job.id)` from `lib/agents/checkpoints.ts`. If a checkpoint exists, the runner sets `previousOutput = checkpoint.checkpointJson` and starts iteration at index `checkpoint.stepIndex + 1`. If no checkpoint exists, iteration starts at index 0 with `previousOutput = null`. (See `lib/agents/checkpoints.ts` below for the side-effect-marker contract that gates step skipping.)
- AEV2-305 covers runner core only. Prompt loading, prompt file resolution, and blueprint/config registry wiring are deferred to AEV2-308. Sprint 2 runner work must use the existing `Blueprint` / `AgentConfig` contracts from [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts); broader wiring belongs to later stories.

#### `lib/agents/checkpoints.ts`

The blueprint runner imports and calls `saveCheckpoint()`, `loadCheckpoint()`, and `recordStepEffect()` directly. The checkpoint module has no dependency on the runner.

**Exported function signatures.** Exactly three exports:

```ts
export interface CheckpointRecord {
  jobId: string;
  stepIndex: number;     // matches BlueprintStep position in blueprint.steps (0-indexed)
  stepName: string;
  checkpointJson: unknown;  // exactly the value that becomes previousOutput for the next step
}

// Loads the most recently saved checkpoint for a job. Returns null when no row exists.
// "Most recent" is the highest step_index, NOT the highest created_at — the unique index
// on (job_id, step_index) means there is at most one row per (job, step), and saveCheckpoint
// uses ON CONFLICT DO UPDATE so re-saving the same step bumps updated_at without creating
// a duplicate.
export function loadCheckpoint(db: AgentDb, jobId: string): Promise<CheckpointRecord | null>;

// Persists the checkpoint for a single completed step. Uses ON CONFLICT (job_id, step_index)
// DO UPDATE so re-running the same step (which Sprint 2 does not do, but Sprint 3 reapers may)
// is idempotent. Generate `id` with crypto.randomUUID() — there is no helper to call.
export function saveCheckpoint(
  db: AgentDb,
  record: CheckpointRecord,
): Promise<void>;

// Inserts the side-effect marker row. Idempotent on the unique index agent_step_effects_idempotency.
// On unique-violation, returns false (the effect already happened — caller must skip the step).
// On successful insert, returns true. Generate `id` with crypto.randomUUID().
export function recordStepEffect(
  db: AgentDb,
  effect: {
    jobId: string;
    stepName: string;
    effectType: 'checkpoint-marker' | 'report-write' | 'discord-delivery' | 'memory-write';
    idempotencyKey: string;
  },
): Promise<boolean>;
```

There is no `hasStepEffect` function — the runner's existence check is folded into `recordStepEffect`'s `ON CONFLICT DO NOTHING` semantics. (See "Skip flow" below.)

**Checkpoint semantics:**

- `checkpoint_json` stores the normalized `StepResult.data` of the last successful step only. Sprint 2 does not maintain a second accumulator object. The value in `checkpoint_json` is exactly what the runner passes as `previousOutput` to the next step.
- The schema column `agent_job_checkpoints` has no `status` field. Treat every row in the table as authoritative — saving a row is itself the "completed" signal. The runner only calls `saveCheckpoint` after a step's `step.run()` returns successfully and (if applicable) `outputSchema` validates.
- Resume semantics:
  - Call `loadCheckpoint(db, job.id)`. The query is `SELECT id, job_id, step_index, step_name, checkpoint_json FROM agent_job_checkpoints WHERE job_id = ? ORDER BY step_index DESC LIMIT 1`.
  - If the result is not null, restore `previousOutput = result.checkpointJson` and start iteration at `result.stepIndex + 1`. If the next index is past `blueprint.steps.length - 1`, the job was already complete — return `{ status: 'completed', finalOutput: result.checkpointJson, stepsExecuted: 0 }` immediately.
  - If the result is null, start iteration at index 0 with `previousOutput = null`.
- **When `saveCheckpoint` is called within the step lifecycle.** For each successful step the runner executes the following sequence in this exact order:
  1. `step.run(stepInput)` returns success.
  2. `step.outputSchema?.safeParse(result.data)` succeeds (or there is no outputSchema).
  3. If `step.metadata.sideEffect === true`, call `recordStepEffect(...)` with the resolved idempotency key. If `recordStepEffect` returns `false` (key already existed) the runner treats the step as already completed and proceeds to step 4 with `previousOutput` UNCHANGED from its pre-step value (see "Skip flow" below for the read path).
  4. Call `saveCheckpoint(db, { jobId, stepIndex, stepName, checkpointJson: result.data })`.
  5. Call `recordLlmAttempt(...)` if this was an LLM step (already handled above per attempt — included here only to fix the relative ordering).
  6. Call `persistStepLog(...)` with the completed `step_log` entry appended.

  Steps 3 → 4 → 6 must happen in this order. Step 5 can happen between any of them as long as it runs once per LLM attempt. If the worker crashes between any two of these calls, see "Crash recovery" below.

**Side-effect / idempotency contract:**

- A step is side-effecting when `step.metadata.sideEffect === true` AND `step.metadata.idempotencyKey` is a non-empty string. Either condition false → no idempotency check, no `recordStepEffect` call.
- `metadata.idempotencyKey` must be a fully qualified, globally unique key for the logical effect. The canonical format is `${job.id}:${step.name}:${effectType}`, for example `${job.id}:write-orchestrator-report:report-write`. Bare step names are invalid because `agent_step_effects.idempotency_key` has a global unique index.
- **Allowed `effectType` values** for Sprint 2 are exactly: `'checkpoint-marker'`, `'report-write'`, `'discord-delivery'`, `'memory-write'`. The runner does not validate these strings, but blueprints in later sprints must pick from this set so analytics queries are stable.
- **Sprint 2 scope on actual side effects.** Sprint 2 has no blueprints that perform out-of-process side effects (no Discord delivery, no webhook calls). The `recordStepEffect` plumbing is built and tested now so Sprint 3's `report-write` and `discord-delivery` steps wire in cleanly. Sprint 2 tests exercise the skip flow with a synthetic `effectType: 'memory-write'` step, NOT `'discord-delivery'`.
- **Skip flow when an effect marker already exists.** When `recordStepEffect` returns `false`:
  1. The runner does NOT call `step.run()` for this step (it has already happened in a prior attempt — re-running would duplicate the side effect).
  2. The runner needs a `previousOutput` to pass to the next step. Sprint 2 resolves this by treating the most recent saved checkpoint for THIS step (`agent_job_checkpoints WHERE job_id = ? AND step_index = ?`) as the source of truth: call a helper query inside the runner to fetch that row's `checkpoint_json` and use it as `previousOutput` for the next step. If no checkpoint row exists for this step (the prior attempt crashed between `recordStepEffect` and `saveCheckpoint`), see "Crash recovery" below.
  3. The runner appends a `step_log` entry with `status: 'completed'`, `validatorResult: 'pass'`, `tokensUsed: 0`, and `attempt: job.attempt` so the skip is observable.

**Crash recovery:** A worker can die between any two of the post-step writes. The runner must handle these states deterministically on the next attempt:

| Crashed between | State on disk | Resume behavior |
|-----------------|--------------|-----------------|
| `step.run` success and `recordStepEffect` | No effect row, no checkpoint | Re-run the step. Idempotent because no marker yet. |
| `recordStepEffect` and `saveCheckpoint` | Effect row exists, no checkpoint | `recordStepEffect` returns `false`. The skip-flow checkpoint lookup finds no row for this step → fall back to the latest saved checkpoint (the PRIOR step's `checkpointJson`) as `previousOutput`. Log a `step_log` entry with `errorClass: 'crash-between-effect-and-checkpoint'` so the gap is auditable, then proceed to the next step. |
| `saveCheckpoint` and `persistStepLog` | Effect row + checkpoint exist, step_log missing | `loadCheckpoint` finds the checkpoint and resumes at `stepIndex + 1`. The missing `step_log` entry for the prior step is acceptable — it's metadata, not state. |
| `persistStepLog` and the next step | Everything for prior step persisted | Normal resume. |

The fallback in row 2 IS a real semantic compromise: the next step will see the previous-previous step's output instead of the just-skipped step's output. Sprint 2 accepts this because no Sprint 2 blueprint actually has a side-effecting step, so the gap is theoretical until Sprint 3. Sprint 3 will revisit by storing a small "effect result envelope" alongside the marker. **Do not** invent that envelope in Sprint 2.

- **Effect-row insert is the runner's job, not the step's job.** Sprint 2 does not permit an out-of-process side effect to happen inside `step.run()`. The runner inserts the `agent_step_effects` row via `recordStepEffect` AFTER the step returns success. Steps that need to perform a side effect must declare it via `metadata.sideEffect = true` and let the runner handle the marker — they must not write to `agent_step_effects` themselves.

#### Explicit Deferrals

- Do not add `worker.ts`, Docker healthchecks, `/tmp/healthy`, or stale-job reaper scheduling in Sprint 2.
- Do not add `/api/agents/*` routes, Discord embed/delivery helpers, or Compose cleanup in Sprint 2.
- Do not create `macro_summaries`, a new memory table, or a second token/cost tracking table.

### Order Of Operations

1. Add the Docker-side DB boundary first.
2. Add the lease-fenced queue helpers second.
3. Add runtime limits plus memory/context assembly next.
4. Add the blueprint runner once queue + context contracts are stable.
5. Add checkpoint/resume last so it builds on the final runner and step-log shape.

### Checkpoint 1 — DB Boundary + Lease-Fenced Queue

**Stories:** `AEV2-301`, `AEV2-302`

**Review focus:** confirm the runtime DB helper is separate from Vercel helpers and that stale workers cannot renew or complete work after lease ownership changes.

**Suggested commit:** `feat(aev2): add agent db and lease-fenced queue helpers`

**Check off before commit**

- [x] [`lib/agents/db.ts`](/home/jared/Nexus-Terminal/lib/agents/db.ts) exists and provides `getAgentDb()` returning a WebSocket pool singleton plus `type AgentDb`.
- [x] [`lib/agents/queue.ts`](/home/jared/Nexus-Terminal/lib/agents/queue.ts) exports exactly the seven helpers listed in the spec (`claimNextQueuedJob`, `renewJobLease`, `heartbeatJob`, `completeJob`, `failJob`, `scheduleJobRetry`, `persistStepLog`).
- [x] Claim is implemented with the canonical CTE shape from the spec — single UPDATE driven by a CTE candidate, re-checks `status = 'queued'` and `next_retry_at` eligibility in the UPDATE WHERE clause.
- [x] Claiming a job sets a 5-minute lease, increments `lease_version`, sets `started_at = COALESCE(started_at, now())`, and returns `QueueClaimResult | null`.
- [x] Queue writes fence on `id + locked_by + lease_version`.
- [x] No queue helper writes to `progress_note` or `max_attempts`.
- [x] `completeJob` clears `error_message`; `failJob` preserves `result` as-is; `scheduleJobRetry` preserves `started_at` and `step_log`.
- [x] All non-claim helpers return `false` (not throw) on stale-lease zero-row updates.
- [x] No `lib/agents/*.ts` file imports from `@/lib/db` directly (use `lib/agents/db.ts` only).
- [x] Focused tests cover stale-worker rejection paths for every fenced helper, happy-path lease renewal/completion, and `next_retry_at` boundary (future vs past).

**Exit criteria**

- [x] Docker runtime code no longer depends on `getDb()` / `getPoolDb()` as its primary DB seam.
- [x] Stale workers cannot renew a lease or write completion/failure after ownership changes.
- [x] `agent_jobs.step_log` remains metadata-only.

**Validation**

- [x] `npx vitest run __tests__/agent-db.test.ts __tests__/agent-queue.test.ts`
- [x] `npm run lint`
- [x] `npx tsc --noEmit`

### Checkpoint 2 — Runtime Limits + Memory / Context Assembly

**Stories:** `AEV2-303`, `AEV2-304`

**Review focus:** confirm token/budget enforcement is deterministic, `agent_memory_v2` is the only memory table used, and macro context comes from `agent_reports`.

**Suggested commit:** `feat(aev2): add agent runtime limits and context helpers`

**Check off before commit**

- [x] [`lib/agents/runtime-limits.ts`](/home/jared/Nexus-Terminal/lib/agents/runtime-limits.ts) exports exactly `checkBudget`, `checkRateLimit`, `checkCircuitBreaker`, `recordLlmAttempt`, `recordBreakerFailure`, and `recordBreakerSuccess`. The three guard functions throw on rejection (no boolean returns).
- [x] `RateLimitExceededError` and `CircuitOpenError` are added to `lib/agents/types.ts` immediately after `BudgetExceededError`.
- [x] Token logging converts `success` to `0 | 1` on insert and calls `Math.round()` on `estimatedCostCents`.
- [x] Budget checks sum `estimated_cost_cents` from `agent_request_log` using UTC calendar day/month boundaries, scoped per userId only, and read `dailyBudgetCents` / `monthlyBudgetCents` from `getLlmBudgetConfig()`.
- [x] Rate limit enforces 30 req/hr per userId using rolling 1-hour window.
- [x] Circuit-breaker state uses the `CircuitBreakerState` type as the single source of truth in `agent_registry.config` and is written via the canonical `jsonb_set` SQL shape from the spec (not read-modify-write). `checkCircuitBreaker` self-heals stale-open breakers by calling `recordBreakerSuccess` when `openedAt` is ≥ 60s old.
- [x] [`lib/agents/memory.ts`](/home/jared/Nexus-Terminal/lib/agents/memory.ts) exports `getMemory()` and `upsertMemory()`, reads and writes `agent_memory_v2` only.
- [x] [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts) exports `buildContext()` returning `AgentContext`. Assembles memory, recent trades, conversation history, and latest macro summary.
- [x] Context queries use the Sprint 2 default scope: latest 20 trades, latest 20 conversation rows, latest published orchestrator macro summary owned by `system-agent-user`. Empty-state return matches the literal shape `{ recentTrades: [], macroSummary: null, memory: [], conversationHistory: [] }`.
- [x] Focused tests cover budget rejection (daily and monthly), breaker open/reset behavior including 60s self-heal, rate-limit rejection, agent-scoped memory reads, context query scoping, empty-state behavior (no memory, no macro, no trades), and macro-summary lookup without `macro_summaries`.

**Exit criteria**

- [x] Runtime limit checks can reject work before expensive downstream steps run.
- [x] No new code reads or writes the legacy `agent_memory` table.
- [x] Macro summary context is sourced from `agent_reports`.
- [x] Sprint 2 context assembly is deterministic and does not require route/session code.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npx vitest run __tests__/agent-runtime-limits.test.ts __tests__/agent-memory.test.ts __tests__/agent-context.test.ts`

### Checkpoint 3 — Blueprint Runner Core

**Stories:** `AEV2-305`

**Review focus:** lock the `previousOutput` contract before resume work lands. Every step should receive the prior step output, validate the correct handoff payload, and persist step metadata without leaking raw artifacts.

**Suggested commit:** `feat(aev2): add agent blueprint runner`

**Check off before commit**

- [x] [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts) exports exactly `runBlueprint(blueprint, job, config, db, options)` returning `Promise<RunBlueprintResult>` with the `RunBlueprintResult` shape from the spec. Runner does NOT call `completeJob`/`failJob` itself.
- [x] Runner fetches context via `buildContext()` once before step iteration and assigns `stepInput.memory` from `context.memory`. No second memory query.
- [x] Runner calls `checkBudget` → `checkRateLimit` → `checkCircuitBreaker` (in this order) before each step. Rejection throws are caught and mapped to `failureClass: 'policy'` (budget/rate) or `'dependency'` (breaker), then short-circuit with a `failed` `step_log` entry.
- [x] `StepInput` field mapping uses `jobInput: job.input` exactly (the field rename matches `lib/agents/types.ts`).
- [x] Input and output validation happen inside the runner via Zod's `safeParse`, not in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts). `BlueprintValidationError` is thrown on failure.
- [x] `previousOutput` is the prior step's `StepResult.data` (not a merged aggregate), `null` for step 1, and `inputSchema` validates `job.input` for step 1 then `previousOutput` for later steps.
- [x] LLM output-contract failures support exactly 1 repair retry. `maxRepairAttempts` is not read. Repair retries do NOT increment `agent_jobs.attempt`.
- [x] Each LLM attempt — including the repair retry — calls `recordLlmAttempt(db, entry)` exactly once. Code steps do not call `recordLlmAttempt`.
- [x] `step_log` is persisted via `persistStepLog()` from queue.ts — runner does not write to `agent_jobs` directly, and `step_log.status` stays within `running | completed | failed`. A `false` return from `persistStepLog` aborts the run with `failureReason: 'lease lost during step_log persistence'`.
- [x] Runner integrates with checkpoints: calls `loadCheckpoint(db, job.id)` before iteration and resumes at `stepIndex + 1` when present.
- [x] Focused tests cover ordered execution, step-1 vs later-step validation, repair-retry logging cardinality, step-log persistence, runtime-limit rejection before step execution, and stale-lease abort during `persistStepLog`.

**Exit criteria**

- [x] Blueprint execution is deterministic and does not require route-level code.
- [x] LLM and code steps share one runner contract.
- [x] Failure paths classify and surface step-level errors cleanly.
- [x] The runner remains library-only and does not require new route wiring, worker wiring, or a new prompt/config registry.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npx vitest run __tests__/agent-blueprint-runner.test.ts`

### Checkpoint 4 — Checkpoint / Resume Hardening

**Stories:** `AEV2-306`

**Review focus:** verify retries resume from the latest completed checkpoint instead of replaying prior side effects or restarting from step 1.

**Suggested commit:** `feat(aev2): add agent checkpoint resume support`

**Check off before commit**

- [x] [`lib/agents/checkpoints.ts`](/home/jared/Nexus-Terminal/lib/agents/checkpoints.ts) exports exactly `loadCheckpoint`, `saveCheckpoint`, and `recordStepEffect` with the signatures and return types from the spec.
- [x] `saveCheckpoint` uses `ON CONFLICT (job_id, step_index) DO UPDATE` so re-saving the same step is idempotent. `recordStepEffect` returns `false` on unique-violation (idempotency key already exists).
- [x] The runner resumes from the next step after the most recently saved checkpoint by calling `loadCheckpoint` once before step iteration. If no checkpoint exists, iteration starts at index 0 with `previousOutput = null`.
- [x] Side-effecting steps gate on `recordStepEffect` (the runner skips the step when it returns `false`). The skip flow looks up the prior checkpoint for the same `step_index` to recover `previousOutput`; if the lookup misses, the runner falls back to the most recent earlier checkpoint and emits a `step_log` entry with `errorClass: 'crash-between-effect-and-checkpoint'`.
- [x] The runner inserts the effect row AFTER `step.run()` returns success and AFTER output validation, but BEFORE `saveCheckpoint`, `persistStepLog`, or any job-status write. The post-step write order is `recordStepEffect → saveCheckpoint → persistStepLog`.
- [x] No Sprint 2 blueprint or test uses `effectType: 'discord-delivery'`. Skip-flow tests use `effectType: 'memory-write'` as the synthetic effect.
- [x] Focused tests cover: simulated mid-blueprint failure resume from the correct step; side-effect skip on retry; the four crash-recovery rows in the spec table; saveCheckpoint idempotency on re-save.

**Exit criteria**

- [x] Resume starts from the latest completed checkpoint, not step 1.
- [x] Prior successful side effects are not replayed during retry.
- [x] Checkpoint payloads store the normalized last successful step output only.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npx vitest run __tests__/agent-checkpoints.test.ts __tests__/agent-blueprint-runner.test.ts`

### Sprint 2 Exit Gate

- [x] `AEV2-301` through `AEV2-306` landed in the order above.
- [x] `CircuitBreakerState`, `QueueClaimResult`, `RateLimitExceededError`, and `CircuitOpenError` added to `lib/agents/types.ts`.
- [x] `StepLogEntry.status` narrowed to `'running' | 'completed' | 'failed'` in `lib/agents/types.ts`.
- [x] Focused tests cover lease fencing, runtime limits (including breaker self-heal), memory/context assembly, blueprint execution (including repair-retry logging), and checkpoint resume (including all four crash-recovery rows).
- [x] No Sprint 2 code depends on `/api/agents/*`, Discord delivery, or service package wiring.
- [x] No Sprint 2 code imports or references the legacy `agent_memory` table (grep for `agentMemory` and `agent_memory` excluding `_v2`).
- [x] No `lib/agents/*.ts` file imports from `@/lib/db` helper modules directly; schema-only imports remain allowed in Sprint 2.
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] [`HANDOFF.md`](/home/jared/Nexus-Terminal/HANDOFF.md) updated after the final checkpoint closes.

### Complexity

- Overall complexity: `L`
- Highest-risk checkpoint: Checkpoint 1, because lease fencing is the core correctness boundary for every later runtime path.
