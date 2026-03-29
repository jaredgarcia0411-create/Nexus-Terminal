# AEV2 Draft — Epic / Story / Sprint Breakdown

> Source: `AGENTIC_EXPANSIONV2.md`
> Purpose: convert the V1 autonomous agent spec into a sprint-ready delivery plan
> Planning decision: treat AEV2 as **one initiative**, split into **epics**, execute through **multiple sprints**

---

## 1. Planning Model

### Initiative
**Ship the V1 Autonomous Agent Framework for Nexus Terminal**

This initiative covers the Orchestrator, Small Cap Trader, Swing Trader, Postgres-backed job system, Discord-first delivery flow, Docker runtime, and Jarvis migration/cleanup.

### Non-Goals for V1
- No multi-agent fanout for a single request
- No in-app agent chat UI
- No vector RAG
- No `discord_user_links` table yet

These exclusions are explicitly deferred in the source spec.

### Work Hierarchy
- **Initiative** = the full AEV2 program
- **Epic** = one major capability area
- **Story** = one shippable, testable outcome
- **Sprint** = a timebox that pulls ready stories from one or more epics

### Board Rule
Do **not** import the full spec into a single sprint board. Import only stories that are:
1. dependency-ready
2. small enough to complete in one sprint
3. backed by acceptance criteria

---

## 2. Initiative Summary

### Why this is multi-sprint
- The source spec spans architecture, schema, migrations, runtime workers, API routes, Docker services, Discord integration, observability, and destructive cleanup.
- The source build order already defines **8 sequential phases**.
- The file inventory calls for **55 new files**, **3 modified files**, and **~22 deletions**.

### High-Level Dependency Chain
1. Preflight / environment readiness
2. Contracts / prompts / auth helpers
3. Schema and migration
4. Queue runtime and blueprint engine
5. API routes
6. Docker runtime and Discord bot
7. Ops hardening / smoke checks
8. Jarvis cleanup and destructive migration

---

## 3. Epic Overview

| Epic | Name | Goal | Source Sections | Depends On |
|---|---|---|---|---|
| EPIC-0 | Preflight & Environment Readiness | Make local/server prerequisites deterministic before coding | Sec. 16, Sec. 17 Phase 0, Sec. 19 | — |
| EPIC-1 | Core Contracts & Prompt Foundation | Establish types, LLM client, auth, and prompt stack | Sec. 6, Sec. 8, Sec. 17 Phase 1, Sec. 22-26 | EPIC-0 |
| EPIC-2 | Schema, Migration & Ownership Model | Create tables, backfills, and system-owned job/report semantics | Sec. 3, Sec. 4, Sec. 17 Phase 2 | EPIC-1 |
| EPIC-3 | Queue Runtime, Memory & Blueprint Engine | Build lease-fenced queue, memory, checkpoints, worker runtime, and macro cron | Sec. 5-12, Sec. 17 Phase 3 | EPIC-2 |
| EPIC-4 | API Surface | Ship `/api/agents/*` routes with locked V1 contracts | Sec. 13, Sec. 20, Sec. 17 Phase 4 | EPIC-3 |
| EPIC-5 | Docker Runtime, Discord Bot & Ops Readiness | Run the system end-to-end in Docker and prove operational readiness | Sec. 15-20, Sec. 17 Phase 5 | EPIC-4 |
| EPIC-6 | Jarvis Extraction & Cleanup | Extract shared pieces, remove legacy Jarvis paths, run destructive cleanup last | Sec. 14, Sec. 17 Phase 6-7 | EPIC-5 |

---

## 4. Story Catalog

### EPIC-0 — Preflight & Environment Readiness

**Exit criteria:** every Phase 0 prerequisite is complete and verified; baseline repo is green before implementation begins.

