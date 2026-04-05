# AEV2 Plan — V1 Autonomous Agent Framework

---

## 1. Initiative Summary

Ship the V1 Autonomous Agent Framework for Nexus Terminal: an Orchestrator, a Small Cap Trader (short-selling specialist), and a Swing Trader running as Docker Compose services on a home server, communicating via a Postgres-backed job queue (Neon Launch plan), and delivering all output through Discord. In V1, every chat request creates an Orchestrator job first; the Orchestrator routes internally using deterministic rules — no multi-agent fanout, no LLM routing. Specialist reports publish to Discord channel webhooks and are persisted in `agent_reports` for history. The home server and Vercel share the same Neon database.

**Non-goals for V1:** no multi-agent fanout for a single request, no in-app agent chat UI, no vector RAG, no `discord_user_links` table.

---

## 2. Architecture Overview

| Layer | Technology | Notes |
|-------|-----------|-------|
| Web app | Next.js 15 on Vercel | Research tab, trade journal, all existing UI |
| Agent workers + Discord bot | Docker Compose on WSL2/Ubuntu home server | Long-running services, poll Neon for jobs |
| Database | Neon PostgreSQL (shared) | Both Vercel and Docker read/write the same DB |
| LLM — interactive lane | Fast model (Groq / NVIDIA) | Orchestrator chat — optimized for speed |
| LLM — background lane | Cheap model (NVIDIA / DeepSeek) | Specialist scans and macro jobs |
| Discord | Bot + channel webhooks | Only delivery surface in V1 |

**Agents:** Orchestrator (routing, macro cron, memory oversight), Small Cap Trader (pre-market scan, short-sell research, dilution risk), Swing Trader (MDR pattern recognition, momentum scans, parabolic setup alerts).

**Market data split:**

| Consumer | Source | Mechanism |
|----------|--------|-----------|
| Vercel Research tab | TradingView screener | `/api/tradingview/gainers` |
| Docker agent scans (gainers/top movers) | TradingView screener | `/api/tradingview/gainers` or direct TradingView query |
| Docker agents (historical/snapshot data) | Massive API | `GET /v2/snapshot/...` with `MASSIVE_API_KEY` — on-demand only |

---

## 3. Pre-Sprint Checklist

Personal operator tasks — not code stories. Must be complete before Sprint 0 closes.

| Task | Detail |
|------|--------|
| ~~Docker Engine + Compose v2 on Dell~~ | DONE — Docker Engine and Compose v2 verified on Dell |
| ~~Discord server, channels, bot credentials~~ | DONE — all channel IDs, webhook URLs, bot token, guild ID, intents recorded |
| ~~`services/.env.example` → `services/.env`~~ | DONE — copied, filled, `.gitignore` covers `services/.env` |
| ~~Validate LLM lane keys and Neon connectivity~~ | DONE — Groq/NVIDIA keys and Neon `SELECT 1` verified |
| ~~Fix `services/.env.example` values~~ | DONE — `MACRO_CRON_HOUR=6`, `AGENT_POLL_INTERVAL_MS=5000` |
| ~~Rename `JARVIS_*` env vars to `LLM_*`~~ | DONE — `lib/llm-client.ts` and `.env.example` updated. Remember to update `.env.local` on Vercel and any local machines |
| Annotate trade screenshots | IN PROGRESS — manual annotation for seed data, blocks AEV2-311 (Sprint 3) |

---

## 4. Epic Overview

| Epic | Name | Goal | Depends On |
|------|------|------|------------|
| EPIC-0 | Preflight | Baseline repo green, seed inputs ready | Pre-sprint checklist |
| EPIC-1 | Core Contracts & Prompts | Types, dual-lane LLM client, auth, prompt stack | EPIC-0 |
| EPIC-2 | Schema & Migration | Agent tables (migration 0019), ownership model | EPIC-1 |
| EPIC-3 | Queue Runtime & Engine | Lease-fenced queue, memory, blueprints, checkpoints, worker loop | EPIC-2 |
| EPIC-4 | API Surface | `/api/agents/*` routes with locked contracts | EPIC-3 |
| EPIC-5 | Docker, Discord Bot & Ops | End-to-end runtime, observability, launch readiness | EPIC-4 |

---

## 5. Story Catalog

### EPIC-0 — Preflight

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-006 | Baseline repo validation passes | `npm run lint && npx tsc --noEmit` passes before Phase 1 begins | S |
| AEV2-007 | Trade example seed inputs prepared | Screenshots, template generation, reviewed seed JSON, and minimum seed count decided | M |

