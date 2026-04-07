# AEV2 Plan — V1 Autonomous Agent Framework

---

## 1. Initiative Summary

Ship the V1 Autonomous Agent Framework for Nexus Terminal: an Orchestrator, a Small Cap Trader (short-selling specialist), and a Swing Trader running as Docker Compose services on a home server, communicating via a Postgres-backed job queue (Neon Launch plan), and delivering all output through Discord. In V1, every chat request creates an Orchestrator job first; the Orchestrator routes internally using deterministic rules — no multi-agent fanout, no LLM routing. Specialist reports publish to Discord channel webhooks and are persisted in `agent_reports` for history. The home server and Vercel share the same Neon database.

**Non-goals for V1:** no multi-agent fanout for a single request, no in-app agent chat UI, no vector RAG, no `discord_user_links` table.

> `AEV2_PLAN.md` is the source of truth for sprint execution, sequencing, and launch gates.
> `AGENTIC_EXPANSIONV2.md` is the supporting architecture/reference document.
> `HANDOFF.md` may add executable implementation detail for the active sprint, but it must stay within the story scope and sequencing defined here.
> For the initial implementation worktree, EPIC-1 through EPIC-4 are the core build path. EPIC-5 is launch hardening. `AEV2-007` and `AEV2-311` remain parallel seed-data work and do not block the core runtime build.

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

Personal operator tasks — not code stories. Done items reflect current repo and environment state. Launch-only and seed-only items do not block the initial worktree implementation unless a story explicitly depends on them.

| Task | Detail |
|------|--------|
| ~~Docker Engine + Compose v2 on Dell~~ | DONE — Docker Engine and Compose v2 verified on Dell |
| ~~Discord server, channels, bot credentials~~ | DONE — all channel IDs, webhook URLs, bot token, guild ID, intents recorded |
| ~~`services/.env.example` → `services/.env`~~ | DONE — copied, filled, `.gitignore` covers `services/.env` |
| ~~Validate LLM lane keys and Neon connectivity~~ | DONE — Groq/NVIDIA keys and Neon `SELECT 1` verified |
| ~~Fix `services/.env.example` values~~ | DONE — `MACRO_CRON_HOUR=6`, `AGENT_POLL_INTERVAL_MS=5000` |
| ~~Rename `JARVIS_*` env vars to `LLM_*`~~ | DONE — `lib/llm-client.ts` and `.env.example` updated. Remember to update `.env.local` on Vercel and any local machines |
| ~~Baseline repo validation on `main`~~ | DONE — `npm run lint`, `npx tsc --noEmit`, and `npm test` passed on 2026-04-06 |
| Annotate trade screenshots | IN PROGRESS — manual annotation for seed data. Blocks only `AEV2-311`; does not block EPIC-1 through EPIC-4 |

---

## 4. Epic Overview

| Epic | Name | Goal | Depends On |
|------|------|------|------------|
| EPIC-0 | Preflight | Baseline repo green and worktree assumptions verified | Pre-sprint checklist |
| EPIC-1 | Core Contracts & Prompts | Types, dual-lane LLM client, auth, prompt stack | EPIC-0 |
| EPIC-2 | Schema & Migration | Agent tables (migration 0019), ownership model | EPIC-1 |
| EPIC-3 | Queue Runtime & Engine | Lease-fenced queue, memory, blueprints, checkpoints, worker loop | EPIC-2 |
| EPIC-4 | API Surface | `/api/agents/*` routes with locked contracts | EPIC-3 |
| EPIC-5 | Docker, Discord Bot & Launch Hardening | End-to-end runtime, observability, and launch readiness | EPIC-4 |

---

## 5. Story Catalog

### EPIC-0 — Preflight

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-006 | Baseline repo validation passes | `npm run lint`, `npx tsc --noEmit`, and `npm test` pass before Phase 1 begins | S |
| AEV2-007 | Trade example seed inputs prepared | Screenshots, template generation, reviewed seed JSON, and minimum seed count decided | M |

`AEV2-007` is parallel prep work. It does not block EPIC-1 through EPIC-4 and only blocks `AEV2-311`.

### EPIC-1 — Core Contracts & Prompts

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-101 | Create canonical agent types in `lib/agents/types.ts` | Defines V1 agent IDs, job types, and lease/checkpoint contracts without duplicating existing shared repo types; keep Sprint 1 self-contained unless a real overlap with `lib/types.ts` appears | M |
| AEV2-102 | Implement dual-lane LLM client in `lib/agents/llm-client.ts` | Separate from `lib/llm-client.ts` (Vercel-side); uses `INTERACTIVE_LLM_*` and `BACKGROUND_LLM_*` env vars; `callLlm()` returns a structured response | M |
| AEV2-103 | Implement agent auth helpers in `lib/agents/admin.ts` | `requireAgentAdmin()` and `requireServiceAuth()` compile with V1 service-key flow; hardcoded Discord→Nexus mapping lives in `lib/agents/admin.ts`; consumers can distinguish 400 missing `discord_user_id`, 401 invalid service key, and 403 unknown Discord user | M |
| AEV2-104 | Add prompt stack files | Global policy + orchestrator + small-cap + swing prompts exist and match V1 contracts | S |
| AEV2-105 | Lock prompt/policy rules into implementation | Prompt stack is ready for blueprint wiring | S |

### EPIC-2 — Schema & Migration

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-201 | Add agent framework tables to `lib/db/schema.ts` | All V1 tables, lease fields, constraints, and indexes added | L |
| AEV2-202 | Generate migration 0019 | Migration file captures new tables and is reviewed before apply | M |
| AEV2-203 | Apply migration 0019 and verify schema | Migrated DB has all new tables; `npm run db:migrate` exits clean | M |
| AEV2-204 | Establish `system-agent-user` ownership path | Migration or startup seed guarantees `system-agent-user` exists before autonomous jobs/reports are inserted | S |

Note: no backfill SQL needed. `jarvis_conversations` and `jarvis_request_log` were dropped in migrations 0017/0018. Agent tables start empty.