| Story ID | Story | Acceptance Criteria | Size |
|---|---|---|---|
| AEV2-001 | Docker runtime ready on WSL2 | Docker Engine installed, Compose v2 verified, `docker run hello-world` passes | S |
| AEV2-002 | Discord server and channels provisioned | All required channels and webhook URLs created and recorded | S |
| AEV2-003 | Discord bot credentials provisioned | Bot token, client ID, guild ID, intents, and invite complete | S |
| AEV2-004 | `services/.env` contract prepared | `services/.env.example` copied, `.gitignore` covers `services/.env`, required values listed | S |
| AEV2-005 | LLM lane keys and Neon connectivity validated | Groq/NVIDIA key test succeeds and `psql $DATABASE_URL -c "SELECT 1"` works | S |
| AEV2-006 | Baseline repo validation passes | `npm run lint && npx tsc --noEmit` passes before Phase 1 begins | S |
| AEV2-007 | Trade example seed inputs prepared | screenshots, template generation, reviewed seed JSON, and minimum seed count decided | M |

### EPIC-1 — Core Contracts & Prompt Foundation

**Exit criteria:** foundational types, auth, prompts, and LLM wrapper compile cleanly and support one successful structured LLM call.

| Story ID | Story | Acceptance Criteria | Size |
|---|---|---|---|
| AEV2-101 | Create canonical agent types | `lib/agents/types.ts` defines V1 IDs, job types, lease/checkpoint contracts, no `any` casts | M |
| AEV2-102 | Implement retry and LLM client foundation | `lib/agents/retry.ts` and `lib/agents/llm-client.ts` compile and `callLlm()` returns a structured response | M |
| AEV2-103 | Implement agent auth helpers | `lib/agents/admin.ts` provides `requireAgentAdmin()` and `requireServiceAuth()` with V1 service-key flow | M |
| AEV2-104 | Add prompt stack files | global policy + orchestrator + small-cap + swing prompts exist and match V1 contracts | S |
| AEV2-105 | Lock prompt/policy rules into implementation docs | prompt stack references Section 22-26 rules and is ready for blueprint wiring | S |

### EPIC-2 — Schema, Migration & Ownership Model

**Exit criteria:** new schema exists, migration 0017 is generated and applied safely, backfills are verified, and `system-agent-user` ownership is explicit.

| Story ID | Story | Acceptance Criteria | Size |
|---|---|---|---|
| AEV2-201 | Add agent framework tables to schema | `lib/db/schema.ts` includes all V1 tables, lease fields, constraints, and indexes from spec | L |
| AEV2-202 | Generate migration 0017 | migration captures new tables plus backfill-safe structure and is reviewed before apply | M |
| AEV2-203 | Apply migration 0017 and verify backfills | migrated DB contains seeded registry rows and copied conversation/request/memory data | M |
| AEV2-204 | Establish `system-agent-user` ownership path | autonomous jobs/reports have a deterministic non-null owner row | S |
| AEV2-205 | Document backup/restore before migration | `docs/ops/agents-backup-restore.md` exists and one restore verification is recorded | S |

### EPIC-3 — Queue Runtime, Memory & Blueprint Engine

**Exit criteria:** workers can poll, lease, checkpoint, resume, track cost/health, and execute a test blueprint safely.

| Story ID | Story | Acceptance Criteria | Size |
|---|---|---|---|
| AEV2-301 | Build DB runtime helpers | `lib/agents/db.ts` supports DB access for queue/runtime modules | M |
| AEV2-302 | Implement lease-fenced job queue | `pollForJob()`, completion, failure, heartbeat, and stale-lease protection work as specified | L |
| AEV2-303 | Add token tracking, circuit breaker, and rate limits | usage and failure controls compile and are wired to agent runtime | M |
| AEV2-304 | Implement agent memory and context assembly | memory reads/writes use `agent_memory_v2`; context builder is deterministic | M |
| AEV2-305 | Implement prompt loading and blueprint runner | blueprint runner executes ordered steps with input/output validation | L |
| AEV2-306 | Add checkpoint and resume support | latest checkpoint resumes mid-blueprint instead of replaying from step 1 | L |
| AEV2-307 | Add Discord embed and delivery utilities | report formatting and delivery helpers support idempotent write/delivery flow | M |
| AEV2-308 | Wire agent configs and shared utilities | blueprint/config registry and `scrape-lite` copy are in place | M |
| AEV2-309 | Add worker heartbeat and generic worker loop | worker updates `/tmp/healthy`, heartbeats DB, and processes jobs continuously | L |
| AEV2-310 | Implement orchestrator macro cron | macro summary scheduling runs in Docker runtime, not Vercel cron | M |
| AEV2-311 | Seed trade example memory data | seed script loads reviewed trade examples for agent use | S |