### EPIC-1 — Core Contracts & Prompts

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-101 | Create canonical agent types in `lib/agents/types.ts` | Imports shared types from `lib/types.ts` (no duplication), defines V1 agent IDs, job types, lease/checkpoint contracts, no `any` casts | M |
| AEV2-102 | Implement dual-lane LLM client in `lib/agents/llm-client.ts` | Separate from `lib/llm-client.ts` (Vercel-side); uses `INTERACTIVE_LLM_*` and `BACKGROUND_LLM_*` env vars; `callLlm()` returns a structured response | M |
| AEV2-103 | Implement agent auth helpers in `lib/agents/admin.ts` | `requireAgentAdmin()` and `requireServiceAuth()` compile with V1 service-key flow | M |
| AEV2-104 | Add prompt stack files | Global policy + orchestrator + small-cap + swing prompts exist and match V1 contracts | S |
| AEV2-105 | Lock prompt/policy rules into implementation | Prompt stack is ready for blueprint wiring | S |

### EPIC-2 — Schema & Migration

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-201 | Add agent framework tables to `lib/db/schema.ts` | All V1 tables, lease fields, constraints, and indexes added | L |
| AEV2-202 | Generate migration 0019 | Migration file captures new tables and is reviewed before apply | M |
| AEV2-203 | Apply migration 0019 and verify schema | Migrated DB has all new tables; `npm run db:migrate` exits clean | M |
| AEV2-204 | Establish `system-agent-user` ownership path | Autonomous jobs/reports have a deterministic non-null owner row | S |

Note: no backfill SQL needed. `jarvis_conversations` and `jarvis_request_log` were dropped in migrations 0017/0018. Agent tables start empty.

### EPIC-3 — Queue Runtime & Engine

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-301 | Build DB runtime helpers (`lib/agents/db.ts`) | Supports DB access for all queue/runtime modules | M |
| AEV2-302 | Implement lease-fenced job queue | `pollForJob()`, completion, failure, heartbeat, and stale-lease protection all work as specified | L |
| AEV2-303 | Add token tracking, circuit breaker, and rate limits | Usage and failure controls compile and are wired to agent runtime | M |
| AEV2-304 | Implement agent memory and context assembly | Memory reads/writes use `agent_memory_v2`; for macro summary context, reads from `agent_reports WHERE report_type = 'macro-summary'` (not a `macro_summaries` table — that no longer exists) | M |
| AEV2-305 | Implement prompt loading and blueprint runner | Blueprint runner executes ordered steps with input/output validation | L |
| AEV2-306 | Add checkpoint and resume support | Latest checkpoint resumes mid-blueprint instead of replaying from step 1 | L |
| AEV2-307 | Add Discord embed and delivery utilities | Report formatting and delivery helpers support idempotent write/delivery flow | M |
| AEV2-308 | Wire agent configs and shared utilities | Blueprint/config registry in place; `scrape-lite.ts` written from scratch (original deleted with Jarvis removal — check `git log --all --diff-filter=D -- 'lib/jarvis/scrape-lite.ts'` to recover logic); agent scans use TradingView screener for gainers/top movers, Massive API only for historical/snapshot data when needed | M |
| AEV2-309 | Add worker heartbeat and generic worker loop | Worker updates `/tmp/healthy`, heartbeats DB, and processes jobs continuously | L |
| AEV2-310 | Implement orchestrator macro cron | Macro summary scheduling runs in Docker runtime, NOT Vercel cron | M |
| AEV2-311 | Seed trade example memory data | Seed script loads reviewed trade examples into `agent_memory_v2` — BLOCKED on personal annotation work | S |

### EPIC-4 — API Surface

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-401 | Ship service chat route | `POST/GET /api/agents/service/chat` creates and polls Orchestrator jobs as specified; auth enforced | L |
| AEV2-402 | Ship reports endpoints | Reports list/detail endpoints return V1 shapes and filter correctly | M |
| AEV2-403 | Ship research endpoints | Direct specialist research create/list route works with V1 payloads | M |
| AEV2-404 | Ship admin stats and memory endpoints | Stats plus GET/DELETE memory admin flows compile and return valid JSON | M |
| AEV2-405 | Ship manual redelivery endpoint | `POST /api/agents/admin/redeliver` supports `delivery_failed` recovery path | M |
| AEV2-406 | Ship latest macro summary endpoint | `GET /api/agents/macro-summary/latest` returns latest published macro report | S |
| AEV2-407 | Lock API contract coverage with route tests | Tests cover success, auth failure, validation failure, and key state transitions — defer to post-launch if time-constrained | M |