### EPIC-3 — Queue Runtime & Engine

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-301 | Build DB runtime helpers (`lib/agents/db.ts`) | Introduces Docker-side `getAgentDb()` helper for queue/runtime modules; Vercel-side code continues using `getDb()`/`getPoolDb()`; no cross-imports between Docker and Vercel DB helpers | M |
| AEV2-302 | Implement lease-fenced job queue | Tests prove lease fencing: stale workers cannot renew or complete a job after lease ownership changes, and completion/failure writes require matching `id + locked_by + lease_version` | L |
| AEV2-303 | Add token tracking, budget checks, circuit breaker, and rate limits | `lib/agents/runtime-limits.ts` exports `checkBudget`, `checkRateLimit`, `checkCircuitBreaker` (throw on rejection), `recordLlmAttempt`, `recordBreakerFailure`, and `recordBreakerSuccess`; budgets read `dailyBudgetCents`/`monthlyBudgetCents` from `getLlmBudgetConfig()` and are scoped per `userId`; breaker state is authoritative in `agent_registry.config.circuitBreaker` and updated via the canonical `jsonb_set` SQL shape (no read-modify-write); `checkCircuitBreaker` self-heals when `openedAt` is ≥60s old; new error classes `RateLimitExceededError` and `CircuitOpenError` are added to `lib/agents/types.ts`; focused tests cover breaker open/reset/self-heal, rate-limit rejection, and budget rejection | M |
| AEV2-304 | Implement agent memory and context assembly | Memory reads/writes use `agent_memory_v2` only; macro summary context reads the latest published `agent_reports` row where `user_id = 'system-agent-user'`, `agent_id = 'orchestrator'`, `report_type = 'macro-summary'`, and `status = 'published'`; `buildContext` empty-state return matches the literal `{ recentTrades: [], macroSummary: null, memory: [], conversationHistory: [] }`; focused tests cover agent-scoped reads, empty-state behavior, and no legacy `macro_summaries` dependency | M |
| AEV2-305 | Implement blueprint runner core | `lib/agents/blueprint-runner.ts` exports exactly `runBlueprint(blueprint, job, config, db, options)` returning `Promise<RunBlueprintResult>` and does not call `completeJob`/`failJob` itself; runner maps `job.input` → `stepInput.jobInput`, validates `job.input` for step 1 and `previousOutput` for step 2+ via Zod `safeParse`, runs `checkBudget → checkRateLimit → checkCircuitBreaker` before each step, calls `recordLlmAttempt` once per LLM attempt (including the one repair retry), records metadata-only `step_log` with status narrowed to `running|completed|failed`, and aborts on stale-lease `persistStepLog`; prompt loading/config wiring stays deferred to `AEV2-308` and checkpoint/resume integration is wired through `AEV2-306` | L |
| AEV2-306 | Add checkpoint and resume support | `lib/agents/checkpoints.ts` exports `loadCheckpoint`, `saveCheckpoint` (idempotent on `(job_id, step_index)`), and `recordStepEffect` (returns `false` on unique-violation); checkpoints store the normalized last successful step output that becomes the next step's `previousOutput`; resume loads the most recently saved checkpoint and restarts at `step_index + 1`; runner post-step write order is `recordStepEffect → saveCheckpoint → persistStepLog`; side-effect skip flow recovers `previousOutput` from the prior checkpoint with documented crash-recovery fallback for the four interleaving cases; tests use `effectType: 'memory-write'` (not `discord-delivery`, which stays deferred to Sprint 3) | L |
| AEV2-307 | Add Discord embed and delivery utilities | Report formatting and delivery helpers use separate idempotency keys for report writes vs Discord delivery so retries cannot duplicate `agent_reports` rows or webhook posts | M |
| AEV2-308 | Wire agent configs and shared utilities | Blueprint/config registry in place; `scrape-lite.ts` written from scratch (original deleted with Jarvis removal — check `git log --all --diff-filter=D -- 'lib/jarvis/scrape-lite.ts'` to recover logic); agent scans use TradingView screener for gainers/top movers, Massive API only for historical/snapshot data when needed | M |
| AEV2-309 | Add worker heartbeat and generic worker loop | Worker updates `/tmp/healthy`, renews DB heartbeat during long jobs, respects graceful shutdown, and processes jobs continuously | L |
| AEV2-310 | Implement orchestrator macro cron | Macro summary scheduling runs in Docker runtime, NOT Vercel cron; scheduled-run claiming dedupes by `agent_id + trigger_type + trading_date` | M |
| AEV2-311 | Seed trade example memory data | Seed script loads reviewed trade examples into `agent_memory_v2` — BLOCKED on personal annotation work | S |

### EPIC-4 — API Surface

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-401 | Ship service chat route | `POST/GET /api/agents/service/chat` creates and polls Orchestrator jobs as specified; tests cover 400 missing `discord_user_id`, 401 invalid service key, 403 unknown Discord user, and successful queued/processing/completed states | L |
| AEV2-402 | Ship reports endpoints | Reports list/detail endpoints return V1 shapes, scope by authenticated user, and exclude system-owned autonomous reports from user-facing history | M |
| AEV2-403 | Ship research endpoints | Direct specialist research create/list route works with V1 payloads and rejects unavailable specialist agents instead of queueing silently | M |
| AEV2-404 | Ship admin stats and memory endpoints | Stats return queue depth, stuck-processing visibility, retry/delivery/heartbeat data, and GET/DELETE memory admin flows validate filters and deletes correctly | M |
| AEV2-405 | Ship manual redelivery endpoint | `POST /api/agents/admin/redeliver` uses stored `report_json`, preserves idempotency, and updates `published`/`delivery_failed` correctly | M |
| AEV2-406 | Ship latest macro summary endpoint | `GET /api/agents/macro-summary/latest` returns latest published macro report | S |
| AEV2-407 | Lock API contract coverage with route tests | Tests cover success, auth failure, validation failure, lease-fencing-sensitive state transitions, redelivery, and offline fallback; required before EPIC-5 begins | M |

### EPIC-5 — Docker, Discord Bot & Launch Hardening

