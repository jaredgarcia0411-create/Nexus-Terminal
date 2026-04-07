# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Sprint 1 is complete. Older completed sections and manual-spec cleanup notes were removed from this file; use git history and `AEV2_PLAN.md` for archived detail.

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

> Generated: 2026-04-06 | Agent: Codex
> Status: READY

### Objective

Build the shared runtime layer under `lib/agents/` so the queue, memory, blueprint, and checkpoint contracts are safe before any `/api/agents/*` routes or Docker service wiring are added.

### Current State

- Sprint 1 contracts already exist in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts), [`lib/agents/llm-client.ts`](/home/jared/Nexus-Terminal/lib/agents/llm-client.ts), and [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts).
- Sprint 1 schema is already live in [`lib/db/schema.ts`](/home/jared/Nexus-Terminal/lib/db/schema.ts) and [`drizzle/0019_clever_zodiak.sql`](/home/jared/Nexus-Terminal/drizzle/0019_clever_zodiak.sql), including `agent_jobs`, `agent_reports`, `agent_memory_v2`, `agent_step_effects`, `agent_job_checkpoints`, and `agent_scheduled_runs`.
- There are no Sprint 2 runtime modules yet: [`lib/agents/db.ts`](/home/jared/Nexus-Terminal/lib/agents/db.ts), [`lib/agents/queue.ts`](/home/jared/Nexus-Terminal/lib/agents/queue.ts), [`lib/agents/runtime-limits.ts`](/home/jared/Nexus-Terminal/lib/agents/runtime-limits.ts), [`lib/agents/memory.ts`](/home/jared/Nexus-Terminal/lib/agents/memory.ts), [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts), [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts), and [`lib/agents/checkpoints.ts`](/home/jared/Nexus-Terminal/lib/agents/checkpoints.ts) do not exist yet.
- Root TypeScript excludes [`services/`](/home/jared/Nexus-Terminal/services), so Sprint 2 should stay library-first and avoid service package work until a dedicated service-side TS validation path exists.
- Legacy `agent_memory` still exists in [`lib/db/schema.ts`](/home/jared/Nexus-Terminal/lib/db/schema.ts); all new runtime code must use `agent_memory_v2` only.
- [`services/docker-compose.yml`](/home/jared/Nexus-Terminal/services/docker-compose.yml) still reflects older runtime assumptions. Do not fold Compose or Redis cleanup into Sprint 2.

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

Sprint 2 requires these type additions to `lib/agents/types.ts`. Add them at the end of the file, before the error classes.

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

No other type additions are needed in Sprint 2. Do not modify existing types.

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
- Claim must be a single `UPDATE...WHERE...RETURNING` statement, not a SELECT followed by UPDATE. Use Drizzle's ORM builder (`db.update().set().where()`) with `and()` / `or()` / `lte()` / `isNull()` / `sql` helpers from `drizzle-orm`. Use raw `sql` template literals only for expressions Drizzle helpers cannot express (e.g., `sql\`${table.attempt} + 1\``).
- Claim semantics must atomically set:
  - `status = 'processing'`
  - `started_at = now()`
  - `attempt = attempt + 1`
  - `locked_by = workerId` (a stable string passed in by the caller, format `${agentId}:${process.pid}` — queue helpers accept `workerId: string` as a parameter, they do not generate identity internally)
  - `lock_expires_at = now() + interval '5 minutes'`
  - `last_heartbeat_at = now()`
  - `lease_version = lease_version + 1`
- Return type: `QueueClaimResult | null` (defined in `types.ts`). Return `null` when no eligible job exists (zero rows returned from the UPDATE).
- Renew, complete, fail, heartbeat, and retry-scheduling writes must all match on `id + locked_by + lease_version`.
- Heartbeat updates `last_heartbeat_at = now()` and extends `lock_expires_at` by 5 minutes (same duration as claim).
- `schedule retry` means: set `status = 'queued'`, set `next_retry_at` to the computed delay, null out `locked_by`, `lock_expires_at`, and `last_heartbeat_at`. Preserve `started_at` (records when the job first began processing) and preserve prior `step_log`.
- Export a `persistStepLog(db, jobId, lockedBy, leaseVersion, stepLog)` helper that writes to `agent_jobs.step_log` fenced on `id + locked_by + lease_version`. The blueprint runner calls this — it does not write to `agent_jobs` directly.
- Stale-job reaper wiring remains out of scope for Sprint 2, but the queue helpers must be written so Sprint 3 can call them without changing lease semantics.

#### `lib/agents/runtime-limits.ts`