### EPIC-4 — API Surface

**Exit criteria:** all V1 `/api/agents/*` routes exist, enforce auth correctly, and match the locked request/response contracts.

| Story ID | Story | Acceptance Criteria | Size |
|---|---|---|---|
| AEV2-401 | Ship service chat route | `POST/GET /api/agents/service/chat` creates and polls Orchestrator jobs exactly as specified | L |
| AEV2-402 | Ship reports endpoints | reports list/detail endpoints return V1 shapes and filter correctly | M |
| AEV2-403 | Ship research endpoints | direct specialist research create/list route works with V1 payloads | M |
| AEV2-404 | Ship admin stats and memory endpoints | stats plus GET/DELETE memory admin flows compile and return valid JSON | M |
| AEV2-405 | Ship manual redelivery endpoint | `POST /api/agents/admin/redeliver` supports `delivery_failed` recovery path | M |
| AEV2-406 | Ship latest macro summary endpoint | `GET /api/agents/macro-summary/latest` returns latest published macro report | S |
| AEV2-407 | Lock API contract coverage | route tests cover success, auth failure, validation failure, and key state transitions | M |

### EPIC-5 — Docker Runtime, Discord Bot & Ops Readiness

**Exit criteria:** all services run together, Discord chat works end-to-end, observability exists, and launch blockers are closed.

| Story ID | Story | Acceptance Criteria | Size |
|---|---|---|---|
| AEV2-501 | Create generic agent container runtime | `services/agent.Dockerfile` and `services/agent-entrypoint.ts` boot agent services cleanly | M |
| AEV2-502 | Rewrite Docker Compose for V1 topology | compose runs 3 agents + Discord bot, removes Redis, and wires required env vars | L |
| AEV2-503 | Publish complete `services/.env.example` | env example contains every required runtime/config variable from Section 19 | S |
| AEV2-504 | Build minimal Discord bot runtime | `services/discord-bot/` listens to `#orchestrator` and uses only service routes | L |
| AEV2-505 | Implement bot request/poll/reply flow | bot sends `discord_user_id`, polls for completion, and replies with embed/timeout handling | M |
| AEV2-506 | Validate service-side TypeScript and runtime startup | service TS checks pass and all containers boot without contract errors | M |
| AEV2-507 | Add observability artifacts | `scripts/ops/agent-observability.sql` plus admin stats support required checks | M |
| AEV2-508 | Write rollback and home-server recovery runbooks | rollback and recovery docs exist and match actual deployment flow | S |
| AEV2-509 | Execute deploy smoke checklist | orchestrator chat, webhook delivery, macro summary, admin stats, and offline fallback all pass | L |
| AEV2-510 | Re-validate config and secrets before launch | service/admin keys, webhook URLs, lane models, and env parity are confirmed | S |

### EPIC-6 — Jarvis Extraction & Cleanup

**Exit criteria:** shared pieces are extracted, legacy reads are gone, destructive cleanup is done only after full validation.

| Story ID | Story | Acceptance Criteria | Size |
|---|---|---|---|
| AEV2-601 | Extract shared types and AskEdgar helpers | `lib/shared-types.ts` and `lib/askedgar.ts` exist; current consumers are updated | M |
| AEV2-602 | Prove cleanup readiness | no remaining reads from `jarvis_conversations`, `jarvis_request_log`, or legacy `agent_memory` | M |
| AEV2-603 | Remove Jarvis routes and modules | legacy Jarvis API and library code is deleted only after replacement paths are verified | L |
| AEV2-604 | Remove Jarvis UI and old cron wiring | Jarvis components/imports and Vercel macro cron config are removed safely | M |
| AEV2-605 | Generate migration 0018 | destructive drop migration is generated only after readiness checklist passes | S |
| AEV2-606 | Apply migration 0018 and close cleanup | legacy tables are dropped, rollback cautions documented, and validation passes again | M |