| Story ID | Story | Acceptance Criteria | Size |
|----------|-------|---------------------|------|
| AEV2-501 | Create generic agent container runtime | `services/agent.Dockerfile` and `services/agent-entrypoint.ts` boot agent services cleanly without depending on Next.js UI runtime paths | M |
| AEV2-502 | Rewrite Docker Compose for V1 topology | Runs 3 agents + Discord bot; explicitly removes existing Redis service; wires required env vars | L |
| AEV2-503 | Verify `services/.env.example` completeness | Confirm all required vars are present; clarify `MASSIVE_API_KEY` is for Docker agents only, not Vercel | XS |
| AEV2-504 | Build minimal Discord bot runtime (`services/discord-bot/`) | Bot listens only to `#orchestrator` and uses only `/api/agents/service/*` routes | L |
| AEV2-505 | Implement bot request/poll/reply flow | Bot sends `discord_user_id`, polls for completion, replies with embed or timeout handling, and never calls admin or user-facing routes | M |
| AEV2-506 | Validate service TypeScript and runtime startup | Explicit service-side TypeScript validation passes and all containers boot without contract errors | M |
| AEV2-507 | Add observability artifacts | `scripts/ops/agent-observability.sql` plus admin stats support required operational checks | M |
| AEV2-508 | Write rollback and home-server recovery runbooks | Rollback and recovery docs exist and match actual deployment flow | S |
| AEV2-509 | Execute deploy smoke checklist | Orchestrator chat, webhook delivery, macro summary, admin stats, and offline fallback all pass | L |
| AEV2-510 | Re-validate config and secrets before launch | Service/admin keys, webhook URLs, lane models, and env parity are confirmed | S |

---

## 6. Sprint Plan

### Sprint 0 — Preflight Gate

**Goal:** confirm the repo baseline and worktree assumptions before implementation starts.

**Stories:** AEV2-006

**Exit gate:** repo green (`npm run lint`, `npx tsc --noEmit`, `npm test`) and the execution docs are internally consistent enough to start coding. `AEV2-007` continues as parallel prep and does not block Phase 1.

---

### Sprint 1 — Foundation + Schema

**Goal:** lock contracts and create the persistence layer.

**Stories:** AEV2-101 to AEV2-105, AEV2-201 to AEV2-204

**Deliverables:** agent types, dual-lane LLM client, auth helpers, prompt stack, migration 0019, ownership model.

**Status:** COMPLETE — 2026-04-06. Phase 1 through Phase 3 landed, migration `0019` was applied, foundational seed rows were verified, and the Sprint 1 exit gate passed.

**Execution approach:** one worktree branch, but break Sprint 1 into three reviewable commits. Merge to main only after the Sprint 1 exit gate passes.

#### Recommended Commit Phases

This sprint is safer as three commit-sized phases. The branch stays linear, but each checkpoint keeps review scope tight and avoids mixing pure contract work with generated migration output.

| Phase | Stories | Purpose | Files touched | Commit gate |
|------|---------|---------|---------------|-------------|
| Phase 1 — Contract Surface | AEV2-101 to AEV2-105 | Create the new `lib/agents` contract layer without touching the database | `lib/agents/types.ts`, `lib/agents/llm-client.ts`, `lib/agents/admin.ts`, `lib/agents/prompts/*.md` | `npm run lint` + `npx tsc --noEmit` |
| Phase 2 — Schema + Migration Artifacts | AEV2-201 to AEV2-202 | Add the new tables and generate the Drizzle artifacts while the diff is still schema-only | `lib/db/schema.ts`, `drizzle/0019_*.sql`, `drizzle/meta/0019_snapshot.json`, `drizzle/meta/_journal.json` | Review generated SQL, then `npm run lint` + `npx tsc --noEmit` |
| Phase 3 — Seed + Apply + Verify | AEV2-203 to AEV2-204 | Append seed SQL, apply the migration, verify foundational rows, and run the full repo validation bar | `drizzle/0019_*.sql` (seed block only), `HANDOFF.md` | `npm run lint` + `npx tsc --noEmit` + `npm test` |

If you only want two commits, collapse Phase 2 and Phase 3 into one schema/migration commit. I would not keep Sprint 1 as a single unbroken implementation chunk.

#### Step-by-Step Implementation Guide

1. Phase 1 — scaffold the new agent contract surface.
   Create `lib/agents/` and `lib/agents/prompts/`, then land `types.ts`, `llm-client.ts`, `admin.ts`, and the four prompt files before touching `lib/db/schema.ts`.
2. Phase 1 — validate the runtime-free surface area.
   Run `npm run lint` and `npx tsc --noEmit` after the contract files exist so any bad imports or env-contract mistakes are caught before Drizzle generation muddies the diff.
3. Phase 2 — add the schema in one additive block.
   Append all nine new tables to the end of `lib/db/schema.ts`; do not intermingle them with existing trade/research tables.
4. Phase 2 — generate and review migration artifacts immediately.
   Run `npm run db:generate`, then review the new SQL plus `drizzle/meta/0019_snapshot.json` and `_journal.json` before making any manual edits.
5. Phase 3 — append the seed rows after generation, not before.
   Add the `system-agent-user` and `agent_registry` seed inserts to `drizzle/0019_*.sql` only after Drizzle has written the DDL, so the handwritten block stays isolated and easy to review.
6. Phase 3 — apply and verify.
   Run `npm run db:migrate`, confirm the foundational rows exist, then finish with `npm run lint`, `npx tsc --noEmit`, and `npm test`.

#### Story Execution Order

Stories must be implemented in this exact order — each depends on the one before it.

1. AEV2-101 (types)
2. AEV2-102 (LLM client — imports types)
3. AEV2-103 (auth — imports types)
4. AEV2-104 (prompt files — standalone markdown)
5. AEV2-105 (validation pass — confirms 101-104 compile together)
6. AEV2-201 (schema tables and DB contracts)
7. AEV2-202 (generate migration)
8. AEV2-203 (apply migration)
9. AEV2-204 (append foundational seed rows to the generated migration SQL)

---

#### AEV2-101 — Agent types (`lib/agents/types.ts`)

**Create** `lib/agents/types.ts`. This is the single source of truth for all agent framework types. Sprint 2+ modules import from here — nothing else defines these types.

Current repo reality: `lib/types.ts` covers trades and research payloads. It does not currently define overlapping agent/runtime contracts, so Sprint 1 should keep `lib/agents/types.ts` self-contained instead of introducing synthetic cross-file imports.