The blueprint runner is the primary caller of all functions in this module. Each exported function must accept `(db: AgentDb, userId: string, agentId: AgentId)` as its first three parameters so the runner can forward job context without re-reading from the DB.

- Keep Sprint 2 runtime limits consolidated in this file even though the reference architecture later splits them.
- **Token logging:** Writes to `agent_request_log`; do not invent a second token ledger. When mapping `TokenTrackingEntry` to the DB insert, convert `success` to an integer: `success: entry.success ? 1 : 0` (the schema column is `integer`, the TS type is `boolean`). Call `Math.round()` on `estimatedCostCents` before insert (schema is `integer`; fractional values will be silently truncated by Postgres).
- **Budget checks:** Read [`getLlmBudgetConfig()`](/home/jared/Nexus-Terminal/lib/agents/llm-client.ts) defaults and fail fast before expensive downstream work. Daily budget check sums `estimated_cost_cents` in `agent_request_log` where `user_id = ?` AND `created_at >= start of current UTC calendar day`. Monthly budget check uses `created_at >= first of the current UTC calendar month`. Both checks are scoped per `userId` only, not per `userId + agentId`. Throw `BudgetExceededError` from `types.ts` on violation.
- **Rate limiting:** DB-backed, queries `agent_request_log` for the requesting user. The V1 limit is 30 requests per rolling hour (`created_at >= now() - interval '1 hour'`). Scoped per `userId` only, not per `userId + agentId`.
- **Circuit breaker:** State is DB-backed in `agent_registry.config.circuitBreaker` using the `CircuitBreakerState` type from `types.ts`, not module memory.
- Circuit-breaker policy for Sprint 2:
  - A failure is any `agent_request_log` row where `success = 0` for the given `agentId`. Consecutive means no `success = 1` row for the same `agentId` intervenes (query by `created_at DESC`).
  - Open after 5 consecutive failures.
  - Reset window is 60 seconds from `openedAt`.
  - When open, reject the work before any LLM call runs.
  - Failure counter increments must use a single UPDATE with a SQL expression (e.g., `jsonb_set` with cast increment on `agent_registry.config`), not a read-modify-write cycle in application code. This prevents lost counter increments when two workers fail concurrently.

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
  - macro summary from the latest published `agent_reports` row with `report_type = 'macro-summary'` AND `status = 'published'`, ordered by `created_at DESC LIMIT 1`. Return `null` if no row exists.
  - conversation history from `agent_conversations`
  - trade context from `trades`
- Default query scope for Sprint 2:
  - latest 20 conversation rows for `user_id + agent_id`, ordered by `created_at DESC`
  - latest 20 trades for `user_id`, ordered by `sort_key DESC`
- Empty-state behavior: when no rows exist for any source, return the corresponding empty value (`[]` for arrays, `null` for macroSummary). The runner must not crash on empty context.
- Route-level session narrowing is deferred to Sprint 3 API work. Sprint 2 context assembly should stay deterministic and library-only.

#### `lib/agents/blueprint-runner.ts`

- The runner contract is `runBlueprint(blueprint: Blueprint, job: AgentJob, config: AgentConfig, db: AgentDb, options?: { signal?: AbortSignal })`; it executes ordered steps without importing route code or service entrypoints.
- The runner fetches context once before step iteration by calling `buildContext(db, job.userId, job.agentId)` from `lib/agents/context.ts` and `getMemory(db, job.userId, job.agentId)` from `lib/agents/memory.ts`. These are not passed in via `options` — the runner owns the context fetch.
- Before executing any step, the runner calls the budget check, rate-limit check, and circuit-breaker check from `lib/agents/runtime-limits.ts`. If any check rejects, the runner fails the job without running the step.
- The runner calls `step.run(stepInput)` to execute any step type (`code` or `llm`). It constructs `StepInput` from the job, accumulated output, fetched memory, and fetched context.
- `previousOutput` is `null` for step 1 and the `StepResult.data` from the immediately preceding step thereafter. It is NOT a merged aggregate of all prior steps — each step is responsible for forwarding what downstream steps need.
- Input validation runs against `previousOutput` when `inputSchema` exists.
- Output validation runs against `result.data` when `outputSchema` exists.
- For `llm` steps with output-contract failures, the runner calls `step.run(stepInput)` a second time (repair retry). Sprint 2 enforces a hard cap of 1 repair retry per step regardless of `StepMetadata.maxRepairAttempts`. `maxRepairAttempts` is reserved for future use and must not be read by the Sprint 2 runner. Repair retries do not increment `agent_jobs.attempt`.
- Persist `step_log` after each meaningful state transition by calling `persistStepLog()` from `lib/agents/queue.ts` (which fences on `id + locked_by + lease_version`). The runner does not write to `agent_jobs` directly. The allowed persisted fields are: `step`, `status`, `startedAt`, `completedAt`, `attempt`, `validatorResult`, `tokensUsed`, and `errorClass`. Token usage is read from `StepResult.metrics.tokensUsed`.
- The "prompt loading" half of story AEV2-305 is deferred to AEV2-308. Sprint 2 runner work must not require a new prompt loader or agent-config registry. Use the existing `Blueprint` / `AgentConfig` contracts from [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts); broader wiring belongs to later stories.