---

## 5. Recommended Sprint Plan

## Sprint 0 — Preflight Gate
**Sprint goal:** make the environment and external dependencies ready before coding.

**Stories**
- AEV2-001 to AEV2-007

**Exit gate**
- No Phase 1 code begins until all Sprint 0 items are complete.

## Sprint 1 — Foundation + Schema
**Sprint goal:** lock contracts and create the persistence layer safely.

**Stories**
- AEV2-101 to AEV2-105
- AEV2-201 to AEV2-205

**Primary deliverables**
- agent types, LLM client, auth helpers, prompts
- schema updates, migration 0017, ownership model, backup doc

## Sprint 2 — Queue and Worker Core
**Sprint goal:** make the runtime safe before exposing APIs.

**Stories**
- AEV2-301 to AEV2-306

**Primary deliverables**
- DB runtime helpers
- lease-fenced queue
- memory/context
- blueprint runner
- checkpoint/resume

## Sprint 3 — Runtime Wiring + API Surface
**Sprint goal:** connect the worker system to stable app contracts.

**Stories**
- AEV2-307 to AEV2-311
- AEV2-401 to AEV2-407

**Primary deliverables**
- Discord delivery utilities
- config wiring, worker loop, macro cron, seed script
- all `/api/agents/*` routes and route coverage

## Sprint 4 — Docker + Discord + Launch Readiness
**Sprint goal:** prove the full V1 system works end-to-end outside local app-only execution.

**Stories**
- AEV2-501 to AEV2-510

**Primary deliverables**
- agent Docker runtime
- Discord bot runtime
- compose topology
- runbooks, observability, smoke verification

## Sprint 5 — Cleanup and Legacy Removal
**Sprint goal:** remove Jarvis only after the new system is proven stable.

**Stories**
- AEV2-601 to AEV2-606

**Primary deliverables**
- shared type extraction
- removal of legacy Jarvis paths
- migration 0018

---

## 6. Sprint Rules

### Definition of Ready
A story is sprint-ready only if:
- upstream dependencies are complete
- file/route scope is known
- acceptance criteria are written
- validation commands are known
- required secrets/external setup already exist

### Definition of Done
A story is done only when:
- implementation matches the source contract
- read-back review confirms the intended files changed
- `npm run lint` passes
- `npx tsc --noEmit` passes
- relevant tests pass
- manual proof exists for runtime/Discord/Docker flows when applicable

### Sequencing Rules
- Never start EPIC-3 before migration work is stable.
- Never start EPIC-5 before API contracts are locked.
- Never run cleanup migration 0018 before full replacement validation.
- Treat ops docs and smoke checks as launch blockers, not optional follow-up.

---

## 7. Board Setup Recommendation

### Roadmap / Initiative Board
Track:
- all epics
- dependency order
- blocked vs ready status
- sprint assignment

### Sprint Board
Track only:
- ready stories for the current sprint
- in-progress story owner
- blockers
- validation state

### Suggested Labels
- `initiative:aev2`
- `epic:preflight`
- `epic:foundation`
- `epic:schema`
- `epic:runtime`
- `epic:api`
- `epic:ops`
- `epic:cleanup`
- `phase:0` through `phase:7`
- `blocked`
- `launch-blocker`
- `destructive-change`

---

## 8. Final Recommendation

Use this structure:

**One initiative**
- AEV2 / V1 Autonomous Agent Framework

**Seven epics**
- EPIC-0 through EPIC-6 above

**Thirty-nine stories**
- AEV2-001 through AEV2-606 above

**Six sprints**
- Sprint 0 through Sprint 5

This is the cleanest deterministic planning model for `AGENTIC_EXPANSIONV2.md`.