```typescript
// --- Enums & Unions ---

export type AgentId = 'orchestrator' | 'small-cap-trader' | 'swing-trader';

export type JobType =
  | 'chat'
  | 'research'
  | 'macro-summary'
  | 'pre-market-scan'
  | 'momentum-scan'
  | 'pattern-check';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type ReportStatus = 'published' | 'delivery_failed' | 'archived';

export type StepType = 'code' | 'llm';

export type LlmLane = 'interactive' | 'background';

export type FailureClass =
  | 'transient'
  | 'input-quality'
  | 'contract'
  | 'dependency'
  | 'policy';

export type StepStatus =
  | 'queued'
  | 'running'
  | 'validated'
  | 'retrying'
  | 'blocked'
  | 'failed'
  | 'escalated'
  | 'completed';

export type MemoryCategory =
  | 'fact'
  | 'thesis'
  | 'watchlist'
  | 'scan_param'
  | 'performance'
  | 'trade_insight'
  | 'user_preference'
  | 'strategy_note'
  | 'macro_fact'
  | 'pattern'
  | 'sentiment';

// --- V1 Agent IDs ---
// Used to validate agent_id values at runtime.
export const V1_AGENT_IDS: AgentId[] = [
  'orchestrator',
  'small-cap-trader',
  'swing-trader',
];

// --- LLM Contracts ---

export interface LlmRequest {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  model?: string;
}

export interface LlmResponse {
  content: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface LlmLaneConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface LlmBudgetConfig {
  dailyBudgetCents: number;
  monthlyBudgetCents: number;
  maxContextTokens: number;
  maxScanCandidates: number;
  maxPatternHistoryItems: number;
  maxRetriesPerStep: number;
}

// --- Step & Blueprint Contracts ---

export interface StepMetadata {
  canRetry: boolean;
  timeoutMs: number;
  maxRepairAttempts: number;
  sideEffect: boolean;
  idempotencyKey?: string;
  lane?: LlmLane;
}

export interface StepProvenance {
  sourceIds: string[];
  model?: string;
  promptVersion?: string;
  upstreamStepIds: string[];
  timestamp: string;
}

export interface StepResult<T = unknown> {
  status: StepStatus;
  data: T;
  artifacts?: Record<string, unknown>;
  metrics: {
    durationMs: number;
    tokensUsed?: number;
    attempt: number;
  };
  provenance: StepProvenance;
  validator?: {
    passed: boolean;
    errors?: string[];
    failureClass?: FailureClass;
  };
}

export interface StepInput {
  jobInput: unknown;
  previousOutput: unknown;
  memory: AgentMemoryRow[];
  context: AgentContext;
}

export interface BlueprintStep {
  name: string;
  type: StepType;
  metadata: StepMetadata;
  // inputSchema and outputSchema are Zod schemas — typed as `unknown`
  // here to avoid coupling types.ts to Zod. Concrete blueprints
  // (Sprint 2+) cast these to ZodSchema at the call site.
  inputSchema?: unknown;
  outputSchema?: unknown;
  run: (input: StepInput) => Promise<StepResult>;
}

export interface Blueprint {
  id: string;
  description: string;
  steps: BlueprintStep[];
}

// --- Step Log ---

export interface StepLogEntry {
  step: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  attempt: number;
  validatorResult?: 'pass' | 'fail';
  tokensUsed?: number;
  errorClass?: string;
}

// --- Job & Report Row Shapes ---
// These mirror the DB schema columns for in-code usage.
// They are NOT Drizzle select types — those come from the schema.
// These exist so queue/runtime code can pass typed objects without
// importing Drizzle internals.

export interface AgentJob {
  id: string;
  agentId: AgentId;
  userId: string;
  jobType: JobType;
  status: JobStatus;
  priority: number;
  input: unknown;
  result: unknown | null;
  errorMessage: string | null;
  progressNote: string | null;
  stepLog: StepLogEntry[];
  attempt: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  lockedBy: string | null;
  lockExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  leaseVersion: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface AgentReport {
  id: string;
  agentId: AgentId;
  userId: string;
  jobId: string | null;
  reportType: string;
  title: string;
  summary: string | null;
  reportJson: unknown;
  status: ReportStatus;
  deliveryChannel: string;
  deliveredAt: Date | null;
  deliveryError: string | null;
  createdAt: Date;
}

// --- Memory ---

export interface AgentMemoryRow {
  id: string;
  userId: string;
  agentId: AgentId;
  category: MemoryCategory;
  key: string;
  value: string;
  valueJson: unknown | null;
  source: string | null;
  confidence: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

// --- Context ---

export interface AgentContext {
  recentTrades: unknown[];
  macroSummary: unknown | null;
  memory: AgentMemoryRow[];
  conversationHistory: unknown[];
}

// --- Config ---

export interface AgentConfig {
  id: AgentId;
  displayName: string;
  llmLane: LlmLane;
  modelOverride?: string;
  temperature?: number;
  capabilities: JobType[];
  rolePromptPath: string;
  blueprints: Record<string, Blueprint>;
  blueprintResolver: (job: AgentJob) => Blueprint;
}

// --- Worker ---

export interface WorkerConfig {
  agentId: AgentId;
  pollIntervalMs: number;
}

// --- Token Tracking ---

export interface TokenTrackingEntry {
  userId: string;
  agentId: AgentId;
  mode: string;
  lane: LlmLane;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostCents: number;
  durationMs: number;
  success: boolean;
}

// --- Errors ---

export class BlueprintValidationError extends Error {
  constructor(
    public stepName: string,
    public location: 'input' | 'output',
    public zodError: unknown,
  ) {
    super(`Validation failed at ${stepName} (${location})`);
  }
}

export class BudgetExceededError extends Error {
  constructor(
    public agentId: AgentId,
    public limitType: 'daily' | 'monthly',
  ) {
    super(`${limitType} budget exceeded for ${agentId}`);
  }
}
```

**Acceptance criteria:**
- File compiles: `npx tsc --noEmit`
- No `any` casts
- Does not duplicate existing shared repo types; Sprint 1 remains self-contained because `lib/types.ts` has no overlapping agent/runtime contracts today
- Does not import Drizzle, Zod, or any runtime dependency — pure type definitions + two error classes

**Validation:** `npx tsc --noEmit`

---

#### AEV2-102 — Dual-lane LLM client (`lib/agents/llm-client.ts`)

