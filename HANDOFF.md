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

These rules are part of the Sprint 2 implementation contract. Another execution agent should be able to build the runtime from this section plus the live repo without consulting `AGENTIC_EXPANSIONV2.md`.

#### `lib/agents/db.ts`

- Export `getAgentDb()` as the Docker/runtime DB seam. It should mirror the pooled WebSocket Drizzle shape used by [`lib/db.ts`](/home/jared/Nexus-Terminal/lib/db.ts) without importing `getDb()` or `getPoolDb()`.
- Import schema directly from [`lib/db/schema.ts`](/home/jared/Nexus-Terminal/lib/db/schema.ts) and expose additive agent-DB type aliases from this file so the rest of Sprint 2 depends on one runtime seam.
- Return `null` when `DATABASE_URL` is missing, matching the repo's existing DB-helper pattern.

#### `lib/agents/queue.ts`

- Claim exactly one eligible queued job for a target `agent_id`, ordered by `priority DESC, created_at ASC`.
- A job is eligible to claim only when `status = 'queued'` and `next_retry_at IS NULL OR next_retry_at <= now()`.
- Claim semantics must atomically set:
  - `status = 'processing'`
  - `started_at = now()`
  - `attempt = attempt + 1`
  - `locked_by = worker identity`
  - `lock_expires_at = now() + interval '5 minutes'`
  - `last_heartbeat_at = now()`
  - `lease_version = lease_version + 1`
- Renew, complete, fail, heartbeat, and retry-scheduling writes must all match on `id + locked_by + lease_version`.
- `schedule retry` means: leave the existing job row in place, clear lease ownership fields, preserve prior `step_log`, set `status = 'queued'`, and move the retry delay into `next_retry_at`.
- Stale-job reaper wiring remains out of scope for Sprint 2, but the queue helpers must be written so Sprint 3 can call them without changing lease semantics.

#### `lib/agents/runtime-limits.ts`

- Keep Sprint 2 runtime limits consolidated in this file even though the reference architecture later splits them.
- Budget checks must read [`getLlmBudgetConfig()`](/home/jared/Nexus-Terminal/lib/agents/llm-client.ts) defaults and fail fast before expensive downstream work.
- Token logging writes to `agent_request_log`; do not invent a second token ledger.
- Rate limiting is DB-backed and queries `agent_request_log` for the requesting user. The V1 limit is 30 requests per rolling hour.
- Circuit-breaker state is DB-backed in `agent_registry.config.circuitBreaker`, not module memory.
- Circuit-breaker policy for Sprint 2:
  - open after 5 consecutive failures
  - reset window is 60 seconds
  - when open, reject the work before any LLM call runs

#### `lib/agents/memory.ts`

- All reads and writes use [`agent_memory_v2`](/home/jared/Nexus-Terminal/lib/db/schema.ts) only.
- Memory helpers must always scope by both `user_id` and `agent_id`.
- Upserts must honor the live unique key on `(user_id, agent_id, category, key)`.

#### `lib/agents/context.ts`

- Build context from live repo tables only:
  - memory from `agent_memory_v2`
  - macro summary from the latest published `agent_reports` row with `report_type = 'macro-summary'`
  - conversation history from `agent_conversations`
  - trade context from `trades`
- Default query scope for Sprint 2:
  - latest 20 conversation rows for `user_id + agent_id`, ordered by `created_at DESC`
  - latest 20 trades for `user_id`, ordered by `sort_key DESC`
- Route-level session narrowing is deferred to Sprint 3 API work. Sprint 2 context assembly should stay deterministic and library-only.

#### `lib/agents/blueprint-runner.ts`

- The runner contract is `runBlueprint(blueprint, job, config, db, options?)`; it executes ordered steps without importing route code or service entrypoints.
- `previousOutput` is `null` for step 1 and the full accumulated normalized output thereafter.
- The accumulator contract is mandatory: each later step receives the full prior payload through `previousOutput`.
- Input validation runs against `previousOutput` when `inputSchema` exists.
- Output validation runs against `result.data` when `outputSchema` exists.
- For `llm` steps, one repair retry is allowed only for output-contract failures and only within the step's configured repair-attempt budget. Repair retries do not increment `agent_jobs.attempt`.
- Persist `step_log` after each meaningful state transition using metadata only. The allowed persisted fields are: `step`, `status`, `startedAt`, `completedAt`, `attempt`, `validatorResult`, `tokensUsed`, and `errorClass`.
- Sprint 2 runner work must not require a new prompt loader or agent-config registry. Use the existing `Blueprint` / `AgentConfig` contracts from [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts); broader wiring belongs to later stories.