### EPIC-5 — Docker, Discord Bot & Ops

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-501 | Create generic agent container runtime | `services/agent.Dockerfile` and `services/agent-entrypoint.ts` boot agent services cleanly | M |
| AEV2-502 | Rewrite Docker Compose for V1 topology | Runs 3 agents + Discord bot; explicitly removes existing Redis service; wires required env vars | L |
| AEV2-503 | Verify `services/.env.example` completeness | Confirm all required vars are present; clarify `MASSIVE_API_KEY` is for Docker agents only, not Vercel | XS |
| AEV2-504 | Build minimal Discord bot runtime (`services/discord-bot/`) | Bot listens to `#orchestrator` channel and uses only service routes | L |
| AEV2-505 | Implement bot request/poll/reply flow | Bot sends `discord_user_id`, polls for completion, and replies with embed or timeout handling | M |
| AEV2-506 | Validate service TypeScript and runtime startup | Service TS checks pass and all containers boot without contract errors | M |
| AEV2-507 | Add observability artifacts | `scripts/ops/agent-observability.sql` plus admin stats support required operational checks | M |
| AEV2-508 | Write rollback and home-server recovery runbooks | Rollback and recovery docs exist and match actual deployment flow | S |
| AEV2-509 | Execute deploy smoke checklist | Orchestrator chat, webhook delivery, macro summary, admin stats, and offline fallback all pass | L |
| AEV2-510 | Re-validate config and secrets before launch | Service/admin keys, webhook URLs, lane models, and env parity are confirmed | S |

---

## 6. Sprint Plan

### Sprint 0 — Preflight Gate

**Goal:** environment and external dependencies ready before coding.

**Stories:** AEV2-006, AEV2-007

**Exit gate:** repo green, seed inputs ready. No Phase 1 code begins until Sprint 0 is complete.

---

### Sprint 1 — Foundation + Schema

**Goal:** lock contracts and create the persistence layer.

**Stories:** AEV2-101 to AEV2-105, AEV2-201 to AEV2-204

**Deliverables:** agent types, dual-lane LLM client, auth helpers, prompt stack, migration 0019, ownership model.

---

### Sprint 2 — Queue and Worker Core

**Goal:** make the runtime safe before exposing APIs.

**Stories:** AEV2-301 to AEV2-306

**Deliverables:** DB helpers, lease-fenced queue, memory/context, blueprint runner, checkpoint/resume.

---

### Sprint 3 — Runtime Wiring + API Surface

**Goal:** connect the worker system to stable app contracts.

**Stories:** AEV2-307 to AEV2-311, AEV2-401 to AEV2-407

**Deliverables:** Discord delivery utils, config wiring, worker loop, macro cron, seed script, all `/api/agents/*` routes.

---

### Sprint 4 — Docker + Discord + Launch

**Goal:** prove the full V1 system works end-to-end outside local app-only execution.

**Stories:** AEV2-501 to AEV2-510

**Deliverables:** agent Docker runtime, Discord bot, compose topology, runbooks, observability, smoke verification.

---

## 7. Key Warnings

### Naming collision
`lib/llm-client.ts` (Vercel, single-lane) vs `lib/agents/llm-client.ts` (Docker, dual-lane). Never cross-import these. They serve different runtime environments with different env var namespaces.

### Migration numbering
Next available migration is **0019**. Migrations 0017 and 0018 are already applied (Jarvis removal and Schwab removal respectively). Do not reuse those numbers.

### No backfills
`jarvis_conversations` and `jarvis_request_log` are dropped. Agent tables start empty. No data migration needed or possible.

### scrape-lite.ts
The original `lib/jarvis/scrape-lite.ts` was deleted with Jarvis removal. Must be written from scratch for AEV2-308. Run `git log --all --diff-filter=D -- 'lib/jarvis/scrape-lite.ts'` to recover original logic before writing.

### macro_summaries table is gone
Any code that read `macro_summaries` must instead query `agent_reports WHERE report_type = 'macro-summary'`. Do not create a `macro_summaries` table.

### Trade seed data
AEV2-311 is blocked until trade screenshots are manually annotated. This is personal operator work — not automatable.

### JARVIS_* env vars
`lib/llm-client.ts` still uses `JARVIS_*` variable names. These must be renamed to `LLM_*` (or a clear agreed prefix) before Sprint 1 begins. Update both the file and `.env.local`.

---

## 8. Sprint Rules

### Definition of Ready
A story is sprint-ready only if:
- Upstream dependencies are complete
- File/route scope is known
- Acceptance criteria are written
- Validation commands are known
- Required secrets/external setup already exist

### Definition of Done
A story is done only when:
- Implementation matches the source contract
- Read-back review confirms the intended files changed
- `npm run lint` passes
- `npx tsc --noEmit` passes
- Relevant tests pass
- Manual proof exists for runtime/Discord/Docker flows when applicable

### Sequencing Rules
- Never start EPIC-3 before migration 0019 is stable.
- Never start EPIC-5 before API contracts are locked.
- Never run cleanup or destructive migrations (0020+) before full replacement validation.
- Treat ops docs and smoke checks as launch blockers, not optional follow-up.