**Create** `lib/agents/llm-client.ts`. This is the Docker-side LLM wrapper. It must NEVER import from `lib/llm-client.ts` (Vercel-side). They serve different runtimes with different env vars.

The implementation mirrors the fetch/timeout/error pattern in `lib/llm-client.ts` but with two named lanes and token tracking in the response.

```typescript
import type { LlmRequest, LlmResponse, LlmLane, LlmLaneConfig, LlmBudgetConfig } from './types';
```

**Env vars consumed (Docker-side only):**

| Variable | Default | Lane |
|----------|---------|------|
| `INTERACTIVE_LLM_API_KEY` | (required) | interactive |
| `INTERACTIVE_LLM_API_BASE_URL` | `https://api.groq.com/openai/v1` | interactive |
| `INTERACTIVE_LLM_MODEL` | `llama-3.3-70b-versatile` | interactive |
| `INTERACTIVE_LLM_TIMEOUT_MS` | `30000` | interactive |
| `BACKGROUND_LLM_API_KEY` | (required) | background |
| `BACKGROUND_LLM_API_BASE_URL` | `https://api.groq.com/openai/v1` | background |
| `BACKGROUND_LLM_MODEL` | `llama-3.3-70b-versatile` | background |
| `BACKGROUND_LLM_TIMEOUT_MS` | `60000` | background |
| `AGENT_DAILY_BUDGET_CENTS` | `500` | — |
| `AGENT_MONTHLY_BUDGET_CENTS` | `10000` | — |
| `AGENT_MAX_CONTEXT_TOKENS` | `32000` | — |
| `AGENT_MAX_SCAN_CANDIDATES` | `20` | — |
| `AGENT_MAX_PATTERN_HISTORY` | `50` | — |
| `AGENT_MAX_RETRIES_PER_STEP` | `2` | — |

**Exports:**

1. `getInteractiveLlmConfig(): LlmLaneConfig` — reads `INTERACTIVE_LLM_*` env vars
2. `getBackgroundLlmConfig(): LlmLaneConfig` — reads `BACKGROUND_LLM_*` env vars
3. `getLlmBudgetConfig(): LlmBudgetConfig` — reads `AGENT_*` budget env vars
4. `callLlm(request: LlmRequest, lane: LlmLane, overrides?: Partial<LlmLaneConfig>): Promise<LlmResponse>` — makes the API call

**`callLlm` behavior:**

1. Resolve config: lane determines which `get*LlmConfig()` to call, `overrides` merge on top, `request.model` overrides the resolved model
2. Build URL: `${config.baseUrl}/chat/completions` (base URL ends at `/v1`, function appends the path)
3. `fetch()` with `AbortController` timeout (same pattern as `lib/llm-client.ts`)
4. Parse response: extract `choices[0].message.content`, `usage.prompt_tokens`, `usage.completion_tokens`
5. Return `LlmResponse` with `content`, `modelUsed`, `inputTokens`, `outputTokens`, `durationMs`
6. On failure: throw with status code and truncated error detail (same `readFailureDetail` pattern)
7. No automatic retry in this client — retry logic lives in the blueprint runner (Sprint 2)

**Acceptance criteria:**
- Compiles with `npx tsc --noEmit`
- Only imports from `./types` (no Drizzle, no `lib/llm-client.ts`)
- Does not export streaming — Docker agents don't stream
- Throws if required API key env var is missing
- `callLlm()` returns token counts from the API response `usage` field

**Validation:** `npx tsc --noEmit && npm run lint`

---

#### AEV2-103 — Auth helpers (`lib/agents/admin.ts`)

**Create** `lib/agents/admin.ts`. Two auth functions for the API routes.

```typescript
interface AgentServiceUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}
```

**Exports:**

1. `requireAgentAdmin(request: Request): Response | null`
2. `requireServiceAuth(request: Request, body: { discord_user_id?: string }): { user: AgentServiceUser; discordUserId: string } | Response`

**Important contract choice:** keep body parsing in the route and keep service auth pure. `requireServiceAuth()` should validate headers plus the already-parsed body object. That avoids double-reading `request.json()` and keeps the helper aligned with the V1 service-route contract in `AGENTIC_EXPANSIONV2.md`.

**`requireAgentAdmin` behavior:**

1. Read `x-agent-admin-key` header from request
2. Compare against `process.env.AGENT_ADMIN_KEY`
3. If missing env var: return `Response.json({ error: 'Admin auth not configured' }, { status: 500 })`
4. If header missing or mismatch: return `Response.json({ error: 'Unauthorized' }, { status: 401 })`
5. If match: return `null` (success — caller proceeds)

**`requireServiceAuth` behavior:**

1. Read `x-agent-service-key` header from request
2. Compare against `process.env.AGENT_SERVICE_KEY`
3. If missing env var: return `Response.json({ error: 'Service auth not configured' }, { status: 500 })`
4. If header missing or mismatch: return `Response.json({ error: 'Unauthorized' }, { status: 401 })`
5. Read `discord_user_id` from the passed `body`
6. If `discord_user_id` missing: return `Response.json({ error: 'discord_user_id is required' }, { status: 400 })`
7. Look up `discord_user_id` in the hardcoded V1 mapping (see below)
8. If not found: return `Response.json({ error: 'Unknown Discord user' }, { status: 403 })`
9. If found: return `{ user, discordUserId }`, where `user` matches the shape returned by `requireUser()`

**Hardcoded V1 Discord→Nexus mapping:**

```typescript
// V1 hardcoded mapping — replace placeholder values with real identities.
// This avoids a DB table for 2-3 users in V1 while still matching requireUser().
const DISCORD_USER_MAP: Record<string, AgentServiceUser> = {
  // 'discord-user-id-1': {
  //   id: 'nexus-user-id-1',
  //   email: 'user1@example.com',
  //   name: 'User One',
  //   picture: null,
  // },
};
```

Leave the map empty with commented examples. You'll fill it in before Sprint 4 (Discord bot).

**Route-call example for Sprint 3:**

```typescript
const parsed = await parseAndValidate(request, serviceChatSchema);
if ('error' in parsed) return parsed.error;

const authState = requireServiceAuth(request, parsed.data);
if (authState instanceof Response) return authState;

const user = authState.user;
```

