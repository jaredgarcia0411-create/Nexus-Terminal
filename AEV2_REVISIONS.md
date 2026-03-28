# AEV2_REVISIONS.md — Redline Checklist for `AGENTIC_EXPANSION_V2.md`

> Generated: 2026-03-28 | Status: REVIEW — apply these revisions before turning AEV2 into the implementation springboard

---

## 1. Review Summary

### Overall verdict

`AGENTIC_EXPANSION_V2.md` is strong at the vision/system-design level, but it is **not springboard-ready yet**.

The biggest remaining cracks are in:

1. **cutover mechanics**
2. **job durability / retry semantics**
3. **Discord/runtime integration**
4. **repo-specific migration details**
5. **frontend/API contract completeness**

If those are tightened now, implementation risk drops a lot.

### Review method

This review used three parallel sub-reviews focused on:

- **Schema / migrations / DB compatibility**
- **Runtime / Docker / queue / cron / Discord ops**
- **API / frontend / auth / UX compatibility**

The findings below synthesize those reviews into one redline checklist plus reasoning.

---

## 2. Redline Checklist

Use this as the patch list for the next AEV2 revision.

### A. Must-fix before implementation

- [ ] **Renumber the migration plan.**
  - AEV2 still refers to migrations `0011` and `0012`, but the repo already has migrations through `0016`.
  - Update all references to use the next real migration numbers.

- [ ] **Replace the current `agent_memory` cutover plan with a real zero-break or maintenance-window plan.**
  - Old Jarvis code currently writes against the existing unique key `(user_id, category, key)`.
  - AEV2 changes it to `(user_id, agent_id, category, key)`.
  - “Same deploy” is not truly atomic across Vercel + Docker workers.
  - Add either:
    - a maintenance window with old writers fully disabled before the constraint swap, or
    - a shadow/swap migration strategy.

- [ ] **Write exact historical backfill mappings.**
  - Explicitly specify:
    - `jarvis_conversations -> agent_conversations`
      - `agent_id = 'orchestrator'`
      - `channel = 'web'`
    - `jarvis_request_log -> agent_request_log`
      - `agent_id = 'orchestrator'`
      - `lane = 'background'`
      - `estimated_cost_cents = 0` for historical rows
    - `agent_memory`
      - backfill directly to `agent_id = 'orchestrator'`
      - do **not** use temporary `'jarvis'` if the system is converging on strict agent IDs

- [ ] **Choose one report publish ownership model and remove the other.**
  - AEV2 currently says both:
    - specialists publish directly in `assemble-report`, and
    - Orchestrator receives completions and publishes
  - Pick one. For V1, the simplest path is: **specialists publish directly** unless cross-agent synthesis is required.

- [ ] **Add durable queue lease fields to `agent_jobs`.**
  - Add fields such as:
    - `locked_by`
    - `lock_expires_at`
    - `last_heartbeat_at`
  - Workers should renew the lease during long-running steps.
  - The stale-job reaper should only requeue jobs with expired leases, not anything older than 5 minutes.

- [ ] **Add real idempotency storage for side effects.**
  - `StepMetadata.idempotencyKey` is not enough by itself.
  - Add a durable DB-backed mechanism, e.g.:
    - `agent_step_effects` table, or
    - a delivery outbox table
  - Required for safe retries and to prevent duplicate Discord posts.

- [ ] **Add a durable scheduled-run model for cron/catch-up jobs.**
  - Current spec relies on “has today’s output been generated?” but does not define a durable source of truth.
  - Add a table like `agent_scheduled_runs` with a unique key on `(agent_id, trigger_type, trading_date)`.
  - Use it for:
    - dedupe
    - catch-up logic
    - observability
    - replay/debugging

- [ ] **Fix the market-status gating rules.**
  - Pre-market scans should not use “if market is closed, skip.”
  - Replace with trading-day/session-aware logic:
    - valid trading day?
    - pre-market window?
    - post-market window?
    - holiday/weekend skip?

- [ ] **Add `discord_user_links` to the schema plan or explicitly defer Discord identity mapping.**
  - AEV2 depends on Discord user -> Nexus user resolution.
  - That table is not in the current schema plan.
  - “No schema changes required” is not true as written.

- [ ] **Keep the Discord bot in the runtime topology if `#orchestrator` is V1.**
  - Current repo `services/docker-compose.yml` already has `discord-bot`.
  - AEV2’s compose rewrite removes it while still requiring bidirectional Discord chat.
  - Add explicit runtime ownership for the bot service.

- [ ] **Fix the container runtime story.**
  - The proposed Dockerfile runs `npx tsx`, but `tsx` is not currently in `package.json`.
  - Add a decision:
    - either include `tsx`, or
    - compile the agent code and run built JS.