#### `lib/agents/checkpoints.ts`

- Checkpoints store normalized accumulated output only in `agent_job_checkpoints.checkpoint_json`.
- Resume semantics are:
  - load the latest completed checkpoint for the job
  - restore `previousOutput` from that checkpoint
  - restart at `checkpoint.step_index + 1`, not step 1
- Retry/resume must preserve the no-replay rule for prior successful side effects. If a completed step had a durable side effect, retries must detect that through `agent_step_effects` before re-running it.

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

- [ ] [`lib/agents/db.ts`](/home/jared/Nexus-Terminal/lib/agents/db.ts) exists and provides `getAgentDb()` plus agent DB types for runtime modules.
- [ ] [`lib/agents/queue.ts`](/home/jared/Nexus-Terminal/lib/agents/queue.ts) can claim, renew, complete, fail, and schedule retry for `agent_jobs`.
- [ ] Claim order and eligibility are locked to `priority DESC, created_at ASC` over queued jobs whose `next_retry_at` is null-or-due.
- [ ] Claiming a job sets a 5-minute lease and increments `lease_version`.
- [ ] Queue writes fence on `id + locked_by + lease_version`.
- [ ] Focused tests cover stale-worker rejection paths and happy-path lease renewal/completion.

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

- [ ] [`lib/agents/runtime-limits.ts`](/home/jared/Nexus-Terminal/lib/agents/runtime-limits.ts) tracks tokens, budget checks, breaker state, and rate-limit decisions.
- [ ] Runtime limits log requests in `agent_request_log`, enforce 30 requests/hour, and persist circuit-breaker state in `agent_registry.config`.
- [ ] [`lib/agents/memory.ts`](/home/jared/Nexus-Terminal/lib/agents/memory.ts) reads and writes `agent_memory_v2` only.
- [ ] [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts) assembles memory, recent trades, conversation history, and latest macro summary context.
- [ ] Context queries use the Sprint 2 default scope: latest 20 trades, latest 20 conversation rows, latest published macro summary.
- [ ] Focused tests cover breaker open/reset behavior, rate-limit rejection, agent-scoped memory reads, context query scoping, and macro-summary lookup without `macro_summaries`.

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
- [ ] Input and output validation happen inside runtime modules, not in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts).
- [ ] `previousOutput` is preserved across steps using the accumulator pattern.
- [ ] LLM output-contract failures support at most one in-step repair retry when the step metadata allows it.
- [ ] `step_log` writes status, attempt, validator result, tokens, and error class only.
- [ ] Focused tests cover ordered execution, validation failure, and step-log persistence.

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

- [ ] [`lib/agents/checkpoints.ts`](/home/jared/Nexus-Terminal/lib/agents/checkpoints.ts) can save and load the latest normalized checkpoint payload for a job.
- [ ] The runner can resume from the failed step using `agent_job_checkpoints`.
- [ ] Retry/resume paths preserve the same idempotency assumptions established earlier in the sprint.
- [ ] Durable side effects use `agent_step_effects` so completed work is not replayed during retry.
- [ ] Focused tests cover simulated mid-blueprint failure and resume from the correct step.

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
- [ ] Focused tests cover lease fencing, runtime limits, memory/context assembly, blueprint execution, and checkpoint resume.
- [ ] No Sprint 2 code depends on `/api/agents/*`, Discord delivery, or service package wiring.
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm test`
- [ ] [`HANDOFF.md`](/home/jared/Nexus-Terminal/HANDOFF.md) updated after the final checkpoint closes.

### Complexity

- Overall complexity: `L`
- Highest-risk checkpoint: Checkpoint 1, because lease fencing is the core correctness boundary for every later runtime path.