**Acceptance criteria:**
- Compiles with `npx tsc --noEmit`
- 400 for missing `discord_user_id`, 401 for invalid key, 403 for unknown Discord user
- Returns the same user-shape contract as `requireUser()`, plus `discordUserId`
- Does not import NextAuth, Drizzle, or any DB code — pure header/body validation
- The hardcoded mapping stores full user identity objects, not just user IDs, so callers do not need a DB lookup to build a user payload

**Validation:** `npx tsc --noEmit && npm run lint`

---

#### AEV2-104 — Prompt stack files

**Create** four markdown files under `lib/agents/prompts/`:

1. **`lib/agents/prompts/global-policy.md`** — Layer 1 (shared by all agents)

Content skeleton:

```markdown
# Global Agent Policy

## Authority Order
1. This policy overrides all other instructions.
2. The Orchestrator owns all routing decisions.
3. Specialists only process — they never route or delegate.

## Evidence Rules
- Every factual claim must cite its source (Massive API timestamp, AskEdgar filing ID, etc.).
- LLM steps must include `confidence`, `evidenceIds`, and `insufficientEvidence` in output.
- If evidence is insufficient, say so — do not fabricate data.

## Output Rules
- Respond in structured JSON matching the step's output schema.
- Do not include markdown formatting in JSON string values.
- Do not include conversational filler ("Sure!", "Great question!", etc.).

## Memory Rules
- LLM steps may propose memory write candidates but never write directly.
- All memory writes are validated and persisted by a subsequent code step.

## Safety
- Never execute trades or place orders.
- Never access external systems beyond declared API endpoints.
- Never expose API keys, tokens, or internal system details in output.
```

2. **`lib/agents/prompts/orchestrator.md`** — Layer 2

```markdown
# Orchestrator

You are the Orchestrator for Nexus Terminal. You route user requests to the appropriate specialist agent or handle them directly.

## Routing Rules
- `/research TICKER` → Small Cap Trader
- `/swing TICKER` or `/momentum TICKER` → Swing Trader
- Market cap < $200M AND pre-market gain >= 50% → Small Cap Trader
- Momentum/trending/MDR/parabolic topic → Swing Trader
- Simple factual lookup → handle directly
- Ambiguous or mixed-domain → handle directly

## Fallback Behavior
- If the target specialist is offline or degraded, handle the request yourself and note the limitation.

## Macro Briefing
- Daily macro summaries synthesize headline data into a structured briefing.
- Focus on market-moving events, sector rotation, and key economic data.
- Keep it concise — traders read this before the bell.
```

3. **`lib/agents/prompts/small-cap.md`** — Layer 2

```markdown
# Small Cap Trader (Short-Selling Specialist)

You are a professional short seller and research analyst specializing in small-cap dilution plays.

## Core Questions
For every stock you analyze, answer:
1. Has this company issued shares frequently in the past?
2. Can they issue today?

## Filing Signal Hierarchy
- **Highest risk:** Active ATM + recent 424B supplements = currently selling shares
- **Very high risk:** Active S-3 shelf with remaining capacity + price at/above shelf price
- **High risk:** Recent 8-K announcing new offering or private placement
- **Medium risk:** Expired shelf (must re-register — delay, not safety)
- **Lower risk:** No active registration (needs S-1 or new S-3, 4-6 week delay)

## Volume-Offering Correlation
When a small-cap has unusual pre-market volume AND a history of filing 424B supplements on high-volume days, the probability of an offering attempt that session is substantially elevated. Flag this explicitly.

## Voice
Write like a seasoned short seller, not a chatbot. Be direct, data-driven, and confident. Make a call and back it with evidence. No hedging ("you might consider"), no filler. Use second person ("This company has filed three prospectus supplements in 90 days. They will sell into this move.").
```

4. **`lib/agents/prompts/swing-trader.md`** — Layer 2

```markdown
# Swing Trader

You specialize in multi-day runners (MDR), parabolic setups, and momentum patterns. Your job is to identify stocks going parabolic over multiple days and extract LONG entry strategies.

## MDR Pattern Recognition
- Look for 50%+ multi-day gains over 3-5 days
- Compare volume profile, float, and catalyst type against historical patterns
- Score MDR similarity (0-100) against known setups
- Identify continuation probability, expected move magnitude, key levels

## Momentum Indicators
- RSI > 70 and rising = momentum confirmation
- Volume surge > 3x 20-day average = institutional interest
- Price above EMA(9) and EMA(21) = trend intact
- Breakout above prior day's high on volume = continuation signal

## Pattern Check Rules
- Compare current price action against entry/stop/target levels
- Classify as BREAKOUT / EXHAUSTION / CONTINUATION / STOPPED
- Recommend HOLD / ADD / TRIM / EXIT / WATCH with reasoning

## Voice
Write like a momentum trader. Focus on levels, patterns, and catalysts. Be specific about entry/exit prices and invalidation points.
```

**Acceptance criteria:**
- All four files exist at the specified paths
- Content covers the domain knowledge from AGENTIC_EXPANSIONV2.md sections 6, 22, 23, 24
- No code in these files — they are pure prompt text for the LLM

**Validation:** Verify files exist: `ls lib/agents/prompts/`

---

#### AEV2-105 — Lock prompt/policy rules

**This is a validation-only story.** No new code — just confirm everything from 101-104 works together.

**Steps:**

1. Run `npx tsc --noEmit` — must pass with the new files
2. Run `npm run lint` — must pass
3. Verify imports work: the LLM client imports from types, admin imports from types
4. Verify prompt files exist and are non-empty
5. Spot-check: `lib/agents/types.ts` has no `any` casts, no Drizzle imports, no cross-imports to `lib/llm-client.ts`

**Validation:** `npm run lint && npx tsc --noEmit`

---

#### AEV2-201 — Agent framework tables (`lib/db/schema.ts`)

**Add** 9 new tables to the bottom of `lib/db/schema.ts`, after the existing `askedgarCache` table. Follow the existing patterns exactly (use `pgTable`, same timestamp style, same index style).

**Table 1: `agent_registry`**

