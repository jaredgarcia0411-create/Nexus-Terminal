# Nexus Terminal - HANDOFF.md

> Updated: 2026-05-29
> Purpose: active execution context for Codex. Older implementation detail lives in git history, `specs/`, and durable docs such as `docs/repo-cleanup.md`.

Historical completed sections (Sprints 1-5, Tier 1 Cleanup, Chart Drawings, Workflow Maintenance, AskEdgar News Filter Expansion) were removed to keep this file focused. Use git history for archived implementation detail.

---

## Sprint 9 — Agent Job Lease Recovery

> Generated: 2026-05-30 | Agent: Claude (Plan)
> Status: completed 2026-05-30

(First of the remaining `docs/repo-cleanup.md` cleanup batch. Numbered 9 to continue the existing HANDOFF sprint sequence — Sprints 6/7/8 above were also cleanup findings.)

### Objective

When an agent worker dies mid-job (crash, OOM, container restart), its `agent_jobs` row is left at `status = 'processing'` with an expired `lock_expires_at`. The claim query only selects `status = 'queued'`, and every finalizer is fenced on `lock_expires_at > now()`, so that row is stuck forever — the user sees a job that never finishes (service chat shows `processing` until the Discord bot polling times out). This sprint adds a lease-recovery sweep that runs in the worker poll loop: expired `processing` jobs with attempts remaining are requeued, and exhausted ones are marked `failed`. Closes the `docs/repo-cleanup.md` "Expired Agent Job Leases Are Not Recovered" finding.

### Stories

- CLEAN-901 — Add `recoverExpiredJobs(db, agentId)` to the queue module.
- CLEAN-902 — Call recovery in the worker loop before each claim attempt.
- CLEAN-903 — Test coverage for requeue / fail-exhausted / counts.

### Current State

- `lib/agents/queue.ts` exports `claimNextQueuedJob`, `renewJobLease`, `heartbeatJob`, `completeJob`, `failJob`, `scheduleJobRetry`, `persistStepLog`, and `calculateBackoffMs`. All mutation helpers go through `processingLeaseFence(jobId, lockedBy, leaseVersion)`, which `and()`s: `eq(id)`, `eq(lockedBy)`, `eq(leaseVersion)`, `eq(status,'processing')`, and `sql\`${agentJobs.lockExpiresAt} > now()\``.
- `claimNextQueuedJob` is a single `db.execute` raw-SQL `WITH candidate … UPDATE … RETURNING …`. On claim it sets `status='processing'`, `attempt = attempt + 1`, `locked_by`, `lock_expires_at = now() + interval '5 minutes'`, `last_heartbeat_at = now()`, `lease_version = lease_version + 1`. **`attempt` is post-incremented at claim** — a job that crashed on its first run has `attempt = 1`.
- `scheduleJobRetry` (the normal requeue path) sets `status='queued'`, `nextRetryAt`, `completedAt=null`, `result=null`, `lockedBy=null`, `lockExpiresAt=null`, `lastHeartbeatAt=null`, and conditionally `errorMessage`. It does **not** touch `leaseVersion` or `startedAt` — the next claim bumps `leaseVersion`, and claim's `started_at = COALESCE(started_at, now())` preserves the original start.
- `lib/agents/worker.ts` `startWorker()` runs a `while (!shuttingDown)` loop: it `try`s `claimNextQueuedJob`, sleeps `pollIntervalMs` (default 5000ms) on null/error, else calls `processClaim`. The worker's own in-process retry guard is `if (job.attempt < job.maxAttempts)` → `scheduleJobRetry`, else `failJob`.
- `lib/db/schema.ts` `agentJobs`: relevant columns `status` (default `'queued'`), `attempt` (default 0), `maxAttempts` (default 3), `lockedBy`, `lockExpiresAt`, `lastHeartbeatAt`, `leaseVersion` (default 0). Index `idx_agent_jobs_stale` on `(status, lockExpiresAt)` **already exists** and currently has no reader — it exactly fits the recovery query. **No migration is required this sprint.**
- `app/api/agents/admin/stats/route.ts` already computes `stuckProcessing` as rows where `lockExpiresAt < now()` OR `lastHeartbeatAt` older than 10 minutes. Recovery uses the simpler authoritative signal (`lockExpiresAt < now()`); see D2.
- Each agent runs its own worker container (`services/agent-entrypoint.ts` starts one `startWorker` per `AGENT_ID`). Workers filter by `agentId`, so recovery must also filter by `agentId` (see D3).
- `__tests__/agent-queue.test.ts` exists. Its `createQueueDb` helper records a single `lastSet`/`lastWhere` and returns one shared `returningRows` for every `.returning()` call — it cannot yet distinguish two sequential update chains, so it must be extended (see CLEAN-903).

