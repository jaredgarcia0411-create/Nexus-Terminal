# AEV2_REVISIONS.md — Literal Edit Script for `AGENTIC_EXPANSION_V2.md`

> Generated: 2026-03-28 | Status: APPLY THESE EDITS BEFORE FINAL SPEC PASS

## Locked Decisions

- Use **`agent_memory_v2`** instead of modifying legacy `agent_memory` in place.
- Keep **resume support**, but move resumable payloads into **`agent_job_checkpoints`**.
- Keep **V1 single-agent routing only**.
- Remove **`/api/agents/trade-analysis`** from V1 to avoid collision with the repo's existing Jarvis trade-history analysis meaning.

## Literal Edit Script

### 1. Executive Summary

- In Section 1, keep the high-level architecture, but remove any wording that implies V1 supports multi-agent fanout for a single user request.
- If the summary mentions `trade-analysis` as a first-class V1 agent route, remove it.

### 2. Database Schema

#### Section 3.2 `agent_jobs`

- Keep the lease fields already added.
- Add a **lease fencing field**:
  - `lease_version INTEGER NOT NULL DEFAULT 0`
- Update the poll/claim semantics so the worker increments `lease_version` when it acquires the lease.
- Add a note that all lease renewal, completion, and failure writes must match:
  - `id`
  - `locked_by`
  - `lease_version`

#### Section 3.6

- Delete the entire current section titled:
  - ``### 3.6 `agent_memory` — Modified (add `agent_id` column)``
- Replace it with a new section titled:
  - ``### 3.6 `agent_memory_v2` — Agent-scoped memory``