```typescript
export const agentRegistry = pgTable('agent_registry', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('offline'),
  capabilities: jsonb('capabilities').notNull().default([]),
  config: jsonb('config').notNull().default({}),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

No extra indexes — max 3 rows.

**Table 2: `agent_jobs`**

```typescript
export const agentJobs = pgTable('agent_jobs', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobType: text('job_type').notNull(),
  status: text('status').notNull().default('queued'),
  priority: integer('priority').notNull().default(0),
  input: jsonb('input').notNull(),
  result: jsonb('result'),
  errorMessage: text('error_message'),
  progressNote: text('progress_note'),
  stepLog: jsonb('step_log').default([]),
  attempt: integer('attempt').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  lockExpiresAt: timestamp('lock_expires_at', { withTimezone: true }),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  leaseVersion: integer('lease_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('idx_agent_jobs_poll').on(table.agentId, table.priority, table.createdAt),
  index('idx_agent_jobs_user_status').on(table.userId, table.status, table.createdAt),
  index('idx_agent_jobs_stale').on(table.status, table.lockExpiresAt),
]);
```

Note: Drizzle does not support partial indexes (`WHERE status = 'queued'`) natively. The indexes above are full indexes on those columns. Sprint 2 job claiming must use a single `UPDATE ... WHERE ... RETURNING` statement; a subquery or CTE is allowed to preserve ordered selection safely, but do not use `SELECT ... FOR UPDATE SKIP LOCKED` for the claim flow. This is acceptable for V1 volume.

**Table 3: `agent_reports`**

```typescript
export const agentReports = pgTable('agent_reports', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => agentJobs.id, { onDelete: 'set null' }),
  reportType: text('report_type').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  reportJson: jsonb('report_json').notNull(),
  status: text('status').notNull().default('published'),
  deliveryChannel: text('delivery_channel').notNull().default('discord'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  deliveryError: text('delivery_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_agent_reports_user_status').on(table.userId, table.status, table.createdAt),
  index('idx_agent_reports_agent').on(table.agentId, table.createdAt),
  index('idx_agent_reports_job').on(table.jobId),
]);
```

**Table 4: `agent_conversations`**

```typescript
export const agentConversations = pgTable('agent_conversations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  channel: text('channel').notNull().default('web'),
  contextSnapshot: jsonb('context_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_agent_conversations_user_session').on(table.userId, table.sessionId, table.createdAt),
  index('idx_agent_conversations_agent').on(table.agentId, table.createdAt),
]);
```

**Table 5: `agent_request_log`**

```typescript
export const agentRequestLog = pgTable('agent_request_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  mode: text('mode').notNull(),
  lane: text('lane').notNull().default('background'),
  modelUsed: text('model_used'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  estimatedCostCents: integer('estimated_cost_cents').default(0),
  durationMs: integer('duration_ms').notNull().default(0),
  success: integer('success').notNull().default(1),
  sourceCount: integer('source_count').notNull().default(0),
  chunkCount: integer('chunk_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_agent_request_log_user_created').on(table.userId, table.createdAt),
  index('idx_agent_request_log_agent_created').on(table.agentId, table.createdAt),
  index('idx_agent_request_log_created').on(table.createdAt),
]);
```

**Table 6: `agent_memory_v2`**

```typescript
export const agentMemoryV2 = pgTable('agent_memory_v2', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  category: text('category').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  valueJson: jsonb('value_json'),
  source: text('source'),
  confidence: text('confidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => [
  unique('agent_memory_v2_user_agent_category_key').on(table.userId, table.agentId, table.category, table.key),
  index('agent_memory_v2_user_agent_category_idx').on(table.userId, table.agentId, table.category),
]);
```

**Table 7: `agent_scheduled_runs`**

```typescript
export const agentScheduledRuns = pgTable('agent_scheduled_runs', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agentRegistry.id),
  triggerType: text('trigger_type').notNull(),
  tradingDate: text('trading_date').notNull(),
  status: text('status').notNull().default('pending'),
  jobId: text('job_id').references(() => agentJobs.id),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  skipReason: text('skip_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('agent_scheduled_runs_agent_trigger_date').on(table.agentId, table.triggerType, table.tradingDate),
  index('idx_scheduled_runs_status').on(table.agentId, table.status, table.tradingDate),
]);
```

Note: `tradingDate` uses `text` type (not `date`) to match the existing repo pattern where dates are stored as `'YYYY-MM-DD'` strings (see `trades.date`).

**Table 8: `agent_step_effects`**

```typescript
export const agentStepEffects = pgTable('agent_step_effects', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => agentJobs.id, { onDelete: 'cascade' }),
  stepName: text('step_name').notNull(),
  effectType: text('effect_type').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('agent_step_effects_idempotency').on(table.idempotencyKey),
]);
```

**Table 9: `agent_job_checkpoints`**

```typescript
export const agentJobCheckpoints = pgTable('agent_job_checkpoints', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => agentJobs.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  stepName: text('step_name').notNull(),
  checkpointJson: jsonb('checkpoint_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('agent_job_checkpoints_job_step').on(table.jobId, table.stepIndex),
  index('idx_agent_job_checkpoints_job_step').on(table.jobId, table.stepIndex),
]);
```

**Acceptance criteria:**
- All 9 tables added to `lib/db/schema.ts`
- All FK references resolve (agent_registry → users, agent_jobs → agent_registry + users, etc.)
- `npx tsc --noEmit` passes
- `npm run lint` passes

**Validation:** `npm run lint && npx tsc --noEmit`

---

#### AEV2-202 — Generate migration 0019

**Run:** `npm run db:generate`

This produces `drizzle/0019_*.sql`. Review the generated SQL before proceeding:

1. Verify all 9 `CREATE TABLE` statements are present
2. Verify foreign key constraints match the schema
3. Verify indexes are created
4. Verify unique constraints are created
5. No `DROP TABLE` or `ALTER TABLE` statements for existing tables — this migration only adds new tables

**Do not modify the generated DDL blocks** unless Drizzle produces incorrect output. The one planned manual edit in Sprint 1 is the AEV2-204 seed block appended after generation.

**Validation:** `ls drizzle/0019_*` shows exactly one new SQL file, `drizzle/meta/0019_snapshot.json` exists, and `drizzle/meta/_journal.json` is updated

---

#### AEV2-203 — Apply migration 0019

**Run:** `npm run db:migrate`

After migration completes, verify:

1. Migration exits cleanly (exit code 0)
2. Run `npm run db:generate` again — it should report no changes needed (schema in sync)

**Validation:** `npm run db:migrate` exits 0, then `npm run db:generate` reports no pending changes

---

#### AEV2-204 — Establish system-agent-user ownership

The migration (0019) should include an `INSERT` for the system agent user. Since Drizzle's `db:generate` only produces DDL (not DML), we need to append the seed data manually to the migration file.

**After AEV2-202 generates the migration file,** append this SQL to the end of `drizzle/0019_*.sql`:

```sql
-- Seed: system-agent-user for autonomous job/report ownership
INSERT INTO users (id, email, name)
VALUES ('system-agent-user', 'system@nexus.internal', 'System Agent')
ON CONFLICT (id) DO NOTHING;