#### `lib/agents/checkpoints.ts`

The blueprint runner imports and calls `saveCheckpoint()` and `loadCheckpoint()` directly. The checkpoint module has no dependency on the runner.

- Checkpoints store normalized accumulated output only in `agent_job_checkpoints.checkpoint_json`.
- Resume semantics are:
  - load the latest completed checkpoint for the job: `ORDER BY step_index DESC LIMIT 1`
  - restore `previousOutput` from that checkpoint's `checkpoint_json`
  - restart at `checkpoint.step_index + 1`, not step 1
- Retry/resume must preserve the no-replay rule for prior successful side effects. Before executing any step where `metadata.sideEffect = true` and `metadata.idempotencyKey` is set, query `agent_step_effects` for that `idempotencyKey`. If a row exists, skip the step and treat it as already completed. Insert the `agent_step_effects` row after the step completes successfully but before any other downstream state mutations in the same step. This ordering guarantees that a crash-and-resume cycle finds the effect marker before re-attempting the side effect.

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

- [ ] [`lib/agents/db.ts`](/home/jared/Nexus-Terminal/lib/agents/db.ts) exists and provides `getAgentDb()` returning a WebSocket pool singleton plus `type AgentDb`.
- [ ] [`lib/agents/queue.ts`](/home/jared/Nexus-Terminal/lib/agents/queue.ts) can claim, renew, complete, fail, heartbeat, persistStepLog, and schedule retry for `agent_jobs`.
- [ ] Claim is a single `UPDATE...WHERE...RETURNING` (not SELECT then UPDATE). Order and eligibility locked to `priority DESC, created_at ASC` over queued jobs whose `next_retry_at` is null-or-due.
- [ ] Claiming a job sets a 5-minute lease, increments `lease_version`, and returns `QueueClaimResult | null`.
- [ ] Queue writes fence on `id + locked_by + lease_version`.
- [ ] Retry scheduling nulls `locked_by`, `lock_expires_at`, `last_heartbeat_at` while preserving `started_at`.
- [ ] No `lib/agents/*.ts` file imports from `@/lib/db` directly (use `lib/agents/db.ts` only).
- [ ] Focused tests cover stale-worker rejection paths, happy-path lease renewal/completion, and `next_retry_at` boundary (future vs past).

**Exit criteria**

- [ ] Docker runtime code no longer depends on `getDb()` / `getPoolDb()` as its primary DB seam.
- [ ] Stale workers cannot renew a lease or write completion/failure after ownership changes.
- [ ] `agent_jobs.step_log` remains metadata-only.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run __tests__/agent-db.test.ts __tests__/agent-queue.test.ts`

### Checkpoint 2 — Runtime Limits + Memory / Context Assembly

**Stories:** `AEV2-303`, `AEV2-304`

**Review focus:** confirm token/budget enforcement is deterministic, `agent_memory_v2` is the only memory table used, and macro context comes from `agent_reports`.

**Suggested commit:** `feat(aev2): add agent runtime limits and context helpers`

**Check off before commit**

- [ ] [`lib/agents/runtime-limits.ts`](/home/jared/Nexus-Terminal/lib/agents/runtime-limits.ts) tracks tokens, budget checks, breaker state, and rate-limit decisions. All exports accept `(db, userId, agentId)` as first params.
- [ ] Token logging converts `success` to `0 | 1` on insert and calls `Math.round()` on `estimatedCostCents`.
- [ ] Budget checks sum `estimated_cost_cents` from `agent_request_log` using UTC calendar day/month boundaries, scoped per userId only.
- [ ] Rate limit enforces 30 req/hr per userId using rolling 1-hour window.
- [ ] Circuit-breaker state uses the `CircuitBreakerState` type and writes via SQL expression (not read-modify-write).
- [ ] [`lib/agents/memory.ts`](/home/jared/Nexus-Terminal/lib/agents/memory.ts) exports `getMemory()` and `upsertMemory()`, reads and writes `agent_memory_v2` only.
- [ ] [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts) exports `buildContext()` returning `AgentContext`. Assembles memory, recent trades, conversation history, and latest macro summary.
- [ ] Context queries use the Sprint 2 default scope: latest 20 trades, latest 20 conversation rows, latest published macro summary. Returns empty values (not errors) when no rows exist.
- [ ] Focused tests cover breaker open/reset behavior, rate-limit rejection, agent-scoped memory reads, context query scoping, empty-state behavior (no memory, no macro, no trades), and macro-summary lookup without `macro_summaries`.

**Exit criteria**

- [ ] Runtime limit checks can reject work before expensive downstream steps run.
- [ ] No new code reads or writes the legacy `agent_memory` table.
- [ ] Macro summary context is sourced from `agent_reports`.
- [ ] Sprint 2 context assembly is deterministic and does not require route/session code.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run __tests__/agent-runtime-limits.test.ts __tests__/agent-memory.test.ts __tests__/agent-context.test.ts`