- The replacement section should define a **new table**, not a modification of legacy `agent_memory`.
- Use this table shape:
  - `id TEXT PRIMARY KEY`
  - `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
  - `agent_id TEXT NOT NULL REFERENCES agent_registry(id)`
  - `category TEXT NOT NULL`
  - `key TEXT NOT NULL`
  - `value TEXT NOT NULL`
  - `value_json JSONB`
  - `source TEXT`
  - `confidence TEXT`
  - `created_at TIMESTAMPTZ DEFAULT now()`
  - `updated_at TIMESTAMPTZ DEFAULT now()`
  - `expires_at TIMESTAMPTZ`
- Constraints/indexes:
  - `UNIQUE(user_id, agent_id, category, key)`
  - `INDEX agent_memory_v2_user_agent_category_idx ON (user_id, agent_id, category)`
- Add explicit text:
  - legacy `agent_memory` remains in place during rollout
  - all new `/api/agents/*` code and Docker workers read/write `agent_memory_v2` only
  - old Jarvis code continues using legacy `agent_memory` until cleanup

#### Section 3.7 `agent_scheduled_runs`

- Keep the table.
- Replace the current purpose/catch-up wording with explicit **claim semantics**:
  - scheduled runs are deduped by `UNIQUE(agent_id, trigger_type, trading_date)`
  - the scheduler must first attempt `INSERT ... ON CONFLICT DO NOTHING`
  - only the insert winner is allowed to create the corresponding `agent_jobs` row
  - this table is both observability and the atomic dedupe/claim mechanism
- Add one sentence documenting manual replay for a supplied `trading_date`.

#### Section 3.8 `agent_step_effects`

- Keep the table.
- Delete the sentence that says the idempotency row is inserted "in the same transaction as the side effect."
- Replace it with:
  - `agent_step_effects` dedupes **DB-side effects and delivery attempts**, but does not make external webhook POSTs transactionally atomic
  - Discord/webhook publishing uses the report delivery state model in Section 12

#### Add New Section 3.9

- Insert a new section immediately after `agent_step_effects`:
  - ``### 3.9 `agent_job_checkpoints` — Resume payload store``
- Define this table:
  - `id TEXT PRIMARY KEY`
  - `job_id TEXT NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE`
  - `step_index INTEGER NOT NULL`
  - `step_name TEXT NOT NULL`
  - `checkpoint_json JSONB NOT NULL`
  - `created_at TIMESTAMPTZ DEFAULT now()`
  - `updated_at TIMESTAMPTZ DEFAULT now()`
- Constraints/indexes:
  - `UNIQUE(job_id, step_index)`
  - `INDEX idx_agent_job_checkpoints_job_step ON (job_id, step_index DESC)`
- Add explicit text:
  - checkpoints store the accumulated normalized output needed for resume
  - checkpoints do not store raw API payloads or large artifacts

### 3. Data Migration Plan

#### Section 4

- Replace the migration plan so it no longer alters `agent_memory` in place.

- Rewrite **Migration 0017** to do this:
  1. create `agent_registry`
  2. seed `agent_registry`
  3. create `agent_jobs` including lease fields and `lease_version`
  4. create `agent_reports`
  5. create `agent_conversations`
  6. create `agent_request_log`
  7. create `agent_scheduled_runs`
  8. create `agent_step_effects`
  9. create `agent_memory_v2`
  10. create `agent_job_checkpoints`
  11. copy `jarvis_conversations -> agent_conversations`
  12. copy `jarvis_request_log -> agent_request_log`
  13. copy legacy `agent_memory -> agent_memory_v2` with `agent_id = 'orchestrator'`
  14. add CHECK constraints for all enum-like text fields

- Rewrite **Migration 0018** to do this:
  1. drop `jarvis_conversations`
  2. drop `jarvis_request_log`
  3. optionally drop legacy `agent_memory` after validation
  4. do **not** describe any unique-constraint swap on `agent_memory`

- Delete all language claiming old and new code can safely coexist because of an in-place `agent_memory` constraint strategy.

### 4. Connection Pooling Strategy

#### Section 5

- Change the intro sentence from free-tier wording to **Neon Launch plan** wording so it matches the rest of the doc.

### 5. Agent Specifications

#### Section 6.1 Orchestrator

- Find the routing responsibility bullets.
- Delete any wording that says ambiguous or multi-domain requests are split into sub-jobs in V1.
- Replace with:
  - ambiguous or mixed-domain requests stay with `orchestrator`
  - multi-agent fanout is deferred to V2

#### Section 6.4 Blueprint Runner

- Keep the blueprint engine design.
- Replace the bullet list under `runBlueprint()` so it says:
  - `step_log` stores step metadata only
  - successful step outputs needed for resume are persisted to `agent_job_checkpoints`
  - retries resume from the latest completed checkpoint
- In the sample code:
  - remove the block that loads `lastGood.data` from `job.step_log`
  - replace it with checkpoint lookup logic from `agent_job_checkpoints`
  - add a note that checkpoints contain normalized accumulated output only
- Keep the accumulator pattern from the revision notes.

### 6. Error Handling & Retry

#### Section 10

- Keep the retry model.
- Add lease fencing language:
  - stale-job reaper only requeues jobs whose lease is expired **and** whose heartbeat is stale
  - `completeJob`, `failJob`, and `renewLease` must match `locked_by` and `lease_version`
- Add one explicit sentence that this prevents a stale worker from completing a job after ownership has already moved.

### 7. Discord Publish Flow

#### Sections 11 and 12

- Keep V1 manual redelivery.
- Add a clear delivery state sequence:
  1. write `agent_reports` row
  2. attempt webhook delivery
  3. on success: set `status = 'published'`, `delivered_at`
  4. on failure: set `status = 'delivery_failed'`, `delivery_error`
  5. manual redelivery reads stored `report_json` and retries publish by `report_id`
- Add a sentence that `agent_step_effects` supports dedupe markers, but cannot make external Discord posting atomic.

### 8. API Route Migration

#### Section 13 route table

- Update the route table to exactly this V1 set:
  - `/api/agents/chat` `POST`
  - `/api/agents/chat` `GET`
  - `/api/agents/reports` `GET`
  - `/api/agents/reports/[id]` `GET`
  - `/api/agents/research` `POST`
  - `/api/agents/research` `GET`
  - `/api/agents/admin/stats` `GET`
  - `/api/agents/admin/memory` `GET/DELETE`
  - `/api/agents/admin/redeliver` `POST`
  - `/api/agents/macro-summary/latest` `GET`
- Remove `/api/agents/trade-analysis` from the route table.

#### Section 13 contracts

- Keep the detailed `/api/agents/chat` polling contract.
- Add equivalent request/response contract blocks for:
  - `/api/agents/reports`
  - `/api/agents/reports/[id]`
  - `/api/agents/research`
  - `/api/agents/admin/memory`
  - `/api/agents/admin/redeliver`
  - `/api/agents/macro-summary/latest`
- For `admin/redeliver`, define:
  - request body: `{ report_id: string }`
  - success response: `{ report_id, status: 'published' | 'delivery_failed' }`

#### Section 13 taxonomy

- Replace the current `job_type` language with one canonical V1 set:
  - `chat`
  - `research`
  - `macro-summary`
  - `pre-market-scan`
  - `momentum-scan`
  - `pattern-check`
- Remove `trade-analysis` and `swing-research` from the canonical V1 taxonomy.
- Add a note that swing on-demand analysis uses `job_type = 'research'` with `agent_id = 'swing-trader'`.

#### Section 13 endpoint role clarification

- Replace the current endpoint-role table so it no longer mentions `POST /api/agents/trade-analysis`.
- Keep `POST /api/agents/research` as the programmatic convenience wrapper.

#### Section 13 auth

- Expand the conventions section to include:
  - `requireServiceAuth()` for the Discord bot integration
  - service auth is limited to bot-safe routes only
  - the bot must not use admin routes

### 9. Frontend Migration

#### Section 14

- Keep the current frontend migration list.
- Add one line clarifying that programmatic ticker-triggered analysis from UI surfaces should use `/api/agents/research`.
- Remove any implied dependency on a V1 `/api/agents/trade-analysis` route.

### 10. Docker Infrastructure

#### Section 15

- Keep the Docker layout.
- Add one sentence that the heartbeat loop is responsible for touching `/tmp/healthy` for the healthcheck.
- Keep the note that `deploy.resources` is not enforced in normal `docker compose` mode.

### 11. Build Order

#### Section 16

- Reorder the phase plan so schema-dependent code is not scheduled before the schema exists.
- Update the phases so the actual dependency flow is:
  1. core contracts and prompts
  2. schema and migrations
  3. DB runtime, queue, checkpoints, memory, worker internals
  4. API routes
  5. Docker runtime and Discord bot
  6. frontend
  7. cleanup

- Make these explicit step changes:
  - add a step for `agent_job_checkpoints` support in schema and runtime
  - add a step for `app/api/agents/admin/redeliver/route.ts`
  - add steps for actual Discord bot implementation work
  - add a validation step for service-side TypeScript because root `tsconfig.json` excludes `services/`

### 12. Complete File Inventory

#### Section 17

- Update the create list to add:
  - `app/api/agents/admin/redeliver/route.ts`
  - `lib/agents/checkpoints.ts` if checkpoint persistence is factored out of `blueprint-runner.ts`
  - any real Discord bot source/runtime files needed for V1 if they are part of this repo
- Update the schema modify description so it says:
  - add new tables including `agent_memory_v2` and `agent_job_checkpoints`
  - do not describe `agent_memory` as an in-place modification for V1
- Remove `app/api/agents/trade-analysis/route.ts` from the create list.

### 13. Environment Variables

#### Section 18

- Keep current env vars.
- Add one sentence under infrastructure/auth clarifying:
  - `AGENT_SERVICE_KEY` is for Discord bot service calls only
  - `AGENT_ADMIN_KEY` is for admin routes only

### 14. Discord Orchestrator Adapter

#### Section 19

- Keep the V1 Discord adapter.
- Remove any remaining ambiguity about reuse-vs-rebuild.
- Replace it with one explicit statement of implementation intent:
  - either "restore and modify in-repo Discord bot source" or
  - "build a minimal V1 Discord bot runtime in `services/discord-bot/`"
- Add acceptance criteria:
  - receives message in `#orchestrator`
  - resolves Discord user to Nexus user
  - calls the app with `requireServiceAuth()`
  - polls for completion
  - posts the final response back into Discord

### 15. Revision Notes

#### Revision 5 and any earlier revision notes

- Update revision summaries so they no longer claim:
  - in-place `agent_memory` coexistence
  - checkpoint resume from `step_log`
  - V1 `trade-analysis` route/job type if that wording still exists

### 16. Final Consistency Sweep

- After all edits above, run one manual consistency pass across the whole document and fix every stale reference to:
  - `agent_memory` as a modified table instead of `agent_memory_v2`
  - `trade-analysis` as a V1 route/job type
  - `swing-research` as a canonical V1 type
  - multi-agent fanout in V1
  - checkpoint data living in `step_log`
  - free-tier Neon wording where Launch plan is intended

## Done Condition

- Do not mark `AGENTIC_EXPANSION_V2.md` sprint-board ready until every edit above is applied and the file reads consistently front-to-back without contradictory V1 behavior.