### Scope

- **In scope:** `lib/agents/queue.ts` (new `recoverExpiredJobs`), `lib/agents/worker.ts` (call it in the loop), `__tests__/agent-queue.test.ts` (extend harness + new tests).
- **Out of scope:** No schema/migration changes (`idx_agent_jobs_stale` already supports the query). No changes to `app/api/agents/service/chat/route.ts`, `services/discord-bot/index.ts`, or `app/api/agents/admin/stats/route.ts` — recovery at the queue level is the root-cause fix; consumers see `failed`/`completed`/`queued` once the row moves (all read job status as disjoint cases and none assume `processing` is terminal, so the revert-to-`queued` transition is safe). Admin stats' `stuckProcessing` is left as-is on purpose: it counts `lockExpiresAt < now()` OR `lastHeartbeatAt` >10min stale, but heartbeats push `lockExpiresAt` forward in lockstep, so the lock expires (and recovery fires) *before* the 10-min heartbeat signal — the count self-clears once recovery runs. No new env vars, cron, or routes. Do not change `processingLeaseFence` or any existing helper's behavior.

### Decisions Locked For Sprint 9

These remove ambiguity before Codex starts. If any is wrong, update this section before execution.

- **D1. Recovery is a non-fenced, condition-based bulk update — two separate Drizzle updates, FAIL first then REQUEUE.** The whole point is that the lease is expired and no live worker owns it, so `processingLeaseFence` cannot be used. Both updates are guarded by `eq(agentJobs.status, 'processing')` AND `sql\`${agentJobs.lockExpiresAt} < now()\`` so only genuinely-expired rows are touched — a live job (`lockExpiresAt > now()`) is never affected. The two updates target disjoint sets (`attempt >= maxAttempts` vs `attempt < maxAttempts`), so order is correctness-neutral; do FAIL first for readability. Two separate `db.update(...)` calls (not one raw SQL) keep it readable and testable.
- **D2. Recovery condition is `status = 'processing' AND lockExpiresAt < now()`** — do not also key off `lastHeartbeatAt`. `lockExpiresAt` is the authoritative lease signal: claim sets it to `now()+5min` and every heartbeat/renew pushes it forward, so a processing row always has a non-null `lockExpiresAt`, and it crosses `now()` within ~5 min of a worker dying. This is the same primary signal admin stats uses, and it matches the existing index. Accepted consequence: recovery latency is up to ~5 minutes after a crash, which is fine for this app. **Invariant relied on:** `status='processing' ⇒ lockExpiresAt IS NOT NULL`, enforced by `claimNextQueuedJob` (which sets both atomically). A processing row with a null lock would never match `lockExpiresAt < now()` (SQL NULL comparison is false) and would stay stuck — but no code path produces one, so this is safe without a schema change. (Adding `.notNull()` to the column to make the invariant explicit is a possible later follow-up, out of scope here.)
- **D3. Recovery filters by `agentId`** (passed from the worker's `config.agentId`), mirroring the per-agent worker model. A live worker recovers expired jobs left by dead siblings of the **same** agent. Known limitation (acceptable, do not solve now): if an agent has no running worker at all, its stuck jobs are not recovered until that agent's container comes back — but with no worker there is also nothing consuming that agent's queue, so nothing is lost.
- **D4. Requeue makes the job immediately eligible: set `nextRetryAt = null`** (claim treats null as eligible). No backoff is applied on recovery. A crash-looping "poison" job is already bounded by `maxAttempts` (default 3) plus the seconds a container takes to restart, so a flat immediate requeue cannot hot-loop unboundedly, and this avoids duplicating `calculateBackoffMs` into SQL (drift risk). The normal in-process retry path keeps its real backoff.
- **D5. Requeue mirrors `scheduleJobRetry`'s field clearing and does NOT bump `leaseVersion`.** Set `status='queued'`, `nextRetryAt=null`, `completedAt=null`, `result=null`, `lockedBy=null`, `lockExpiresAt=null`, `lastHeartbeatAt=null`. Leave `leaseVersion`, `startedAt`, `stepLog`, `errorMessage`, and `attempt` untouched (the next claim bumps `leaseVersion` and increments `attempt`). Do **not** set an errorMessage on requeue. **Zombie-worker safety:** a stalled-but-alive original worker that wakes up and tries to finalize is blocked on two independent fence conditions — while the row is `queued` it fails the `status='processing'` check, and once a new worker reclaims it the bumped `leaseVersion` (and changed `lockedBy`) is the *primary* fence; the cleared `lockExpiresAt` is a secondary guard. So no zombie write can corrupt the row in either window.
- **D6. Fail-exhausted sets the same fields `failJob` sets, minus the fence.** `status='failed'`, `errorMessage = 'Job lease expired; worker did not finish (max attempts reached)'`, `completedAt = sql\`now()\``, `lockedBy=null`, `lockExpiresAt=null`, `lastHeartbeatAt=null`, `nextRetryAt=null`. Do not overwrite `result`.
- **D7. `recoverExpiredJobs` returns `{ requeued: number; failed: number }`** derived from each update's `.returning({ id: agentJobs.id })` row count. The worker logs only when `requeued > 0 || failed > 0`.
- **D8. Recovery runs before each claim, inside the loop, wrapped in its own try/catch.** A recovery failure logs `console.error` and falls through to the claim — it must never break the poll loop. Use `console.warn` for a successful non-empty recovery.

### Planned File Actions

**Modified files:**

- `lib/agents/queue.ts` — Add and export:
  ```ts
  export async function recoverExpiredJobs(
    db: AgentDb,
    agentId: AgentId,
  ): Promise<{ requeued: number; failed: number }> {
    // FAIL exhausted expired-lease jobs first (D1, D6).
    const failedRows = await db.update(agentJobs)
      .set({
        status: 'failed',
        errorMessage: 'Job lease expired; worker did not finish (max attempts reached)',
        completedAt: sql`now()`,
        lockedBy: null,
        lockExpiresAt: null,
        lastHeartbeatAt: null,
        nextRetryAt: null,
      })
      .where(and(
        eq(agentJobs.agentId, agentId),
        eq(agentJobs.status, 'processing'),
        sql`${agentJobs.lockExpiresAt} < now()`,
        sql`${agentJobs.attempt} >= ${agentJobs.maxAttempts}`,
      ))
      .returning({ id: agentJobs.id });

    // REQUEUE expired-lease jobs that still have attempts left (D4, D5).
    const requeuedRows = await db.update(agentJobs)
      .set({
        status: 'queued',
        nextRetryAt: null,
        completedAt: null,
        result: null,
        lockedBy: null,
        lockExpiresAt: null,
        lastHeartbeatAt: null,
      })
      .where(and(
        eq(agentJobs.agentId, agentId),
        eq(agentJobs.status, 'processing'),
        sql`${agentJobs.lockExpiresAt} < now()`,
        sql`${agentJobs.attempt} < ${agentJobs.maxAttempts}`,
      ))
      .returning({ id: agentJobs.id });

    return { requeued: requeuedRows.length, failed: failedRows.length };
  }
  ```
  `and`, `eq`, `sql`, and `agentJobs` are already imported at the top of the file; `AgentId` is already imported from `./types`. Add no new imports.

- `lib/agents/worker.ts` — Import `recoverExpiredJobs` in the existing `from './queue'` import block. In `startWorker`'s `while (!shuttingDown)` loop, **before** the `let claim` / `try { claim = await claimNextQueuedJob(...) }` block, insert:
  ```ts
  try {
    const recovered = await recoverExpiredJobs(db, config.agentId);
    if (recovered.requeued > 0 || recovered.failed > 0) {
      console.warn(`agent worker recovered expired jobs for ${config.agentId}`, recovered);
    }
  } catch (error) {
    console.error(`agent worker recovery failed for ${config.agentId}`, error);
  }
  ```

- `__tests__/agent-queue.test.ts` — Extend `createQueueDb` so two sequential update chains can be inspected independently, then add recovery tests:
  - Add a `setCalls: Record<string, unknown>[]` array to `_state`; have the `set` mock push each value (keep `lastSet` for existing tests).
  - Accept an optional `returningResults?: Array<Array<{ id: string }>>` param; the `returning` mock returns `returningResults.shift()` when the array is non-empty, otherwise falls back to `returningRows`. (Existing single-chain tests keep passing because they don't pass `returningResults`.)
  - Import `recoverExpiredJobs` from `@/lib/agents/queue`.
  - Tests to add:
    1. Requeue + fail counts: `returningResults: [[{id:'a'}], [{id:'b'},{id:'c'}]]` → expect `{ requeued: 2, failed: 1 }`; assert `setCalls[0]` is the FAIL payload (`status:'failed'`, the D6 errorMessage) and `setCalls[1]` is the REQUEUE payload (`status:'queued'`, `nextRetryAt:null`) and that `setCalls[1]` has **no** `leaseVersion` and **no** `errorMessage` key.
    2. Both empty: `returningResults: [[], []]` → `{ requeued: 0, failed: 0 }`.
    3. Source-string guard (matches the file's existing `queueSource` assertion style). Because the mocked db cannot evaluate the SQL `WHERE`, this guard is the only thing protecting the filter conditions from accidental deletion — assert `queueSource` contains all of: the expiry guard `${agentJobs.lockExpiresAt} < now()`, the agent filter `eq(agentJobs.agentId, agentId)`, and **both** attempt branches `${agentJobs.attempt} >= ${agentJobs.maxAttempts}` (fail) and `${agentJobs.attempt} < ${agentJobs.maxAttempts}` (requeue).

### Acceptance Criteria

- [x] `recoverExpiredJobs(db, agentId)` exists and is exported from `lib/agents/queue.ts`, returning `{ requeued, failed }`.
- [x] Both recovery updates filter on `agentId`, `status='processing'`, and `lockExpiresAt < now()`; FAIL targets `attempt >= maxAttempts`, REQUEUE targets `attempt < maxAttempts`.
- [x] Requeue clears lock fields and sets `status='queued'`, `nextRetryAt=null`, without touching `leaseVersion`, `startedAt`, `attempt`, or `errorMessage`.
- [x] Fail-exhausted sets `status='failed'` with the D6 errorMessage and does not overwrite `result`.
- [x] The worker loop calls `recoverExpiredJobs` before each claim, logs only on non-empty recovery, and a thrown recovery error is caught and does not break the loop.
- [x] No schema migration, no new env var, no consumer-route changes.
- [x] New tests cover requeue/fail counts, the empty case, and the field payloads; existing queue tests still pass unchanged.

### Validation

Run before marking COMPLETE:
- `npm run lint` — passed 2026-05-30
- `npx tsc --noEmit` — passed 2026-05-30
- `npm run typecheck:services` (worker.ts is consumed by `services/agent-entrypoint.ts`) — passed 2026-05-30
- `npm test` — passed 2026-05-30 (98 files, 707 tests)
- Manual (optional, post-deploy): kill an agent container mid-job; confirm within ~5 min the row moves off `processing` (requeued and reprocessed, or `failed` if attempts exhausted) instead of hanging. PENDING user/post-deploy verification.

---

## Recently Completed

### Sprint 8 — Research TLDR Paid-Work Claim + Usage Telemetry

Status: completed 2026-05-29 (commit 458a0a9).

Outcome:
- New `research_tldr_claims` table (ticker PK + `claimed_at`) + migration `0044_optimal_mysterio.sql`. `getCachedResearchTldr(ticker, userId)` now claims per-ticker on a cold miss; concurrent losers poll (8×1500ms) and reuse the winner's cached row instead of double-spending, then generate themselves only if the winner stalls. Stale claims (>90s) cleared at claim time.
- `lib/llm-client.ts` `callLlm` surfaces `usage: { inputTokens, outputTokens }` (defaults 0). TLDR generation now logs tokens/cost/duration to `agent_request_log` via new telemetry-only `recordSiteLlmUsage` (`mode:'site-research-tldr'`) — deliberately NOT `recordLlmAttempt`, so it never mutates the small-cap-trader circuit breaker. Route adds `ensureUser` + threads the user id; response shape unchanged. Closes the `docs/repo-cleanup.md` "Research TLDR Needs A Paid-Work Claim And Unified Telemetry" finding.
- Beneficial drift from spec: a non-unique-violation claim-insert error is logged and swallowed (proceed as owner, skip release) rather than rethrown — better satisfies "claim writes never block the TLDR" than the literal spec, which would have 500'd.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (98 files, 704 tests) all passed; `npm run db:migrate` applied `0044` cleanly.
- Tests cover usage parse/default-zero, `recordSiteLlmUsage` insert with `db.execute` never called (no-breaker proof), and cache-hit / cold-owner (2 deletes) / failed-telemetry / loser-poll (fake timers, no LLM call) paths.
- Manual browser smoke (one generation for a cold ticker opened twice; `agent_request_log` row for `mode='site-research-tldr'` with non-zero tokens): PENDING user verification.

### Sprint 7 — Slim GET /api/trades Payload (Lazy-Load Executions)

Status: completed 2026-05-29 (commit 757cd32).

Outcome:
- `GET /api/trades` no longer joins `tradeExecutions` — returns one summary row per trade (tags intact, `rawExecutions: []`), so the bulk list loads lighter; `POST` unchanged. Closes the `docs/repo-cleanup.md` "Unbounded GET /api/trades" finding (slim-payload scope; true pagination deferred).
- New `hooks/use-trade-executions.ts`: `useTradeExecutions(id, seeded)` lazy-loads a single trade's executions via `/api/trades/[id]` with a shared module cache + promise-based in-flight dedup; `prefetchTradeExecutions(ids)` warms the same cache. `JournalTradeChart` uses it so replay charts keep per-fill markers; both review sheets prefetch before the auto-print timer so exported PDFs keep per-fill markers.
- Also closed the "Missing GET Test For Trades Route" gap.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (96 files, 696 tests) all passed.
- New GET test asserts `select` ran exactly once (proves the executions query is gone); new hook test covers seeded/seed-transition/lazy-fetch/cache/prefetch.
- Manual browser smoke (Journal + daily/weekly replay markers, detail sheet, multi-fill review PDF export, list load speed): PENDING user verification.

### Sprint 6 — Rate Limiting On Expensive Endpoints

Status: completed 2026-05-29 (commit 644dc24).

Outcome:
- New `rate_limits` table (text PK `${userId}:${endpoint}:${windowStartMs}`, FK cascade, lookup index) + migration `drizzle/0043_fat_timeslip.sql`.
- Shared `lib/rate-limit.ts`: atomic fixed-window (UTC clock-hour) upsert counter + 429 builder with `Retry-After` / `X-RateLimit-*` headers. Caps: research-report 20/hr, askedgar-tldr 30/hr.
- Wired into `POST /api/research-report` and `POST /api/askedgar/tldr` (added a `getDb` guard + one-try/catch restructure to the tldr route).

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (95 files, 688 tests) all passed; `npm run db:migrate` applied cleanly.
- Manual post-deploy 429-header smoke: PENDING user verification.

### Multi-Day Trade Replay Charts

Status: completed 2026-05-28 (commit a625032).

Outcome:
- Closed trades spanning >1 day now widen the candle window entry-day→exit-day, place `EXIT` markers on the exit day, and show a date range in the detail-sheet and Journal labels. Open/same-day trades are unchanged.
- Behind an optional `endSortKey` param on `buildTradeChartOptions`; `ResearchChart`/`WatchlistTickerChart` (2-arg callers) untouched. Detection reuses `isCrossDayTrade`/`bucketKey`.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (94 files, 681 tests) all passed.
- Codex added `__tests__/ui-trade-utils.test.ts` (3 marker tests) beyond the spec.
- Manual browser smoke (same-day unchanged, multi-day span, ResearchChart unaffected): PENDING user verification.

### CSV Parser: Position-Aware B Resolution

Status: completed 2026-05-28 (commit 5ea235b).

Outcome:
- Lifted DAS Trader's chronological position-resolver into shared `resolveSidesByPositionState` helper in `lib/parsers/utils.ts`.
- `defaultParser` now runs the resolver in `buildContext`, disambiguating raw `B` to `MARGIN` (long open) when no open short exists, or `B` (cover) when one does.
- Deleted `builtinNormalizeRow`; both `processCsvData` and `extractRawExecutions` default to `defaultParser`. Removed `parser.id === 'default'` bypass in `lib/trade-utils.ts`.

Validation:
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm test` passed (92 files, 671 tests).
- Manual browser smoke with coworker's 2026-05-28 CSV: PENDING — confirm ASTC/ATPC LONG trades appear, NCT/SPRC SHORT remain correct, ARM shows as open long.

### Cover/Close Entry Flow — Manual Entry (FIFO) + Import Side Resolution

Status: completed 2026-05-28 (commit c846e4a).

Outcome:
- Part A: manual New Trade form now detects an offsetting open position (same symbol, opposite direction) and prompts to close it FIFO instead of creating a new opposite open trade. New `lib/cover-position.ts` (pure FIFO math) + `app/api/trades/cover/route.ts` handle full close / partial / flip; `useTrades.handleCoverPosition` merges affected rows by id.
- Part B: import (raw CSV) path seeds `resolveSidesByPositionState` with the client's currently-open positions so a later-day `B` covering a carried-over short labels as a cover, not a new long. Threaded through `extractRawExecutions` → `collectRawExecutions` → `processImportFiles`.
- Known limits (intentional): multi-day folder import in one action won't link an open+cover across batches; same-symbol intraday round-trip while holding a carried-over position can mislabel. Supported workflow documented for coworkers.

Validation:
- `npm run lint`, `npx tsc --noEmit`, `npm test` (93 files, 677 tests) all passed.
- Manual browser smoke (Part A confirm/partial/flip/decline, Part B import seeding): PENDING user verification.

---

## Session Maintenance

- Keep this file compact: active specs only while work is in flight, short summaries after validation.
- If a new multi-step feature starts, replace or append a self-contained execution spec with exact file paths, ordered changes, acceptance criteria, and validation requirements.
- If only docs/workflow assets change, run `npm run workflow:audit`.
- Do not modify `.env*` or secret files.