- [ ] **Define admin observability using DB-backed truth only, or persist breaker state.**
  - AEV2 promises circuit breaker status in `/api/agents/admin/stats`.
  - But circuit breakers are described as in-memory per worker, which Vercel routes cannot inspect.
  - Either persist state or reduce the endpoint to data that is actually observable from DB rows.

### B. High-priority spec additions

- [ ] **Add foreign keys for `agent_id` references.**
  - `agent_jobs.agent_id -> agent_registry.id`
  - `agent_reports.agent_id -> agent_registry.id`
  - `agent_conversations.agent_id -> agent_registry.id`
  - `agent_request_log.agent_id -> agent_registry.id`
  - `agent_memory.agent_id -> agent_registry.id`
  - `agent_reports.job_id -> agent_jobs.id` (`ON DELETE SET NULL` is probably the right behavior)

- [ ] **Add DB-level checks/enums for text state fields.**
  - `status`
  - `lane`
  - `role`
  - `channel`
  - `confidence`
  - This prevents silent invalid values from breaking routing or reporting.

- [ ] **Tighten queue indexes to match actual poll queries.**
  - Add a more queue-specific ready-job index / partial index rather than relying only on the current broad index proposal.

- [ ] **Add uniqueness / indexing for report delivery safety.**
  - If one report should map to one job, add at least an index on `agent_reports.job_id` and likely a uniqueness rule.

- [ ] **Define the bot-to-app auth contract.**
  - Reuse one clear service auth pattern.
  - Do not leave Discord bot -> Next.js API auth implicit.

- [ ] **Add explicit offline-agent behavior to the API contract.**
  - If a target agent is offline/degraded, define whether the API:
    - returns `503`,
    - reroutes to Orchestrator, or
    - rejects immediately with a typed error.

- [ ] **Decide whether V1 supports multi-agent fanout.**
  - Current public route contract looks single-job / single-result.
  - Current routing narrative allows split sub-jobs.
  - Pick one:
    - **V1 single-agent only** (recommended), or
    - add parent/child jobs + aggregation rules now.

- [ ] **Replace in-memory rate limiting anywhere it touches Vercel routes.**
  - Repo guidance already says in-memory state is unreliable on Vercel.
  - If rate limiting only applies in Docker workers, say that explicitly.

### C. Frontend / API completeness fixes

- [ ] **Expand the frontend migration inventory beyond `Sidebar.tsx`.**
  - The current `jarvis` tab is also wired in:
    - `app/page.tsx`
    - `components/trading/CommandPalette.tsx`
    - `hooks/use-global-shortcuts.ts`
    - `components/trading/MarketsTab.tsx`
  - Add these files to the migration plan.

- [ ] **Add a shared extraction step before deleting `lib/jarvis/`.**
  - The repo still uses Jarvis modules outside Jarvis chat.
  - Example: `MarketsTab.tsx` imports `@/lib/jarvis/types` and fetches `/api/jarvis/macro-summary/latest`.
  - Move shared report types/helpers to a neutral module first.

- [ ] **Expand `/api/agents/chat` contract.**
  - `POST` should return at least:
    - `job_id`
    - `session_id`
    - `agent_id`
  - `GET` should return at least:
    - `status`
    - `agent_id`
    - `progress_note`
    - `result?`
    - `error?`

- [ ] **Add mandatory ownership checks on all user-facing read routes.**
  - `GET /api/agents/chat?job_id=...`
  - `GET /api/agents/reports`
  - `GET /api/agents/reports/[id]`
  - All must scope by authenticated `user_id`.

- [ ] **Add explicit route-convention language for all `/api/agents/*` routes.**
  - Use:
    - `requireUser()` for normal routes
    - `ensureUser()` where needed
    - `getDb()` / `dbUnavailable()`
    - `parseAndValidate()` with Zod schemas
  - Add this to the spec so implementation matches the existing app.

- [ ] **Clarify `/api/agents/research` and `/api/agents/trade-analysis` vs chat commands.**
  - Right now they overlap with slash-command routing.
  - Define whether they are:
    - first-class programmatic endpoints, or
    - convenience wrappers, or
    - out of scope for V1.

- [ ] **Define selector-vs-command precedence in the UI.**
  - If a user selects “Swing Trader” but types `/research`, which wins?
  - Add a simple deterministic rule.

### D. Lower-risk but worthwhile cleanups

- [ ] **Clarify Compose memory-limit expectations.**
  - `deploy.resources` is not reliably enforced in normal `docker compose` mode.
  - Either use settings that actually apply in your environment or remove the overly-confident memory guarantees from the doc.

- [ ] **Reduce hot-row bloat on `agent_jobs`.**
  - `step_log` JSONB on the job row is okay early, but large step artifacts do not belong on the hot queue row.
  - Add guidance that artifacts/raw payloads should stay out of the queue table or move to a child table if needed.