### Checkpoint 3 — Blueprint Runner Core

**Stories:** `AEV2-305`

**Review focus:** lock the accumulator contract before resume work lands. Every step should receive `previousOutput`, validate input/output, and persist step metadata without leaking raw artifacts.

**Suggested commit:** `feat(aev2): add agent blueprint runner`

**Check off before commit**

- [ ] [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts) executes ordered `code` and `llm` steps.
- [ ] Runner fetches context via `buildContext()` and memory via `getMemory()` once before step iteration.
- [ ] Runner calls runtime-limits checks (budget, rate, breaker) before each step.
- [ ] Input and output validation happen inside the runner, not in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts).
- [ ] `previousOutput` is the prior step's `StepResult.data` (not a merged aggregate), `null` for step 1.
- [ ] LLM output-contract failures support exactly 1 repair retry. `maxRepairAttempts` is not read.
- [ ] `step_log` is persisted via `persistStepLog()` from queue.ts — runner does not write to `agent_jobs` directly.
- [ ] Focused tests cover ordered execution, validation failure, step-log persistence, and runtime-limit rejection before step execution.

**Exit criteria**

- [ ] Blueprint execution is deterministic and does not require route-level code.
- [ ] LLM and code steps share one runner contract.
- [ ] Failure paths classify and surface step-level errors cleanly.
- [ ] The runner remains library-only and does not require new route wiring, worker wiring, or a new prompt/config registry.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run __tests__/agent-blueprint-runner.test.ts`

### Checkpoint 4 — Checkpoint / Resume Hardening

**Stories:** `AEV2-306`

**Review focus:** verify retries resume from the latest completed checkpoint instead of replaying prior side effects or restarting from step 1.

**Suggested commit:** `feat(aev2): add agent checkpoint resume support`

**Check off before commit**

- [ ] [`lib/agents/checkpoints.ts`](/home/jared/Nexus-Terminal/lib/agents/checkpoints.ts) can save and load the latest normalized checkpoint payload for a job (`ORDER BY step_index DESC LIMIT 1`).
- [ ] The runner can resume from the failed step using `agent_job_checkpoints`.
- [ ] Retry/resume paths preserve the same idempotency assumptions established earlier in the sprint.
- [ ] Side-effecting steps check `agent_step_effects` for existing `idempotencyKey` BEFORE execution (skip if exists). Effect row is inserted AFTER step success but BEFORE any downstream mutations.
- [ ] Focused tests cover simulated mid-blueprint failure, resume from the correct step, and side-effect skip on retry.

**Exit criteria**

- [ ] Resume starts from the latest completed checkpoint, not step 1.
- [ ] Prior successful side effects are not replayed during retry.
- [ ] Checkpoint payloads store normalized accumulated output only.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run __tests__/agent-checkpoints.test.ts __tests__/agent-blueprint-runner.test.ts`

### Sprint 2 Exit Gate

- [ ] `AEV2-301` through `AEV2-306` landed in the order above.
- [ ] `CircuitBreakerState` and `QueueClaimResult` types added to `lib/agents/types.ts`.
- [ ] Focused tests cover lease fencing, runtime limits, memory/context assembly, blueprint execution, and checkpoint resume.
- [ ] No Sprint 2 code depends on `/api/agents/*`, Discord delivery, or service package wiring.
- [ ] No Sprint 2 code imports or references the legacy `agent_memory` table (grep for `agentMemory` and `agent_memory` excluding `_v2`).
- [ ] No `lib/agents/*.ts` file imports from `@/lib/db` directly.
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] [`HANDOFF.md`](/home/jared/Nexus-Terminal/HANDOFF.md) updated after the final checkpoint closes.

### Complexity

- Overall complexity: `L`
- Highest-risk checkpoint: Checkpoint 1, because lease fencing is the core correctness boundary for every later runtime path.