-- Seed: V1 agent registry rows
INSERT INTO agent_registry (id, display_name, description, status, capabilities)
VALUES
  ('orchestrator', 'Orchestrator', 'Routes requests, runs macro cron, oversees memory', 'offline', '["chat", "macro-summary"]'),
  ('small-cap-trader', 'Small Cap Trader', 'Short-selling specialist — dilution analysis and pre-market scans', 'offline', '["research", "pre-market-scan"]'),
  ('swing-trader', 'Swing Trader', 'MDR pattern recognition, momentum scans, parabolic setup alerts', 'offline', '["research", "momentum-scan", "pattern-check"]')
ON CONFLICT (id) DO NOTHING;
```

**Why in the migration:** These are foundational rows that the entire system depends on. The `agent_jobs.agent_id` FK references `agent_registry.id`, so the registry rows must exist before any job can be created. The `system-agent-user` row must exist before any autonomous job can set `user_id = 'system-agent-user'`. Putting them in the migration guarantees they exist the moment the schema is applied — no startup race condition.

**Acceptance criteria:**
- `system-agent-user` row exists in `users` after migration
- Three agent registry rows exist after migration
- `ON CONFLICT DO NOTHING` makes re-running safe

**Validation:** After `npm run db:migrate`, verify with Drizzle Studio (`npm run db:studio`) or a direct query that the rows exist.

---

#### Sprint 1 Exit Gate

All of the following must pass before merging to main:

```bash
npm run lint           # ESLint clean
npx tsc --noEmit       # TypeScript clean
npm test               # All existing tests still pass
```

**File inventory after Sprint 1:**

| File | Status |
|------|--------|
| `lib/agents/types.ts` | NEW |
| `lib/agents/llm-client.ts` | NEW |
| `lib/agents/admin.ts` | NEW |
| `lib/agents/prompts/global-policy.md` | NEW |
| `lib/agents/prompts/orchestrator.md` | NEW |
| `lib/agents/prompts/small-cap.md` | NEW |
| `lib/agents/prompts/swing-trader.md` | NEW |
| `lib/db/schema.ts` | MODIFIED (9 tables added) |
| `drizzle/0019_*.sql` | NEW (generated + seed SQL appended) |
| `drizzle/meta/0019_snapshot.json` | NEW (generated) |
| `drizzle/meta/_journal.json` | MODIFIED (generated) |

**What did NOT change:** No existing application routes were modified. No existing tests were changed. No new dependencies added.

---

### Sprint 2 — Queue and Worker Core

**Goal:** make the runtime safe before exposing APIs.

**Stories:** AEV2-301 to AEV2-306

**Deliverables:** DB helpers, lease-fenced queue, memory/context, blueprint runner, checkpoint/resume.

---

### Sprint 3 — Runtime Wiring + API Surface

**Goal:** connect the worker system to stable app contracts.

**Stories:** AEV2-307 to AEV2-310, AEV2-401 to AEV2-407

**Deliverables:** Discord delivery utils, config wiring, worker loop, macro cron, and all `/api/agents/*` routes with contract coverage.

---

### Sprint 4 — Docker + Discord + Launch

**Goal:** prove the full V1 system works end-to-end outside local app-only execution and complete launch-hardening work.

**Stories:** AEV2-501 to AEV2-510

**Deliverables:** agent Docker runtime, Discord bot, compose topology, runbooks, observability, smoke verification.

Launch-hardening note: Sprint 4 is required for deployment readiness, not for starting the initial implementation worktree.

### Parallel Track — Seed Data

**Goal:** prepare and import reviewed trade examples without blocking the core runtime build.

**Stories:** AEV2-007, AEV2-311

**Deliverables:** reviewed trade example JSON and an idempotent seed script that can populate `agent_memory_v2` when annotations are ready.

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
AEV2-311 is blocked until trade screenshots are manually annotated. This is personal operator work — not automatable — but it is parallel work and does not block EPIC-1 through EPIC-4.

### Env var naming
The current repo already uses `LLM_*` names in `lib/llm-client.ts`. Do not reintroduce `JARVIS_*` names in new code or docs.

### Discord service auth mapping
`requireServiceAuth()` must own the V1 hardcoded Discord→Nexus user mapping in `lib/agents/admin.ts`. Treat its 400/401/403 behavior as a contract, not an implementation detail.

---

## 8. Sprint Rules

### Definition of Ready
A story is sprint-ready only if:
- Upstream dependencies are complete
- File/route scope is known
- Acceptance criteria are written
- Validation commands are known
- Required secrets/external setup already exist
- Any manual operator dependency is either complete or explicitly marked non-blocking for the current sprint

### Definition of Done
A story is done only when:
- Implementation matches the source contract
- Read-back review confirms the intended files changed
- `npm run lint` passes
- `npx tsc --noEmit` passes
- Relevant tests pass
- `npm test` passes before final handoff and before entering EPIC-5 launch-hardening work
- Manual proof exists for runtime/Discord/Docker flows when applicable
- Queue/API/runtime stories have focused contract tests for their key state transitions before the story is closed

### Sequencing Rules
- Never start EPIC-3 before migration 0019 is stable.
- Never start EPIC-5 before API contracts are locked.
- Never start EPIC-5 before `AEV2-407` is complete.
- Never run cleanup or destructive migrations (0020+) before full replacement validation.
- Treat ops docs and smoke checks as EPIC-5 launch blockers, not blockers for EPIC-1 through EPIC-4 implementation.