- [ ] **Add a delivery recovery / replay section.**
  - What happens to `delivery_failed` reports?
  - Can they be retried without re-running analysis?
  - Who/what triggers redelivery?

---

## 3. Detailed Review / Reasoning

## 3.1 Schema and migration reasoning

### Critical cracks

1. **Migration numbering is stale.**
   - The repo already contains migrations through `0016`.
   - Reusing `0011` / `0012` would break ordering and snapshots.

2. **`agent_memory` cutover is not safe as written.**
   - Existing Jarvis writers target the old uniqueness model.
   - Changing the unique key before fully removing old code creates immediate compatibility risk.

3. **Historical data copy rules are incomplete.**
   - New tables require fields like `agent_id` and `channel` that old rows do not have.
   - The mapping must be explicitly written, not implied.

4. **Discord schema statement is internally inconsistent.**
   - AEV2 says `agent_conversations.channel` already supports Discord, but that table does not exist yet in the current schema.
   - Current `jarvis_conversations` uses `mode`, not `channel`.

5. **Temporary `'jarvis'` agent IDs create future integrity problems.**
   - If `agent_id` becomes a proper FK, `'jarvis'` is an invalid long-term value.

### Medium-risk gaps

- Most `agent_id` references are described as soft FKs, which is weak for a queue-driven system.
- Queue indexing is not yet tailored tightly enough to the actual polling query.
- `discord_user_links` is referenced but not planned.
- Status/enum-like text fields need DB checks.
- Report/job relationships need better uniqueness/indexing.

---

## 3.2 Runtime / queue / Docker / Discord reasoning

### Critical cracks

1. **Dockerfile is not runnable as written.**
   - It uses `npx tsx` after `npm ci --production`, but `tsx` is not currently installed.

2. **Retry/recovery semantics are unsafe.**
   - Without leases, the stale-job reaper can create duplicate processing.

3. **Idempotency is specified but not enforced.**
   - A string key in step metadata is not a durable dedupe mechanism.

4. **Publish flow is contradictory.**
   - The spec currently gives publish ownership to both specialists and Orchestrator.

5. **Catch-up logic has no durable run identity.**
   - “Did today’s output happen?” needs a dedicated record, not an inferred answer.

6. **Market-status gate is wrong for pre-market jobs.**
   - Pre-market scans happen when the market is closed.

7. **Discord bot runtime is unresolved.**
   - Current compose file includes `discord-bot`; the AEV2 rewrite drops it despite V1 still depending on it.

8. **Admin stats overreach current observability reality.**
   - Vercel can query DB state, not worker memory.

### Operational risks

- Laptop/server fragility makes durable scheduling even more important.
- A 5-minute generic stale-job timeout is too blunt.
- Polling from both web and Discord is fine, but only if queue semantics are clean.
- `step_log` on the job row can become a performance drag if overloaded.

---

## 3.3 API / frontend / auth reasoning

### Critical cracks

1. **Frontend migration scope is understated.**
   - The `jarvis` tab is wired in several places beyond the sidebar.

2. **Deleting `lib/jarvis/` too early will break non-Agent screens.**
   - Some current UI paths still depend on Jarvis types/routes.

3. **Macro summary consumer still points at `/api/jarvis/macro-summary/latest`.**
   - That must be migrated before cleanup.

4. **Polling read routes need explicit ownership checks.**
   - `job_id` lookup without `user_id` scoping is a security hole.

5. **The chat polling contract is too thin for the promised UI.**
   - `AgentChat` needs `agent_id` and `progress_note`.

6. **Fanout behavior is underspecified.**
   - Split sub-jobs require parent/child semantics that the current route contract does not define.

7. **In-memory rate limiting conflicts with repo rules if used on Vercel.**

### Missing details worth adding

- Mandatory use of existing route helpers / validation helpers
- session ID generation/return behavior
- target-agent offline behavior
- endpoint role separation between chat vs research vs trade-analysis
- selector precedence vs slash command precedence

---

## 4. Recommended simplification decisions

If you want the cleanest V1 springboard, these are the best simplifying choices:

1. **V1 routes to exactly one agent per user request.**
   - Defer multi-agent fanout.

2. **Specialists publish directly to Discord.**
   - Orchestrator only publishes its own chat/macro outputs in V1.

3. **Use DB-backed truth for all admin stats.**
   - Avoid promising live worker memory introspection.

4. **Add one dedicated scheduled-runs table.**
   - It simplifies catch-up, dedupe, and operator visibility.

5. **Extract shared Jarvis artifacts before deleting `lib/jarvis/`.**
   - Don’t force cleanup to fight unrelated runtime regressions.

---

## 5. Bottom line

AEV2 is close, but the next revision should focus less on high-level architecture and more on:

- exact migration mechanics
- exact queue semantics
- exact runtime topology
- exact API contracts
- exact cleanup boundaries

Once those are patched, it should be strong enough to promote into a real implementation springboard.
