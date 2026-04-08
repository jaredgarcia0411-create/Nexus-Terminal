# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Sprint 1 and Sprint 2 are complete. Older detail was removed from this file; use git history and `AEV2_PLAN.md` for archived context.

### Workflow Tooling Note

- 2026-04-06: Added a repo-maintained Codex `commit` alias skill in [`codex-skills/commit/`](/home/jared/Nexus-Terminal/codex-skills/commit) and UI metadata for [`codex-skills/nexus-commit/`](/home/jared/Nexus-Terminal/codex-skills/nexus-commit) so Codex can surface a user-facing commit entry point while keeping `nexus-commit` as the canonical workflow.
- 2026-04-07: Audited the Codex harness docs and refreshed [`AGENTS.md`](/home/jared/Nexus-Terminal/AGENTS.md) plus repo-maintained skill sources in [`codex-skills/`](/home/jared/Nexus-Terminal/codex-skills) to remove stale `.claude`/`.opencode` assumptions, fix the `lib/trade-utils.ts` path, and document repo-local skill agent metadata.

---

## AEV2 Sprint 1 — Foundation + Schema

> Generated: 2026-04-06 | Agent: Codex
> Status: COMPLETE

### Summary

- Landed the Sprint 1 contract surface in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts), [`lib/agents/llm-client.ts`](/home/jared/Nexus-Terminal/lib/agents/llm-client.ts), [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts), and [`lib/agents/prompts/`](/home/jared/Nexus-Terminal/lib/agents/prompts).
- Added the V1 agent tables in [`lib/db/schema.ts`](/home/jared/Nexus-Terminal/lib/db/schema.ts), generated and applied [`drizzle/0019_clever_zodiak.sql`](/home/jared/Nexus-Terminal/drizzle/0019_clever_zodiak.sql), and updated the Drizzle metadata.
- Seeded `system-agent-user` plus the three foundational `agent_registry` rows and re-verified the repo baseline.

### Validation

- `npm run db:migrate` OK
- `npm run db:generate` OK
- `npm run lint` OK
- `npx tsc --noEmit` OK
- `npm test` OK

### Archive Note

- The detailed Phase 1 / Phase 2 / Phase 3 notes were intentionally removed from `HANDOFF.md` now that Sprint 1 is closed.

---

## AEV2 Sprint 2 — Queue and Worker Core

> Generated: 2026-04-07 | Agent: Codex
> Status: COMPLETE

### Summary

- Landed the Sprint 2 runtime layer in [`lib/agents/db.ts`](/home/jared/Nexus-Terminal/lib/agents/db.ts), [`lib/agents/queue.ts`](/home/jared/Nexus-Terminal/lib/agents/queue.ts), [`lib/agents/runtime-limits.ts`](/home/jared/Nexus-Terminal/lib/agents/runtime-limits.ts), [`lib/agents/memory.ts`](/home/jared/Nexus-Terminal/lib/agents/memory.ts), [`lib/agents/context.ts`](/home/jared/Nexus-Terminal/lib/agents/context.ts), [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts), and [`lib/agents/checkpoints.ts`](/home/jared/Nexus-Terminal/lib/agents/checkpoints.ts).
- Added the Sprint 2 type additions in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts): `CircuitBreakerState`, `QueueClaimResult`, `RateLimitExceededError`, `CircuitOpenError`, and the narrowed `StepLogEntry.status`.
- Added focused coverage in `__tests__/agent-db.test.ts`, `__tests__/agent-queue.test.ts`, `__tests__/agent-runtime-limits.test.ts`, `__tests__/agent-memory.test.ts`, `__tests__/agent-context.test.ts`, `__tests__/agent-blueprint-runner.test.ts`, and `__tests__/agent-checkpoints.test.ts`.
- Kept Sprint 2 library-only: no `/api/agents/*`, no `services/**` work, no Compose cleanup, and no legacy `agent_memory` usage.

### Validation

- `npm run lint` OK
- `npx tsc --noEmit` OK
- `npm test` OK

### Archive Note

- The detailed Checkpoint 1-4 execution contracts, canonical SQL shapes, repair-retry policy, and crash-recovery tables were intentionally removed from `HANDOFF.md` now that Sprint 2 is closed. Recover via `git log -- HANDOFF.md` if needed.

---

## AEV2 Sprint 3 — Runtime Wiring + API Surface

> Generated: 2026-04-07 | Agent: Claude (Plan)
> Status: COMPLETE — Checkpoint 6 complete on 2026-04-08

### Objective

Connect the Sprint 2 library runtime to stable app contracts. Sprint 3 lands Discord delivery helpers, the agent config/blueprint registry, the generic worker loop + heartbeat + macro cron, and every `/api/agents/*` route with contract test coverage. After Sprint 3, Sprint 4 can focus purely on Docker containerization and launch hardening — no library or API work should bleed into it.

### Stories

- AEV2-307 — Discord embed and delivery utilities
- AEV2-308 — Wire agent configs, prompt loader, scrape-lite, and blueprints
- AEV2-309 — Worker heartbeat and generic worker loop
- AEV2-310 — Orchestrator macro cron
- AEV2-401 — `POST/GET /api/agents/service/chat`
- AEV2-402 — `GET /api/agents/reports` and `GET /api/agents/reports/[id]`
- AEV2-403 — `POST/GET /api/agents/research`
- AEV2-404 — `GET /api/agents/admin/stats` and `GET/DELETE /api/agents/admin/memory`
- AEV2-405 — `POST /api/agents/admin/redeliver`
- AEV2-406 — `GET /api/agents/macro-summary/latest`
- AEV2-407 — Route test coverage

### Current State

- Sprint 2 runtime is in place and validated. Every module listed in Sprint 2 Summary is library-only and does not import from `@/app` or `services/`.
- Checkpoint 1 is complete: [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts) and [`__tests__/agent-discord.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-discord.test.ts) are landed and validated. The 2026-04-08 review pass also pinned known webhook mappings, the no-webhook `delivery_failed` path, stored-row reuse as the delivery source of truth, and manual redelivery after an existing success marker.
- Checkpoint 2 is complete: [`lib/agents/scrape-lite.ts`](/home/jared/Nexus-Terminal/lib/agents/scrape-lite.ts), [`lib/agents/prompts-loader.ts`](/home/jared/Nexus-Terminal/lib/agents/prompts-loader.ts), [`lib/agents/config.ts`](/home/jared/Nexus-Terminal/lib/agents/config.ts), the stub blueprint files under [`lib/agents/blueprints/`](/home/jared/Nexus-Terminal/lib/agents/blueprints), and focused coverage in [`__tests__/agent-scrape-lite.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-scrape-lite.test.ts) plus [`__tests__/agent-config.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-config.test.ts) are landed and validated. The 2026-04-08 review patch kept the config registry side-effect free by deferring prompt-loader imports to runtime and extended the scrape-lite timeout to cover body reads.
- Checkpoint 3 is complete: [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts), [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts), [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts), [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts), additive runner contract updates in [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts) plus [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts), and focused coverage in [`__tests__/agent-blueprints.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprints.test.ts) with the updated runner coverage in [`__tests__/agent-blueprint-runner.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-blueprint-runner.test.ts) are landed and validated. The 2026-04-08 review patch also fixed slash-command specialist handoff so the routed job input keeps the command-body ticker instead of the first uppercase keyword.
- Checkpoint 4 is complete: [`lib/agents/heartbeat.ts`](/home/jared/Nexus-Terminal/lib/agents/heartbeat.ts), [`lib/agents/worker.ts`](/home/jared/Nexus-Terminal/lib/agents/worker.ts), [`lib/agents/macro-cron.ts`](/home/jared/Nexus-Terminal/lib/agents/macro-cron.ts), and focused coverage in [`__tests__/agent-worker.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-worker.test.ts) plus [`__tests__/agent-macro-cron.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-macro-cron.test.ts) are landed and validated. The 2026-04-08 patches made lease-loss finalizer failures explicit in the worker, moved the macro-cron claim/job/update flow into one transaction so failed ticks cannot wedge a trading day, renewed in-flight job leases during long blueprint runs, retried thrown runner preflight failures through the transient path, waited for in-flight heartbeat ticks before marking agents offline, and evaluated the macro cron immediately on startup inside the trigger hour.
- Checkpoint 5 is complete: the `/api/agents/*` route tree under [`app/api/agents/`](/home/jared/Nexus-Terminal/app/api/agents), [`lib/validations/agents.ts`](/home/jared/Nexus-Terminal/lib/validations/agents.ts), [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts), and the additive [`AdminStatsResponse`](/home/jared/Nexus-Terminal/lib/agents/types.ts) contract are landed and validated. The 2026-04-08 integration pass also made [`lib/server-db-utils.ts`](/home/jared/Nexus-Terminal/lib/server-db-utils.ts) lazy-load auth so non-auth routes can build without importing the OAuth stack, [`lib/auth-config.ts`](/home/jared/Nexus-Terminal/lib/auth-config.ts) degrade to an empty Google provider list instead of throwing at module import time when OAuth env vars are missing, and [`app/api/agents/reports/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/%5Bid%5D/route.ts) explicitly exclude `system-agent-user` rows.
- Checkpoint 6 is complete: [`__tests__/agent-service-chat-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-service-chat-route.test.ts), [`__tests__/agent-reports-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-reports-route.test.ts), [`__tests__/agent-research-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-research-route.test.ts), [`__tests__/agent-admin-stats-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-admin-stats-route.test.ts), [`__tests__/agent-admin-memory-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-admin-memory-route.test.ts), [`__tests__/agent-admin-redeliver-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-admin-redeliver-route.test.ts), and [`__tests__/agent-macro-summary-route.test.ts`](/home/jared/Nexus-Terminal/__tests__/agent-macro-summary-route.test.ts) are landed and validated. The 2026-04-08 review pass expanded route-contract coverage for the missing validation, auth, db-unavailable, ownership-filter, and stats-shape branches, and the Sprint 3 exit-gate validation passed in the `aev2-s3` worktree: `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm test`.
- `lib/agents/prompts/global-policy.md`, `orchestrator.md`, `small-cap.md`, and `swing-trader.md` already exist from Sprint 1. Sprint 3 adds a loader, not new prompt files.
- [`services/docker-compose.yml`](/home/jared/Nexus-Terminal/services/docker-compose.yml), [`services/.env.example`](/home/jared/Nexus-Terminal/services/.env.example), and the `services/discord-bot/` tree still reflect pre-AEV2 state. Sprint 3 does NOT touch them — Sprint 4 owns the Compose rewrite and the service container wiring.
- Root `tsconfig.json` still excludes `services/`. Sprint 3 must stay runnable under the existing root `tsc --noEmit` with no config changes.
- `lib/agents/llm-client.ts` exports `getInteractiveLlmConfig`, `getBackgroundLlmConfig`, `getLlmBudgetConfig`, and `callLlm(request, lane, overrides?)`. Sprint 3 consumes these directly.

### Scope

- **In scope:** `AEV2-307` through `AEV2-407`. New files under `lib/agents/`, new routes under `app/api/agents/`, new Zod schemas under `lib/validations/agents.ts`, and new route/test coverage under `__tests__/`.
- **Out of scope:** `services/**` files, `services/docker-compose.yml`, `services/agent.Dockerfile`, `services/agent-entrypoint.ts`, `services/discord-bot/` rewrites, `/tmp/healthy` real proof (library writes the file but Docker healthcheck wiring waits for Sprint 4), real webhook POSTs to Discord in tests, additional DB migrations, additional schema tables, seed data imports (`AEV2-311`), and any new npm dependency unless explicitly called out below.

### Decisions Locked For Sprint 3

These six decisions remove ambiguity before Codex starts. If any of them is wrong, update this section before execution — do NOT let Codex discover the ambiguity mid-sprint.

- **D1. Blueprint scope.** Sprint 3 implements exactly four blueprints: `orchestrator:chat`, `orchestrator:macro-summary`, `small-cap-trader:research`, and `swing-trader:research`. The scan blueprints (`small-cap-trader:pre-market-scan`, `swing-trader:momentum-scan`, `swing-trader:pattern-check`) are declared in `AGENT_CONFIGS[agentId].blueprints` and resolve normally, but `notImplementedBlueprint(name)` returns a stub blueprint whose only step throws `new NotImplementedBlueprintError(name)` at step execution time. The runner classifies that failure as `contract`, and the worker does not retry it. Sprint 4 or a follow-up sprint adds the scan bodies.
- **D2. Discord delivery proof.** Sprint 3 tests the delivery helpers with a mocked global `fetch`. Real webhook POSTs wait for Sprint 4 smoke runs when the Docker container actually boots. No manual REPL proof step in Sprint 3.
- **D3. Admin stats shape.** `GET /api/agents/admin/stats` returns the full JSON shape from `AGENTIC_EXPANSIONV2.md` §11 (circuitBreakers, today, thisMonth, agents, delivery, memory, macroSummaries) plus the Sprint 3 queue add-ons. The exact `AdminStatsResponse` shape and formulas are inlined below; the implementation must not depend on a second doc lookup.
- **D4. `scrape-headlines` URL source.** The macro-summary blueprint reads a new env var `MACRO_HEADLINES_URLS` (comma-separated URL list). Default when unset: `https://www.marketwatch.com/latest-news,https://finance.yahoo.com/topic/stock-market-news/`. The URL list is NOT hardcoded inside `scrape-lite.ts` — scrape-lite is a pure fetcher, the blueprint chooses what to fetch.
- **D5. Runtime contract changes are allowed and required.** Sprint 3 may make additive changes to [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts), [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts), and [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts) to support step runtime access (`job`, `db`, `agentConfig`), explicit routed-step skipping, `failureClass` propagation from `runBlueprint()`, and service-key-only auth checks for polling routes.
- **D6. Delivery semantics.** Report row dedupe is deterministic by `reportId = ${jobId}:${reportType}`. Automatic publish retries must reuse that row and must not repost after a recorded successful `discord-delivery:${reportId}` marker. Manual `redeliverReport()` is intentionally a new delivery attempt and may repost once per admin call; it does not claim route-level idempotent no-op semantics.

### Planned File Actions

**New library files (lib/agents/):**

- [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts) — embed builders, webhook delivery, deterministic report-row reuse + delivery dedupe helpers
- [`lib/agents/scrape-lite.ts`](/home/jared/Nexus-Terminal/lib/agents/scrape-lite.ts) — `fetchPageText(url)` HTML->text fetcher
- [`lib/agents/prompts-loader.ts`](/home/jared/Nexus-Terminal/lib/agents/prompts-loader.ts) — reads `lib/agents/prompts/*.md` at process start
- [`lib/agents/config.ts`](/home/jared/Nexus-Terminal/lib/agents/config.ts) — `AGENT_CONFIGS: Record<AgentId, AgentConfig>` registry + `resolveBlueprint(job)` helper
- [`lib/agents/blueprints/orchestrator-chat.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-chat.ts)
- [`lib/agents/blueprints/orchestrator-macro-summary.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/orchestrator-macro-summary.ts)
- [`lib/agents/blueprints/small-cap-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts)
- [`lib/agents/blueprints/swing-trader-research.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts)
- [`lib/agents/heartbeat.ts`](/home/jared/Nexus-Terminal/lib/agents/heartbeat.ts) — `startHeartbeat(db, agentId)` + `/tmp/healthy` touch
- [`lib/agents/worker.ts`](/home/jared/Nexus-Terminal/lib/agents/worker.ts) — `startWorker(config)` poll loop
- [`lib/agents/macro-cron.ts`](/home/jared/Nexus-Terminal/lib/agents/macro-cron.ts) — `startMacroCron(db)` scheduler
- [`lib/validations/agents.ts`](/home/jared/Nexus-Terminal/lib/validations/agents.ts) — Zod schemas for every new route body/query

**New API routes (app/api/agents/):**

- [`app/api/agents/service/chat/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/service/chat/route.ts) — POST + GET
- [`app/api/agents/reports/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/route.ts) — GET
- [`app/api/agents/reports/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/reports/[id]/route.ts) — GET
- [`app/api/agents/research/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/research/route.ts) — POST + GET
- [`app/api/agents/admin/stats/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/admin/stats/route.ts) — GET
- [`app/api/agents/admin/memory/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/admin/memory/route.ts) — GET + DELETE
- [`app/api/agents/admin/redeliver/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/admin/redeliver/route.ts) — POST
- [`app/api/agents/macro-summary/latest/route.ts`](/home/jared/Nexus-Terminal/app/api/agents/macro-summary/latest/route.ts) — GET

**New test files (__tests__/):**

- `__tests__/agent-discord.test.ts`
- `__tests__/agent-scrape-lite.test.ts`
- `__tests__/agent-config.test.ts`
- `__tests__/agent-blueprints.test.ts`
- `__tests__/agent-worker.test.ts`
- `__tests__/agent-macro-cron.test.ts`
- `__tests__/agent-service-chat-route.test.ts`
- `__tests__/agent-reports-route.test.ts`
- `__tests__/agent-research-route.test.ts`
- `__tests__/agent-admin-stats-route.test.ts`
- `__tests__/agent-admin-memory-route.test.ts`
- `__tests__/agent-admin-redeliver-route.test.ts`
- `__tests__/agent-macro-summary-route.test.ts`

**Existing files modified:**

- [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts) — additive runtime contract updates for Sprint 3 (`StepInput` runtime fields, `NotImplementedBlueprintError`, `AdminStatsResponse`, and any small response interfaces needed by the new routes/tests).
- [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts) — additive runtime behavior to pass `job` / `db` / `agentConfig` into steps, support explicit routed-step skipping, and return `failureClass` on failed runs.
- [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts) — add `requireServiceKey(request)` for service-key-only polling routes.
- [`HANDOFF.md`](/home/jared/Nexus-Terminal/HANDOFF.md) — updated after each checkpoint closes.

**Explicitly NOT modified:**

- `lib/db/schema.ts` (no new tables, no column changes)
- Any file under `services/`
- Any file under `app/api/` outside `app/api/agents/`
- `lib/llm-client.ts` (Vercel-side — do not cross-import)
- `middleware.ts` (agent service/admin routes are already covered because `middleware.ts` skips `/api/*`)

### Security And Correctness Notes

- `/api/agents/service/chat` POST uses `requireServiceAuth(request, body)` from [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts). `/api/agents/service/chat` GET uses `requireServiceKey(request)` because it authenticates the bot but does not map a Discord user from a body. `/api/agents/admin/*` routes use `requireAgentAdmin()`. User-auth routes (`/api/agents/reports`, `/api/agents/research`) use `requireUser()`. `/api/agents/macro-summary/latest` is public. Never mix the four patterns.
- `requireServiceAuth(request, body)` reads the already-parsed body; parse with `parseAndValidate()` first, then pass `parsed.data` into the auth call. Do not call `request.json()` twice. `requireServiceKey(request)` is the shared header-only helper for service polling.
- Service-chat POST success assumes the Discord-to-Nexus user mapping source is populated at runtime. Sprint 3 route tests mock the helper and do not depend on a real populated map in the repo.
- Every user-facing reports/research query must filter by `user_id = authenticatedUser.id` AND exclude `user_id = 'system-agent-user'` (system-owned autonomous reports never leak into user history).
- Discord webhook URLs live in env vars only. Never log the URL. Never accept a webhook URL from a request body.
- Automatic publish dedupe uses a deterministic `reportId = ${jobId}:${reportType}` row plus a successful-delivery marker `discord-delivery:${reportId}`. The row write must commit before any webhook POST. Exact-once external delivery is not claimed across the narrow crash window after Discord accepts a POST and before the DB update/marker write completes.
- `POST /api/agents/admin/redeliver` re-reads the stored `report_json` from `agent_reports` and retries ONLY the delivery portion. It must not regenerate the report via the LLM.
- Worker code paths route every lease-fenced mutation through Sprint 2 queue helpers (`claimNextQueuedJob`, `completeJob`, `failJob`, `scheduleJobRetry`, etc.). Job creators such as API routes, blueprint handoff steps, and macro cron may insert new queued jobs directly via `db.insert(agentJobs)` because they are creating work, not mutating a claimed lease-owned job.
- Research blueprints use [`getCachedTickerData(ticker)`](/home/jared/Nexus-Terminal/lib/askedgar.ts) (signature: `getCachedTickerData(ticker: string)`) as the canonical AskEdgar cache. `agent_memory_v2` may store derived agent facts if a blueprint needs them, but Sprint 3 does not introduce a second raw AskEdgar cache.
- `/tmp/healthy` file touch is library-level only. Sprint 4 wires the Docker healthcheck; Sprint 3 just writes the file so tests can verify the touch happens.
- Do not introduce any new npm dependency. The repo already has `zod`, `drizzle-orm`, `@neondatabase/serverless`, and Next.js 15's built-in `fetch` / `Response` — that is everything Sprint 3 needs.
- Do not touch `.env`, `.env.local`, or `services/.env`. Document any new env vars in `services/.env.example` ONLY if Sprint 3 must run without them; otherwise leave `.env.example` changes to Sprint 4.

### Execution Contracts

These rules are part of the Sprint 3 implementation contract. Codex should be able to build the runtime wiring and API surface from this section plus the live repo without consulting `AGENTIC_EXPANSIONV2.md`.

#### `lib/agents/discord.ts`

Exports exactly these symbols:

```ts
import type { AgentId, AgentReport } from './types';
import type { AgentDb } from './db';

export interface DiscordEmbedField { name: string; value: string; inline?: boolean }
export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;         // 0x10B981 (emerald-500) for V1
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;    // ISO
}
export interface DiscordWebhookPayload {
  username?: string;
  embeds: DiscordEmbed[];
}

// Report formatting — one builder per report_type.
export function buildScanEmbed(report: AgentReport): DiscordEmbed;
export function buildResearchEmbed(report: AgentReport): DiscordEmbed;
export function buildSwingSetupEmbed(report: AgentReport): DiscordEmbed;
export function buildSwingAlertEmbed(report: AgentReport): DiscordEmbed;
export function buildMacroSummaryEmbed(report: AgentReport): DiscordEmbed;
export function buildSystemEmbed(title: string, detail: string, severity: 'info' | 'warn' | 'error'): DiscordEmbed;

// Channel resolver — maps (agentId, report_type) to webhook env var name.
export function resolveWebhookUrl(agentId: AgentId, reportType: string): string | null;

// Write-then-deliver flow.
export async function writeAndDeliverReport(
  db: AgentDb,
  params: {
    jobId: string;
    userId: string;
    agentId: AgentId;
    reportType: string;
    title: string;
    summary: string | null;
    reportJson: unknown;
  },
): Promise<{ reportId: string; status: 'published' | 'delivery_failed'; deliveryError: string | null }>;

// Delivery-only path used by POST /api/agents/admin/redeliver.
export async function redeliverReport(
  db: AgentDb,
  reportId: string,
): Promise<{ status: 'published' | 'delivery_failed'; deliveryError: string | null }>;
```

Behavior contract:

- **Webhook URL resolution.** `resolveWebhookUrl` reads env vars by agent + reportType:
  - `orchestrator` + `macro-summary` -> `DISCORD_WEBHOOK_MACRO_DAILY`
  - `orchestrator` + `system-alert` or any `reportType` prefixed with `system-` -> `DISCORD_WEBHOOK_SYSTEM`
  - `small-cap-trader` + `pre-market-scan` -> `DISCORD_WEBHOOK_SCANS`
  - `small-cap-trader` + `research` -> `DISCORD_WEBHOOK_RESEARCH`
  - `swing-trader` + `momentum-scan` or `research` -> `DISCORD_WEBHOOK_SWING_SETUPS`
  - `swing-trader` + `pattern-check` -> `DISCORD_WEBHOOK_SWING_ALERTS`
  - Unknown combination -> return `null` and log once. Never throw.
- **`writeAndDeliverReport` order** (MUST match this sequence — it mirrors the V1 Discord-first publish flow):
  1. Build a deterministic `reportId = ${jobId}:${reportType}`.
  2. Read `agent_reports` by `reportId`. If no row exists, insert one with `id = reportId`, `status = 'published'`, `delivered_at = null`, and `delivery_error = null`. If a row already exists, reuse it and keep its stored `report_json` as the source of truth for retry paths.
  3. Commit the report-row write before any webhook POST.
  4. Check `recordStepEffect` state for `discord-delivery:${reportId}`. If a successful-delivery marker already exists, return `{ reportId, status: 'published', deliveryError: null }` without posting again.
  5. Resolve the webhook URL. If null, update the row to `status = 'delivery_failed'`, `delivery_error = 'no webhook configured for ${agentId}/${reportType}'`, and return.
  6. Build the embed via the correct `build*Embed` function and POST to the webhook with `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) })`.
  7. On HTTP 2xx: update `agent_reports` to `delivered_at = now()`, `status = 'published'`, then write the successful delivery marker `discord-delivery:${reportId}` using `effectType = 'discord-delivery'` and a fixed `stepName = 'discord-delivery'`. Return `{ reportId, status: 'published', deliveryError: null }`.
  8. On any other status or fetch throw: update `agent_reports` to `status = 'delivery_failed'`, `delivery_error = '<status code>: <truncated body>'`. Do NOT write the successful delivery marker. Return `{ reportId, status: 'delivery_failed', deliveryError }`. Do NOT throw — delivery failures are expected and must become data, not exceptions.
- **`redeliverReport`.** Re-reads the existing row by `reportId`, re-runs steps 5-8 above using the stored `report_json`, and records a fresh audit trail marker such as `discord-delivery:${reportId}:manual:${timestamp}` with `effectType = 'discord-delivery'` and fixed `stepName = 'discord-delivery-manual'` if an attempt log is needed. Manual redelivery is intentionally a new delivery attempt and may repost once per admin call. It does NOT call the LLM and does NOT modify `report_json`.
- **Embed builders.** Pure functions, no DB access, no fetch. Each reads fields from `report.report_json` and returns a `DiscordEmbed` with `color: 0x10B981`. Unknown fields fall back to string coercion; missing required fields render as `"n/a"`. Never throw.
- **No direct `agent_reports` writes outside this file.** Blueprint steps that need to publish results must call `writeAndDeliverReport` — they do NOT `db.insert(agentReports)` directly.

#### `lib/agents/scrape-lite.ts`

Pure fetcher. No URL list lives in this file.

```ts
export async function fetchPageText(url: string, options?: { timeoutMs?: number }): Promise<string>;
```

- Uses `fetch(url, { signal, headers: { 'User-Agent': 'Nexus-Agent/1.0', 'Accept': 'text/html' } })` with `AbortController` timeout (default 10000 ms).
- Strips `<script>`, `<style>`, all remaining HTML tags, decodes `&nbsp;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`.
- Normalizes whitespace (collapse runs of whitespace into a single space), trims.
- Returns the first 30000 characters.
- Throws on non-2xx response with the status code and truncated body (same `readFailureDetail` style as `lib/agents/llm-client.ts`).
- Pure function otherwise — no memory, no DB, no caching. Caching is the blueprint's responsibility.

#### `lib/agents/prompts-loader.ts`

```ts
import type { AgentId } from './types';

export function loadGlobalPolicyPrompt(): string;
export function loadRolePrompt(agentId: AgentId): string;
export function buildLlmSystemPrompt(agentId: AgentId): string;  // concatenates global-policy + role prompt
```

- Reads from `lib/agents/prompts/*.md` at module-load time (not per call). Use `fs.readFileSync(path.join(process.cwd(), 'lib/agents/prompts', ...), 'utf8')`.
- Cache the file contents in a module-level `const` so repeated calls do not re-read. Tests should use `vi.mock('node:fs')` to override.
- `buildLlmSystemPrompt(agentId)` returns `${globalPolicy}\n\n---\n\n${rolePrompt}` — a single string the blueprint runner passes into `callLlm({ systemPrompt, ... })`.
- Throws at module load if any of the four expected files is missing. Fail fast — prompts are load-bearing and a missing file is a deployment bug.

#### `lib/agents/config.ts`

```ts
import type { AgentId, AgentConfig, AgentJob, Blueprint } from './types';
import { orchestratorChatBlueprint } from './blueprints/orchestrator-chat';
import { orchestratorMacroSummaryBlueprint } from './blueprints/orchestrator-macro-summary';
import { smallCapResearchBlueprint } from './blueprints/small-cap-research';
import { swingTraderResearchBlueprint } from './blueprints/swing-trader-research';

export const AGENT_CONFIGS: Record<AgentId, AgentConfig> = {
  orchestrator: {
    id: 'orchestrator',
    displayName: 'Orchestrator',
    llmLane: 'interactive',
    temperature: 0.3,
    capabilities: ['chat', 'macro-summary'],
    rolePromptPath: 'lib/agents/prompts/orchestrator.md',
    blueprints: {
      chat: orchestratorChatBlueprint,
      'macro-summary': orchestratorMacroSummaryBlueprint,
    },
    blueprintResolver: (job) => resolveFromCapabilities('orchestrator', job),
  },
  'small-cap-trader': {
    id: 'small-cap-trader',
    displayName: 'Small Cap Trader',
    llmLane: 'background',
    temperature: 0.2,
    capabilities: ['research', 'pre-market-scan'],
    rolePromptPath: 'lib/agents/prompts/small-cap.md',
    blueprints: {
      research: smallCapResearchBlueprint,
      'pre-market-scan': notImplementedBlueprint('small-cap-trader:pre-market-scan'),
    },
    blueprintResolver: (job) => resolveFromCapabilities('small-cap-trader', job),
  },
  'swing-trader': {
    id: 'swing-trader',
    displayName: 'Swing Trader',
    llmLane: 'background',
    temperature: 0.2,
    capabilities: ['research', 'momentum-scan', 'pattern-check'],
    rolePromptPath: 'lib/agents/prompts/swing-trader.md',
    blueprints: {
      research: swingTraderResearchBlueprint,
      'momentum-scan': notImplementedBlueprint('swing-trader:momentum-scan'),
      'pattern-check': notImplementedBlueprint('swing-trader:pattern-check'),
    },
    blueprintResolver: (job) => resolveFromCapabilities('swing-trader', job),
  },
};

export function resolveBlueprint(job: AgentJob): Blueprint {
  const config = AGENT_CONFIGS[job.agentId];
  if (!config) throw new Error(`unknown agent: ${job.agentId}`);
  return config.blueprintResolver(job);
}
```

- `notImplementedBlueprint(name)` returns a `Blueprint` with a single `code` step whose `run()` throws `new NotImplementedBlueprintError(name)`. Per D1, the scan blueprints are declared but unusable in Sprint 3.
- `resolveFromCapabilities(agentId, job)` throws if `job.jobType` is not in `capabilities[agentId]`, otherwise returns `AGENT_CONFIGS[agentId].blueprints[job.jobType]`. If the resolved blueprint is the `notImplementedBlueprint`, still return it — the runner will fail the job at step-execution time, which is where D1 says the gate lives.
- No side effects at module load. `AGENT_CONFIGS` is a plain const.

#### Additive runtime contract (`lib/agents/types.ts` + `lib/agents/blueprint-runner.ts`)

Sprint 3 intentionally extends the Sprint 2 runner contract. This is required work, not optional cleanup.

- `StepInput` grows additive runtime fields: `job: AgentJob`, `db: AgentDb`, and `agentConfig: AgentConfig`. Step implementations may destructure these directly from the existing single `input` object.
- `StepMetadata` grows `skipWhenRouted?: boolean`. The Orchestrator's `synthesize-response` step uses this.
- `RunBlueprintResult` grows optional `failureClass?: FailureClass`.
- Runner skip semantics: if `step.metadata.skipWhenRouted === true` and `previousOutput.decision === 'route-to-specialist'`, the runner skips the step, appends a completed step-log entry with `tokensUsed: 0`, and carries `previousOutput` forward unchanged as the next input/final output.
- Runner failure classification: `NotImplementedBlueprintError` is classified as `contract`, not `transient`.

#### `lib/agents/blueprints/orchestrator-chat.ts`

Two steps. Step 1 is deterministic code, step 2 is an LLM call — only reached when the Orchestrator handles the request itself.

```ts
import { z } from 'zod';
import type { Blueprint } from '../types';

const chatInputSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  channel: z.enum(['web', 'discord']).default('discord'),
});

const routeDecisionSchema = z.object({
  decision: z.enum(['handle-directly', 'route-to-specialist', 'fallback-to-self']),
  targetAgentId: z.enum(['orchestrator', 'small-cap-trader', 'swing-trader']).nullable(),
  specialistJobType: z.enum(['research']).nullable(),
  specialistJobId: z.string().nullable(),
  warning: z.string().nullable(),
  message: z.string(),
});

export const orchestratorChatBlueprint: Blueprint = {
  id: 'orchestrator:chat',
  description: 'V1 Orchestrator chat — deterministic routing + self-synthesis fallback.',
  steps: [
    {
      name: 'classify-and-route',
      type: 'code',
      inputSchema: chatInputSchema,
      outputSchema: routeDecisionSchema,
      metadata: { canRetry: true, timeoutMs: 5000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ jobInput, context: _ctx, job, db }) => {
        // 1. Slash-command prefix wins.
        // 2. Keyword match for data-signal routing (small cap, dilution, short, offering -> small-cap-trader).
        // 3. Keyword match for swing/momentum/MDR/parabolic -> swing-trader.
        // 4. Otherwise handle-directly.
        // 5. If routed target is offline/degraded in agent_registry, emit warning + fallback-to-self.
        // Return object matching routeDecisionSchema.
      },
    },
    {
      name: 'synthesize-response',
      type: 'llm',
      inputSchema: routeDecisionSchema,
      outputSchema: z.object({ content: z.string().min(1) }),
      metadata: { canRetry: true, timeoutMs: 30000, maxRepairAttempts: 1, sideEffect: false, lane: 'interactive', skipWhenRouted: true },
      run: async ({ previousOutput: _prev, context: _ctx }) => {
        // Only reached when step 1 returned decision === 'handle-directly' OR 'fallback-to-self'.
        // When decision === 'route-to-specialist', step 2 is skipped by the runner via
        // metadata.skipWhenRouted and the step 1 output becomes the final blueprint output.
        // Use callLlm({ systemPrompt: buildLlmSystemPrompt('orchestrator'), userMessage: ..., temperature: 0.3 }, 'interactive')
      },
    },
  ],
};
```

Contract notes:

- **Step 1 routing rules (deterministic, no LLM):**
  - `^\s*/research\s+` -> `targetAgentId = 'small-cap-trader'`, `specialistJobType = 'research'`
  - `^\s*/(swing|momentum)\s+` -> `targetAgentId = 'swing-trader'`, `specialistJobType = 'research'`
  - message matches `/\b(dilution|offering|ATM|shelf|424B|S-3|short[- ]sell)\b/i` -> `small-cap-trader`, `research`
  - message matches `/\b(MDR|multi[- ]day[- ]runner|parabolic|momentum|breakout)\b/i` -> `swing-trader`, `research`
  - Otherwise `decision = 'handle-directly'`, `targetAgentId = null`, `specialistJobType = null`.
- **Availability check.** After picking a specialist, read `agent_registry.status` for that agent. If `status !== 'online'`, set `decision = 'fallback-to-self'`, fill `warning = '${agentId} is ${status}, handling request directly'`, and let step 2 run.
- **Handoff enqueue.** When `decision = 'route-to-specialist'`, step 1's `run()` inserts a new `agent_jobs` row via the injected `db`/`job` runtime fields (this is allowed — it is a code step, not a queue-helper boundary violation). The insert sets `id = randomUUID()`, `agent_id = targetAgentId`, `user_id = job.userId`, `job_type = 'research'`, `status = 'queued'`, `input = { ticker: extractedTicker, originator_job_id: job.id }`. The step then returns `{ decision: 'route-to-specialist', targetAgentId, specialistJobType: 'research', specialistJobId, warning: null, message: 'routed' }`.
- **Runner-level short-circuit for routed jobs.** The runner skips step 2 when `previousOutput.decision === 'route-to-specialist'` and `step.metadata.skipWhenRouted === true`. The worker loop then sees the final blueprint output from step 1 and writes `result = { routed: true, specialistJobId }` into the orchestrator job.
- **Ticker extraction.** Regex `/\b[A-Z]{1,5}\b/` against the message, first match. If no match, `extractedTicker = null` and the specialist handoff still happens (the specialist blueprint validates ticker).

#### `lib/agents/blueprints/orchestrator-macro-summary.ts`

Four steps per `AGENTIC_EXPANSIONV2.md` §6 Blueprint `orchestrator:macro-summary`.

```ts
export const orchestratorMacroSummaryBlueprint: Blueprint = {
  id: 'orchestrator:macro-summary',
  description: 'Daily macro briefing — headlines + market snapshot + LLM synthesis + persisted report.',
  steps: [
    {
      name: 'scrape-headlines',
      type: 'code',
      outputSchema: z.object({ headlines: z.array(z.object({ url: z.string(), text: z.string() })) }),
      metadata: { canRetry: true, timeoutMs: 20000, maxRepairAttempts: 0, sideEffect: false },
      run: async () => {
        const urls = (process.env.MACRO_HEADLINES_URLS ?? 'https://www.marketwatch.com/latest-news,https://finance.yahoo.com/topic/stock-market-news/').split(',').map((u) => u.trim()).filter(Boolean);
        const headlines = [];
        for (const url of urls) {
          try {
            const text = await fetchPageText(url);
            headlines.push({ url, text: text.slice(0, 8000) });
          } catch (err) {
            headlines.push({ url, text: `[fetch failed: ${(err as Error).message}]` });
          }
        }
        return { status: 'completed', data: { headlines }, metrics: { durationMs: 0, attempt: 1 }, provenance: { sourceIds: urls, upstreamStepIds: [], timestamp: new Date().toISOString() } };
      },
    },
    {
      name: 'fetch-market-snapshot',
      type: 'code',
      metadata: { canRetry: true, timeoutMs: 15000, maxRepairAttempts: 0, sideEffect: false },
      // Fetches index/sector/commodity prices via the canonical Massive client at
      // lib/massive-market.ts. Use `fetchUnifiedSnapshot(tickers)` (signature:
      // `fetchUnifiedSnapshot(tickers: string[])`) with a fixed list of macro-relevant
      // tickers — at minimum: ['SPY', 'QQQ', 'IWM', 'DIA', 'XLE', 'XLF', 'XLK', 'GLD', 'USO', 'TLT'].
      // Do NOT build a fresh fetcher — reuse the existing client so it inherits auth, retry,
      // and error handling from the rest of the app.
      // If MASSIVE_API_KEY is unset (check via process.env before calling), return
      // { snapshot: null, note: 'no massive api key' }. The client throws on missing key,
      // so the env-var guard avoids surfacing that as a step failure in dev.
      run: async () => { /* ... */ },
    },
    {
      name: 'generate-briefing',
      type: 'llm',
      inputSchema: z.object({ headlines: z.array(z.object({ url: z.string(), text: z.string() })), snapshot: z.unknown().nullable() }),
      outputSchema: z.object({
        summary: z.string(),
        keyEvents: z.array(z.string()),
        sectorNotes: z.array(z.string()),
        confidence: z.enum(['high', 'medium', 'low']),
      }),
      metadata: { canRetry: true, timeoutMs: 60000, maxRepairAttempts: 1, sideEffect: false, lane: 'background' },
      // Uses callLlm(..., 'background'). Overrides the Orchestrator's default 'interactive' lane.
      run: async () => { /* ... */ },
    },
    {
      name: 'save-summary',
      type: 'code',
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async () => {
        // Calls writeAndDeliverReport(db, { jobId, userId: 'system-agent-user', agentId: 'orchestrator',
        //   reportType: 'macro-summary', title: '<date> macro briefing', summary, reportJson })
      },
    },
  ],
};
```

Contract notes:

- **Save-step idempotency owner.** Save steps do not use runner-level `idempotencyKey` placeholders in Sprint 3. `writeAndDeliverReport()` owns report-row reuse and successful-delivery dedupe for these steps.
- **Macro summary ownership.** The save-summary step always writes with `userId = 'system-agent-user'`. The orchestrator-macro-summary blueprint is the only Sprint 3 blueprint that runs against the system user.
- **Massive API absence.** If `MASSIVE_API_KEY` is unset, step 2 returns a `null` snapshot and the step succeeds. Step 3 handles a null snapshot gracefully. This keeps Sprint 3 runnable in dev without Massive credentials.

#### `lib/agents/blueprints/small-cap-research.ts`

Four steps: fetch filings from AskEdgar via the canonical shared cache, fetch price/volume from a direct TradingView scanner call, synthesize the report, then persist/deliver the stored report. Do NOT call `/api/tradingview/gainers` over HTTP from a worker.

```ts
export const smallCapResearchBlueprint: Blueprint = {
  id: 'small-cap-trader:research',
  description: 'Short-sell / dilution research for a single ticker.',
  steps: [
    {
      name: 'fetch-filings',
      type: 'code',
      inputSchema: z.object({ ticker: z.string().regex(/^[A-Z]{1,5}$/) }),
      outputSchema: z.object({ ticker: z.string(), filings: z.array(z.unknown()), cashPosition: z.unknown().nullable() }),
      metadata: { canRetry: true, timeoutMs: 30000, maxRepairAttempts: 0, sideEffect: false },
      // Uses getCachedTickerData(ticker) as the canonical upstream AskEdgar cache, then
      // shapes the response into the step output required by the blueprint.
      run: async () => { /* ... */ },
    },
    {
      name: 'fetch-price-context',
      type: 'code',
      metadata: { canRetry: true, timeoutMs: 15000, maxRepairAttempts: 0, sideEffect: false },
      run: async () => { /* ... */ },
    },
    {
      name: 'synthesize-report',
      type: 'llm',
      outputSchema: z.object({
        ticker: z.string(),
        dilutionRisk: z.enum(['very-high', 'high', 'medium', 'low']),
        offeringAbility: z.enum(['immediate', 'delayed', 'blocked']),
        filingSummary: z.string(),
        catalysts: z.array(z.string()),
        confidence: z.enum(['high', 'medium', 'low']),
        evidenceIds: z.array(z.string()),
      }),
      metadata: { canRetry: true, timeoutMs: 60000, maxRepairAttempts: 1, sideEffect: false, lane: 'background' },
      run: async () => { /* calls callLlm(..., 'background') */ },
    },
    {
      name: 'save-research',
      type: 'code',
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async () => { /* calls writeAndDeliverReport with reportType: 'research' */ },
    },
  ],
};
```

Contract notes:

- **AskEdgar caching.** Step 1 calls `getCachedTickerData(ticker)` (signature: `getCachedTickerData(ticker: string)` from `lib/askedgar.ts`) as the canonical shared cache for raw AskEdgar data. The ticker arg is required — pass the normalized ticker from the step input. If the blueprint wants to persist derived facts in `agent_memory_v2`, that write is additive and must not replace the shared cache.
- **TradingView price context.** Step 2 does NOT call `/api/tradingview/gainers` over HTTP and does NOT refactor the existing route in Sprint 3. Instead, it uses a private helper local to the blueprint file that mirrors the TradingView scanner request shape already used in [`app/api/tradingview/gainers/route.ts`](/home/jared/Nexus-Terminal/app/api/tradingview/gainers/route.ts) and returns only the price/volume fields the research blueprint needs.
- **Ticker normalization.** Step 1 uppercases and trims the incoming ticker before any external call. The step input schema should be tightened to `z.object({ ticker: z.string().regex(/^[A-Z]{1,5}$/) })` so invalid or missing tickers fail as non-retriable contract errors.
- **Report ownership.** `userId = job.userId` — research reports belong to the user who requested them, never to `system-agent-user`.

#### `lib/agents/blueprints/swing-trader-research.ts`

Same four-step shape as small-cap-research, but the LLM focuses on MDR similarity scoring, momentum indicators, and entry/stop/target levels. Schema:

```ts
outputSchema: z.object({
  ticker: z.string(),
  mdrSimilarity: z.number().min(0).max(100),
  volumeSurgeRatio: z.number(),
  levels: z.object({ entry: z.number(), stop: z.number(), targets: z.array(z.number()) }),
  recommendation: z.enum(['HOLD', 'ADD', 'TRIM', 'EXIT', 'WATCH']),
  patternClassification: z.enum(['BREAKOUT', 'EXHAUSTION', 'CONTINUATION', 'STOPPED']),
  confidence: z.enum(['high', 'medium', 'low']),
  evidenceIds: z.array(z.string()),
}),
```

Uses `callLlm(..., 'background')`. Same save-research step shape. Same user-owned report.

Contract notes:

- **Upstream inputs.** Sprint 3 uses the same two upstream data sources as `small-cap-research`: Step 1 calls `getCachedTickerData(ticker)` for filings/context, and Step 2 uses the same blueprint-local TradingView helper shape described above for price/volume context. The differentiation is in the synthesis prompt and output schema, not the transport layer.

#### `lib/agents/heartbeat.ts`

```ts
export interface HeartbeatHandle { stop: () => Promise<void> }
export function startHeartbeat(db: AgentDb, agentId: AgentId, intervalMs?: number): HeartbeatHandle;
```

- `intervalMs` defaults to 30000 ms.
- On each tick:
  1. `UPDATE agent_registry SET last_heartbeat = now(), status = 'online' WHERE id = ${agentId}`
  2. Touch `/tmp/healthy` with `fs.writeFileSync('/tmp/healthy', new Date().toISOString())`.
- Errors during the UPDATE are caught and logged (`console.error`) but do NOT kill the tick. The next tick retries.
- `stop()` clears the interval, writes one final `UPDATE agent_registry SET status = 'offline'`, and awaits it.
- Tests inject a fake `AgentDb`, mock `node:fs`, and advance vi fake timers to prove both the UPDATE and the file touch happen per tick.

#### `lib/agents/worker.ts`

```ts
import type { AgentConfig, WorkerConfig } from './types';

export interface WorkerHandle { stop: () => Promise<void> }

export async function startWorker(config: WorkerConfig & { agentConfig: AgentConfig }): Promise<WorkerHandle>;
```

Behavior contract:

- `startWorker()` resolves its DB internally via `getAgentDb()`. If that returns `null`, it throws `new Error('Database not configured')` before marking the agent online or starting heartbeat/polling. Worker tests should therefore mock `getAgentDb()` rather than threading a DB through the public signature.
- On start: writes/updates the agent's `agent_registry` row to `status = 'online'`, then starts `startHeartbeat(db, agentId)`, then begins the poll loop.
- Poll loop:
  1. `const claim = await claimNextQueuedJob(db, agentId, workerId)` where `workerId = '${agentId}:${process.pid}'`.
  2. If null, `await sleep(pollIntervalMs)` and continue.
  3. If claimed: resolve the blueprint via `config.agentConfig.blueprintResolver(claim.job)`.
  4. Call `runBlueprint(blueprint, claim.job, config.agentConfig, db, { lockedBy: workerId, leaseVersion: claim.leaseVersion })`.
  5. **Result packaging for the orchestrator routed-job case.** If `claim.job.agentId === 'orchestrator' && claim.job.jobType === 'chat'` and the runner's `finalOutput` contains `{ decision: 'route-to-specialist', specialistJobId, ... }`, the worker writes `result = { routed: true, specialistJobId }`. Otherwise `result = finalOutput`. Then call `completeJob(db, job.id, workerId, leaseVersion, result)`.
  6. If `runBlueprint` returns `{ status: 'failed', failureReason, failureClass }`, branch:
     - `failureClass === 'transient'` and `claim.job.attempt < claim.job.maxAttempts` -> `scheduleJobRetry(db, job.id, workerId, leaseVersion, new Date(Date.now() + calculateBackoffMs(claim.job.attempt)), failureReason)`.
     - Otherwise -> `failJob(db, job.id, workerId, leaseVersion, failureReason)`.
  7. Loop.
- Graceful shutdown: `stop()` sets an internal `shuttingDown = true` flag. The poll loop checks it before claiming a new job. If a job is in flight, the loop awaits the current `runBlueprint` call (does NOT cancel) and then exits. After the loop exits, call the heartbeat `stop()`.
- Backoff helper lives inline: `function calculateBackoffMs(attempt: number) { return Math.pow(4, attempt - 1) * 2000 }` — 2s, 8s, 32s at attempts 1, 2, 3.
- Stale-job reaper: OUT OF SCOPE for Sprint 3. The reaper is listed as a worker-level concern in `AGENTIC_EXPANSIONV2.md` but the plan explicitly defers it. Do NOT add a reaper in Sprint 3.
- Worker tests mock `claimNextQueuedJob`, `completeJob`, `failJob`, `scheduleJobRetry`, and `runBlueprint`, then advance fake timers to drive the loop through claim -> run -> complete and claim -> run -> retry transitions.

#### `lib/agents/macro-cron.ts`

```ts
export interface MacroCronHandle { stop: () => Promise<void> }
export function startMacroCron(db: AgentDb, options?: { hourEt?: number; checkIntervalMs?: number }): MacroCronHandle;
```

Behavior contract:

- `hourEt` defaults to `Number(process.env.MACRO_CRON_HOUR) || 6`. `checkIntervalMs` defaults to 60000 ms.
- Tick logic (every `checkIntervalMs`):
  1. Compute the current hour and date in `America/New_York` using `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' })`. The result gives `tradingDate = 'YYYY-MM-DD'` and `currentHour`.
  2. If `currentHour !== hourEt`, return — not the trigger hour.
  3. Attempt to claim a scheduled run row via a single SQL:
     ```sql
     INSERT INTO agent_scheduled_runs (id, agent_id, trigger_type, trading_date, status, started_at, created_at)
     VALUES (${randomUUID()}, 'orchestrator', 'macro-summary', ${tradingDate}, 'running', now(), now())
     ON CONFLICT (agent_id, trigger_type, trading_date) DO NOTHING
     RETURNING id;
     ```
     If zero rows returned, another tick already claimed the run — skip.
  4. If one row returned: insert a new `agent_jobs` row with `id = randomUUID()`, `agent_id = 'orchestrator'`, `user_id = 'system-agent-user'`, `job_type = 'macro-summary'`, `status = 'queued'`, `input = { tradingDate }`. Then update the scheduled-run row with `job_id = <new job id>`, `status = 'completed'`, `completed_at = now()`.
- `stop()` clears the interval. No DB write on stop — the scheduled-run row stays in whatever state the last tick left it.
- Only the Orchestrator process calls `startMacroCron`. Sprint 4's `services/agent-entrypoint.ts` wires it; Sprint 3 just ships the library.
- Tests mock `db.execute` / `db.insert` / `db.update` and advance fake timers to drive the tick. Verify the ON CONFLICT path skips without inserting a new job.

#### `lib/validations/agents.ts`

Define every Zod schema used by a Sprint 3 route in one file. Follow the naming pattern in `lib/validations/trades.ts`.

```ts
import { z } from 'zod';

export const serviceChatPostSchema = z.object({
  message: z.string().min(1).max(4000),
  session_id: z.string().min(1).max(64).optional(),
  discord_user_id: z.string().min(1),
  channel: z.literal('discord'),
});
export type ServiceChatPostInput = z.infer<typeof serviceChatPostSchema>;

export const serviceChatGetQuerySchema = z.object({
  job_id: z.string().min(1),
});

export const reportsListQuerySchema = z.object({
  status: z.enum(['published', 'delivery_failed', 'archived']).optional(),
  agent_id: z.enum(['orchestrator', 'small-cap-trader', 'swing-trader']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const researchPostSchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,5}$/),
  agent_id: z.enum(['small-cap-trader', 'swing-trader']),
});

export const adminMemoryListQuerySchema = z.object({
  user_id: z.string().optional(),
  agent_id: z.enum(['orchestrator', 'small-cap-trader', 'swing-trader']).optional(),
  category: z.string().optional(),
});
export const adminMemoryDeleteSchema = z.object({ id: z.string().min(1) });

export const redeliverSchema = z.object({ report_id: z.string().min(1) });
```

Do NOT inline schemas in route files. Every route imports from `@/lib/validations/agents`.

#### Route Contracts

Each route below lists path, method, auth, request shape, response shape, and error paths. Codex implements each file exactly once.

- **DB-backed route guard.** Every DB-backed route in this section uses `const db = getAgentDb(); if (!db) return dbUnavailable();` before any query or write. The earlier step-by-step lists omit repeated mentions in a few places; this guard is still required on every DB-backed `/api/agents/*` route, including list/detail/admin routes and `GET /api/agents/macro-summary/latest`.

##### `app/api/agents/service/chat/route.ts`

**POST** — `x-agent-service-key` header; body = `ServiceChatPostInput`.

1. `parseAndValidate(request, serviceChatPostSchema)` -> `{ data }` or 400.
2. `requireServiceAuth(request, data)` -> `{ user, discordUserId }` or 400/401/403 Response.
3. `const db = getAgentDb()`. If null, return `Response.json({ error: 'Database not configured' }, { status: 503 })`.
4. `await ensureUser(db, user)` so the mapped service user exists before any FK-backed insert.
5. Resolve or create `session_id`: if provided, use it; otherwise `randomUUID()`.
6. Insert a row into `agent_conversations` with `id = randomUUID()`, `role = 'user'`, `content = data.message`, `channel = 'discord'`, `user_id = user.id`, `agent_id = 'orchestrator'`, `session_id`.
7. Insert a new `agent_jobs` row: `id = randomUUID()`, `agent_id = 'orchestrator'`, `user_id = user.id`, `job_type = 'chat'`, `status = 'queued'`, `input = { message: data.message, session_id, channel: 'discord', discord_user_id: discordUserId }`, `priority = 0`, `max_attempts = 3`.
8. Return `Response.json({ job_id, session_id, agent_id: 'orchestrator' }, { status: 201 })`.

**GET** — `x-agent-service-key` header; query = `job_id`.

1. Parse `job_id` via `serviceChatGetQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))`.
2. `requireServiceKey(request)` -> `null` or 401 Response.
3. `getAgentDb()` or 503.
4. `SELECT id, agent_id, status, progress_note, input, result, error_message, step_log FROM agent_jobs WHERE id = ${job_id}`. If no row, 404 `{ error: 'job not found' }`.
5. Return the correct status variant from `AGENTIC_EXPANSIONV2.md` §13:
   - `queued` -> `{ status: 'queued', job_id, agent_id, progress_note: null }`
   - `processing` -> `{ status: 'processing', job_id, agent_id, progress_note }`
   - `completed` with `result.routed === true` -> `{ status: 'completed', job_id, agent_id, result: { routed: true, specialistJobId: result.specialistJobId } }`
   - `completed` otherwise -> `{ status: 'completed', job_id, agent_id, session_id: result.session_id ?? input.session_id ?? null, result: { message: result.content ?? result.message ?? '' } }` (read `content` or `message` — blueprints may put either)
   - `failed` -> `{ status: 'failed', job_id, agent_id, error: { message: error_message, failureClass: <parsed from stepLog tail if present> } }`

##### `app/api/agents/reports/route.ts`

**GET** — `requireUser()`.

1. Parse query via `reportsListQuerySchema`.
2. Query `agent_reports` with `user_id = user.id AND user_id <> 'system-agent-user'` plus optional `status` and `agent_id` filters, ordered by `created_at DESC`, limit = `query.limit ?? 50`.
3. Return `{ reports: [{ id, agent_id, report_type, status, title, created_at }] }`.

##### `app/api/agents/reports/[id]/route.ts`

**GET** — `requireUser()`.

> **Next.js 15 dynamic params are async.** Match the existing repo pattern in [`app/api/trades/[id]/route.ts`](/home/jared/Nexus-Terminal/app/api/trades/[id]/route.ts): the handler signature is `export async function GET(_request: Request, context: { params: Promise<{ id: string }> })`, and the id is unpacked via `const { id } = await context.params;` before any DB call. Do NOT read `params.id` synchronously — it will fail to compile under Next.js 15.

1. Unpack `const { id } = await context.params;`.
2. `SELECT * FROM agent_reports WHERE id = ${id} AND user_id = ${user.id} LIMIT 1`.
3. If no row, 404. If row, return `{ report: { id, agent_id, report_type, status, report_json } }`.

##### `app/api/agents/research/route.ts`

**POST** — `requireUser()`; body = `researchPostSchema`.

1. Parse + auth.
2. `const db = getAgentDb()`. If null, return 503.
3. `await ensureUser(db, user)` before inserting the job row.
4. `SELECT status FROM agent_registry WHERE id = ${data.agent_id}`. If `status !== 'online'`, return 400 `{ error: 'agent unavailable', agent_id, status }` (AEV2-403 contract — reject, do not silently queue).
5. Insert `agent_jobs` row: `id = randomUUID()`, `agent_id = data.agent_id`, `user_id = user.id`, `job_type = 'research'`, `input = { ticker: data.ticker }`, `status = 'queued'`.
6. Return `{ job_id, agent_id, job_type: 'research' }`.

**GET** — `requireUser()`.

1. `SELECT id, agent_id, report_type, report_json -> 'ticker' AS ticker FROM agent_reports WHERE user_id = ${user.id} AND user_id <> 'system-agent-user' AND report_type = 'research' ORDER BY created_at DESC LIMIT 50`.
2. Return `{ reports: [{ id, agent_id, report_type, ticker }] }`.

##### `app/api/agents/admin/stats/route.ts`

**GET** — `requireAgentAdmin()`.

Return this exact `AdminStatsResponse` shape:

```ts
{
  circuitBreakers: Record<string, { status: 'closed' | 'open' | 'half-open'; consecutiveFailures: number; lastFailureAt: string | null }>;
  today: {
    totalRequests: number;
    totalTokens: number;
    estimatedCostCents: number;
    successRate: number;
    avgDurationMs: number;
    validationFailureRate: number;
    retryRate: number;
    byLane: Record<string, { totalRequests: number; totalTokens: number; estimatedCostCents: number; successRate: number; avgDurationMs: number }>;
    byAgent: Record<string, { totalRequests: number; totalTokens: number; estimatedCostCents: number; successRate: number; avgDurationMs: number }>;
  };
  thisMonth: {
    totalTokens: number;
    estimatedCostCents: number;
    budgetCents: number;
    budgetUsedPercent: number;
  };
  agents: Array<{ id: string; displayName: string; status: string; lastHeartbeat: string | null }>;
  delivery: {
    publishedToday: number;
    deliveryFailures: number;
    deliveryFailureRate: number;
  };
  memory: {
    total: number;
    byCategory: Record<string, number>;
  };
  macroSummaries: {
    latestGeneratedAt: string | null;
  };
  queue: {
    depth: number;
    oldestQueuedJobAgeSeconds: number | null;
    stuckProcessing: number;
  };
}
```

Query/formula plan:

- `circuitBreakers`: `SELECT id, config -> 'circuitBreaker' FROM agent_registry`.
- `circuitBreakers` mapping uses the Sprint 2 stored shape in `agent_registry.config.circuitBreaker`, which currently persists `{ consecutiveFailures, openedAt }` rather than a separate `lastFailureAt`.
- `circuitBreakers.status`: `'closed'` when `openedAt` is null, `'open'` when `openedAt` is within the last 60 seconds, and `'half-open'` when `openedAt` is older than 60 seconds but the self-heal path has not reset the row yet.
- `circuitBreakers.lastFailureAt`: map from `openedAt`. This remains `null` until the breaker has actually opened because Sprint 2 does not persist pre-threshold failure timestamps.
- `today.*`: aggregates over `agent_request_log` where `created_at >= start of current UTC day`.
- `today.byLane`: `GROUP BY lane`.
- `today.byAgent`: `GROUP BY agent_id`.
- `today.validationFailureRate`: `contract-failed jobs created today / jobs created today`; use `0` when the denominator is `0`. A job counts as `contract-failed` when its final `step_log` entry has `errorClass = 'contract'`.
- `today.retryRate`: `jobs created today with attempt > 1 / jobs created today`; use `0` when the denominator is `0`.
- `thisMonth.*`: aggregates over `agent_request_log` where `created_at >= first of current UTC month`. Include `budgetCents` from `getLlmBudgetConfig().monthlyBudgetCents` and `budgetUsedPercent`.
- `agents`: `SELECT id, display_name, status, last_heartbeat FROM agent_registry`.
- `delivery.publishedToday`: `SELECT count(*) FROM agent_reports WHERE status = 'published' AND created_at >= start of current UTC day`.
- `delivery.deliveryFailures`: same with `status = 'delivery_failed'`.
- `delivery.deliveryFailureRate`: `deliveryFailures / (publishedToday + deliveryFailures)`; use `0` when the denominator is `0`.
- `memory.total` and `memory.byCategory`: over `agent_memory_v2`.
- `macroSummaries.latestGeneratedAt`: latest published macro report's `created_at`.
- `queue.depth`: queued jobs eligible to run now (`status = 'queued'` and `next_retry_at IS NULL OR next_retry_at <= now()`).
- `queue.oldestQueuedJobAgeSeconds`: age of the oldest eligible queued job in seconds; `null` when no eligible queued jobs exist.
- `queue.stuckProcessing`: jobs in `processing` where `lock_expires_at < now()` OR `last_heartbeat_at < now() - interval '10 minutes'`.

##### `app/api/agents/admin/memory/route.ts`

**GET** — `requireAgentAdmin()`; query = `adminMemoryListQuerySchema`.

1. Query `agent_memory_v2` with optional filters on `user_id`, `agent_id`, `category`, limit 200, order by `updated_at DESC`.
2. Return `{ memory: [{ id, user_id, agent_id, category, key }] }`.

**DELETE** — `requireAgentAdmin()`; body = `adminMemoryDeleteSchema`.

1. `DELETE FROM agent_memory_v2 WHERE id = ${data.id}`.
2. Return `{ deleted: true }`. If the delete affected zero rows, return 404 `{ error: 'memory row not found' }`.

##### `app/api/agents/admin/redeliver/route.ts`

**POST** — `requireAgentAdmin()`; body = `redeliverSchema`.

1. `const db = getAgentDb()`. If null, return 503.
2. `SELECT id FROM agent_reports WHERE id = ${data.report_id} LIMIT 1`. If no row, return 404 `{ error: 'report not found' }`.
3. `const result = await redeliverReport(db, data.report_id)`.
4. Return `{ report_id: data.report_id, status: result.status }`.

##### `app/api/agents/macro-summary/latest/route.ts`

**GET** — no auth (public read; matches `AGENTIC_EXPANSIONV2.md` §13).

1. `SELECT created_at AS generated_at, report_json AS content FROM agent_reports WHERE user_id = 'system-agent-user' AND agent_id = 'orchestrator' AND report_type = 'macro-summary' AND status = 'published' ORDER BY created_at DESC LIMIT 1`.
2. If no row, return `{ summary: null }` with 200.
3. Otherwise return `{ summary: { generated_at, content } }`.

#### Route Test Mocking Pattern (AEV2-407)

All route tests follow the pattern in `__tests__/trades-route.test.ts`. Key rules:

- Use `vi.hoisted(() => ({ ... }))` to create the mock functions.
- `vi.mock('@/lib/agents/db', () => ({ getAgentDb: getAgentDbMock }))`.
- `vi.mock('@/lib/agents/admin', () => ({ requireAgentAdmin: requireAgentAdminMock, requireServiceAuth: requireServiceAuthMock, requireServiceKey: requireServiceKeyMock }))`.
- `vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock, ensureUser: ensureUserMock, dbUnavailable: ... }))`.
- `vi.mock('@/lib/agents/discord', () => ({ writeAndDeliverReport: writeAndDeliverReportMock, redeliverReport: redeliverReportMock }))` for the redeliver route.
- Import the route handler AFTER the mocks: `import { POST, GET } from '@/app/api/agents/service/chat/route'`.
- Build the DB mock by returning chained fluent mocks matching what the route calls (`insert().values()`, `select().from().where()`, etc.). Use `makeDb()`-style helper functions inside each test file.
- Required coverage per AEV2-407:
  - Success paths for every method
  - 400 on validation failures (missing required fields, bad enum values)
  - 401 on missing or invalid service/admin key
  - 403 on unknown Discord user for service/chat POST
  - 404 on unknown job/report/memory id
  - 503 when `getAgentDb()` returns null
  - For `GET /api/agents/service/chat`: prove the three state variants (queued / processing / completed / failed) and the routed-completed variant
  - For redeliver route tests: prove success, `delivery_failed`, 404, and admin auth failure. Delivery-attempt dedupe and manual redelivery repost behavior belong in `__tests__/agent-discord.test.ts`, not the route test.
  - For reports list: prove `user_id = 'system-agent-user'` rows are excluded
  - For research POST: prove an offline agent returns 400, not a queued job

### Order Of Operations

1. Land Discord delivery helpers first so blueprints can call them.
2. Land scrape-lite + prompts loader + config registry skeleton next. Blueprint files import from the registry, so the registry must exist first as a shell.
3. Land the four implemented blueprints and wire them into `AGENT_CONFIGS`.
4. Land heartbeat + worker loop + macro cron.
5. Land validation schemas + API routes.
6. Land route tests last — they depend on every route file.

### Checkpoint 1 — Discord Delivery Helpers

**Stories:** `AEV2-307`

**Review focus:** confirm `writeAndDeliverReport()` reuses a deterministic report row, only writes the successful delivery marker after a 2xx webhook POST, and converts webhook failures into stored `delivery_failed` state instead of exceptions.

**Suggested commit:** `feat(aev2): add agent discord embed and delivery helpers`

**Check off before commit**

- [x] `lib/agents/discord.ts` exists and exports exactly the symbols listed in the execution contract (`DiscordEmbed`, `DiscordWebhookPayload`, five `build*Embed` functions, `resolveWebhookUrl`, `writeAndDeliverReport`, `redeliverReport`).
- [x] `writeAndDeliverReport` uses `reportId = ${jobId}:${reportType}` as the deterministic row key and `discord-delivery:${reportId}` as the successful-delivery marker.
- [x] `resolveWebhookUrl` maps every (agentId, reportType) combination listed in the contract and returns `null` for unknowns without throwing.
- [x] Webhook POST uses `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) })` and respects a 10s AbortController timeout.
- [x] HTTP 2xx sets `status = 'published'` and `delivered_at = now()`, then writes the successful delivery marker. Non-2xx or fetch throw sets `status = 'delivery_failed'` with `delivery_error` populated. Neither path throws to the caller.
- [x] `redeliverReport` re-reads the stored `report_json`, performs a fresh delivery attempt only, and does not call the LLM or rewrite `report_json`.
- [x] `__tests__/agent-discord.test.ts` covers: happy-path write+deliver, repeat automatic publish reuses the existing report row and short-circuits after a recorded successful-delivery marker, HTTP 500 becomes `delivery_failed`, `fetch` throw becomes `delivery_failed`, `resolveWebhookUrl` unknown combo returns null, and manual redeliver posts again as a fresh admin-triggered attempt.

**Exit criteria**

- [x] Automatic retries reuse the same `agent_reports` row and do not repost after a recorded successful delivery marker.
- [x] Delivery failure becomes observable state, not a thrown exception.
- [x] No blueprint file yet imports from `discord.ts` — blueprints land in Checkpoint 3.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npx vitest run __tests__/agent-discord.test.ts`

**STOP. Review. Commit. Then continue.**

### Checkpoint 2 — Scrape-Lite, Prompt Loader, Config Registry

**Stories:** `AEV2-308` (part 1)

**Review focus:** confirm `scrape-lite.ts` is a pure fetcher, `prompts-loader.ts` fails fast on missing files, and `AGENT_CONFIGS` is a plain const with no side effects.

**Suggested commit:** `feat(aev2): add agent scrape-lite, prompts loader, and config registry skeleton`

**Check off before commit**

- [x] `lib/agents/scrape-lite.ts` exports only `fetchPageText(url, options?)`. No URL list in this file.
- [x] `fetchPageText` strips `<script>`, `<style>`, HTML tags, decodes the five listed entities, normalizes whitespace, returns first 30000 chars, uses a 10s AbortController timeout, and throws on non-2xx with the status + truncated body.
- [x] `lib/agents/prompts-loader.ts` exports `loadGlobalPolicyPrompt`, `loadRolePrompt`, and `buildLlmSystemPrompt`. Files are read once at module load and cached in a module-level const.
- [x] `buildLlmSystemPrompt('orchestrator')` returns `${globalPolicy}\n\n---\n\n${orchestratorPrompt}`.
- [x] `lib/agents/config.ts` exports `AGENT_CONFIGS` and `resolveBlueprint(job)`. The four implemented blueprints are imported; the three scan blueprints are declared via `notImplementedBlueprint(name)` helper.
- [x] The config file compiles even though the blueprint files are still empty stubs — use minimal named stub exports in the blueprint files for this checkpoint and fill them in Checkpoint 3.
- [x] `__tests__/agent-scrape-lite.test.ts` covers: happy-path HTML->text, entity decoding, 30k cap, non-2xx throw, and timeout behavior with `vi.useFakeTimers()`.
- [x] `__tests__/agent-config.test.ts` covers: every `AgentId` resolves an `AgentConfig`, `resolveBlueprint` throws on unknown `agentId`, `notImplementedBlueprint` surfaces the expected error at `step.run()` invocation time.

**Exit criteria**

- [x] Prompts fail fast at module load if any file is missing.
- [x] Scrape-lite is reusable by any blueprint — no URL hardcoding.
- [x] Config registry compiles and routes can import `resolveBlueprint` even before blueprint bodies land.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npx vitest run __tests__/agent-scrape-lite.test.ts __tests__/agent-config.test.ts`

**STOP. Review. Commit. Then continue.**

### Checkpoint 3 — Blueprint Implementations

**Stories:** `AEV2-308` (part 2)

**Review focus:** confirm the four implemented blueprints match their execution contracts: deterministic routing for orchestrator:chat, routed-step skipping via runner metadata, writeAndDeliverReport for every save step, and `lane: 'background'` for macro synthesis.

**Suggested commit:** `feat(aev2): implement sprint 3 agent blueprints`

**Check off before commit**

- [x] `lib/agents/blueprints/orchestrator-chat.ts` exports `orchestratorChatBlueprint` with two steps. Step 1 `classify-and-route` is deterministic (no LLM call), enforces the five routing rules verbatim, checks `agent_registry.status`, and enqueues the specialist handoff when needed. Step 2 `synthesize-response` uses `callLlm(..., 'interactive')` with `buildLlmSystemPrompt('orchestrator')`.
- [x] `lib/agents/blueprints/orchestrator-macro-summary.ts` exports four steps matching the contract. Step 1 reads `MACRO_HEADLINES_URLS` env with the documented default. Step 3 uses `lane: 'background'`. Step 4 uses `writeAndDeliverReport` with `userId = 'system-agent-user'`.
- [x] `lib/agents/blueprints/small-cap-research.ts` exports four steps. Step 1 calls `getCachedTickerData(ticker)` as the upstream AskEdgar cache (passing the normalized ticker arg — the function signature requires it), Step 2 uses a direct TradingView scanner call instead of an HTTP call into `/api/tradingview/gainers`, Step 3 uses `lane: 'background'`, and Step 4 uses `writeAndDeliverReport` with `userId = job.userId` and `reportType = 'research'`.
- [x] `lib/agents/blueprints/swing-trader-research.ts` exports four steps with the MDR-focused output schema. Same save-research contract.
- [x] `lib/agents/blueprint-runner.ts` is extended (additive only) to inject `job` / `db` / `agentConfig` into step input, support `skipWhenRouted`, and return `failureClass` on failed runs.
- [x] `__tests__/agent-blueprints.test.ts` covers: orchestrator routing (each rule branches correctly), orchestrator offline-specialist fallback, macro-summary step 3 using the background lane, small-cap AskEdgar cache hit/miss, research save step using `writeAndDeliverReport`.

**Exit criteria**

- [x] All four implemented blueprints are callable through `resolveBlueprint(job)` in tests.
- [x] Scan blueprints still fail at step execution time — not at import time — and the worker treats them as non-retriable contract failures.
- [x] Runner changes are limited to the additive Sprint 3 runtime contract described above.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npx vitest run __tests__/agent-blueprints.test.ts __tests__/agent-blueprint-runner.test.ts`

**STOP. Review. Commit. Then continue.**

### Checkpoint 4 — Heartbeat, Worker Loop, Macro Cron

**Stories:** `AEV2-309`, `AEV2-310`

**Review focus:** confirm the worker loop claims through `claimNextQueuedJob`, packages the orchestrator routed-job result correctly, and retries only on `transient` failure class. Confirm the macro cron uses `INSERT ... ON CONFLICT DO NOTHING` for dedupe.

**Suggested commit:** `feat(aev2): add agent worker loop, heartbeat, and macro cron`

**Check off before commit**

- [x] `lib/agents/heartbeat.ts` exports `startHeartbeat(db, agentId, intervalMs?)` returning `{ stop }`. Each tick updates `agent_registry.last_heartbeat` and `status = 'online'`, and touches `/tmp/healthy`. Errors are logged, not rethrown. `stop()` sets `status = 'offline'`.
- [x] `lib/agents/worker.ts` exports `startWorker(config)` returning `{ stop }`. The poll loop calls `claimNextQueuedJob` / `runBlueprint` / `completeJob` in the canonical order from the execution contract.
- [x] Routed orchestrator jobs return `result = { routed: true, specialistJobId }` via the worker's result packager — not via blueprint logic.
- [x] Retry branch: `failureClass === 'transient' && attempt < maxAttempts` -> `scheduleJobRetry` with `calculateBackoffMs`. Otherwise `failJob`.
- [x] Not-implemented blueprints fail as non-retriable contract failures and end in `failJob` with the blueprint error message.
- [x] Graceful shutdown waits for the in-flight `runBlueprint` to finish but does not cancel it. Heartbeat `stop()` runs after the loop exits.
- [x] `lib/agents/macro-cron.ts` exports `startMacroCron(db, options?)` returning `{ stop }`. Tick checks `currentHour === hourEt` in `America/New_York`, claims the scheduled run with `INSERT ... ON CONFLICT (agent_id, trigger_type, trading_date) DO NOTHING RETURNING id`, uses `trigger_type = 'macro-summary'` and `status = 'running'` for the claimed row, and only enqueues an `agent_jobs` row when the insert returned a row.
- [x] Stale-job reaper is NOT implemented in Sprint 3 (out of scope per the contract).
- [x] `__tests__/agent-worker.test.ts` uses `vi.useFakeTimers()` and covers: claim happy path, empty-claim sleep, routed-job result packaging, transient failure scheduling a retry, non-transient failure failing the job, and graceful shutdown draining one in-flight job.
- [x] `__tests__/agent-macro-cron.test.ts` covers: tick outside the trigger hour skips, tick inside the trigger hour inserts the scheduled run + enqueues the job, and concurrent ticks (simulated via two insert calls) only produce one job.

**Exit criteria**

- [x] The worker loop routes every lease-fenced mutation through Sprint 2 queue helpers.
- [x] Macro cron is deduped by `(agent_id, trigger_type, trading_date)`.
- [x] Heartbeat touches `/tmp/healthy` on every tick.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npx vitest run __tests__/agent-worker.test.ts __tests__/agent-macro-cron.test.ts`

**STOP. Review. Commit. Then continue.**

### Checkpoint 5 — API Routes

**Stories:** `AEV2-401`, `AEV2-402`, `AEV2-403`, `AEV2-404`, `AEV2-405`, `AEV2-406`

**Review focus:** confirm every route uses the correct auth helper (`requireServiceAuth` / `requireServiceKey` / `requireAgentAdmin` / `requireUser`), user-facing routes exclude `system-agent-user` rows, and the admin stats route returns the explicit Sprint 3 stats shape.

**Suggested commit:** `feat(aev2): add /api/agents/* routes and validation schemas`

**Check off before commit**

- [x] `lib/validations/agents.ts` exists and exports every schema listed in the execution contract. Route files import from `@/lib/validations/agents`.
- [x] `app/api/agents/service/chat/route.ts` implements POST and GET per the contract. POST inserts one `agent_conversations` row and one `agent_jobs` row. GET returns the five state variants from `AGENTIC_EXPANSIONV2.md` §13.
- [x] `app/api/agents/reports/route.ts` (GET) excludes `user_id = 'system-agent-user'` rows.
- [x] `app/api/agents/reports/[id]/route.ts` (GET) scopes to `user_id = user.id`.
- [x] `app/api/agents/research/route.ts` POST rejects offline/degraded specialists with 400 `{ error: 'agent unavailable' }`. GET lists user-owned research reports only.
- [x] `app/api/agents/admin/stats/route.ts` returns the explicit `AdminStatsResponse` shape from the execution contract, including `today.retryRate`, `delivery.deliveryFailureRate`, and the top-level `queue` block.
- [x] `app/api/agents/admin/memory/route.ts` GET filters by query params and DELETE returns 404 on missing id.
- [x] `app/api/agents/admin/redeliver/route.ts` delegates to `redeliverReport()` and returns `{ report_id, status }`.
- [x] `app/api/agents/macro-summary/latest/route.ts` queries system-owned macro report and returns `{ summary: null }` on empty state.
- [x] No route file calls `request.json()` directly — all parsing goes through `parseAndValidate`.
- [x] No route file writes to `agent_jobs`, `agent_reports`, or `agent_memory_v2` outside of `db.insert()` / `db.update()` / `db.delete()` on the imported schema — no raw `sql` template writes.

**Exit criteria**

- [x] Every route listed in AEV2-401 through AEV2-406 is reachable and compiles.
- [x] Validation schemas are centralized in `lib/validations/agents.ts`.
- [x] Admin stats shape matches the launch target so Sprint 4 can focus on deployment.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build` (proves every route compiles under Next.js)

**STOP. Review. Commit. Then continue.**

### Checkpoint 6 — Route Test Coverage (AEV2-407 Gate)

**Stories:** `AEV2-407`

**Review focus:** confirm every required coverage row is exercised, mocks follow the `__tests__/trades-route.test.ts` pattern, and no test touches a real DB or real webhook.

**Suggested commit:** `test(aev2): add agent api route contract tests`

**Check off before commit**

- [x] `__tests__/agent-service-chat-route.test.ts` covers POST success (201), POST 400 missing `discord_user_id`, POST 401 invalid service key, POST 403 unknown Discord user, POST 503 on `getAgentDb() === null`, GET queued/processing/completed/failed/routed variants, GET 404 on unknown job_id.
- [x] `__tests__/agent-reports-route.test.ts` covers GET list success, GET list filtered by `status` + `agent_id`, GET list excludes `system-agent-user` rows, GET detail success, GET detail 404, auth failure 401.
- [x] `__tests__/agent-research-route.test.ts` covers POST success, POST 400 invalid ticker, POST 400 on offline/degraded specialist, GET list success, GET list excludes system-owned rows.
- [x] `__tests__/agent-admin-stats-route.test.ts` covers the full stats response shape (at minimum asserts the top-level keys exist), 401 on missing admin key, and the `queue.depth` / `queue.stuckProcessing` fields populate from mocked query results.
- [x] `__tests__/agent-admin-memory-route.test.ts` covers GET with filters, GET without filters, DELETE success, DELETE 404, 401 on missing admin key.
- [x] `__tests__/agent-admin-redeliver-route.test.ts` covers success (mocks `redeliverReport` to return `published`), `delivery_failed`, 401 on missing admin key, and 404 on unknown report_id. Redelivery repost behavior is covered in `__tests__/agent-discord.test.ts`.
- [x] `__tests__/agent-macro-summary-route.test.ts` covers happy path, empty state returning `{ summary: null }`, and query targets `user_id = 'system-agent-user'` + `report_type = 'macro-summary'`.
- [x] No test calls the real `fetch` or a real Neon connection. `global.fetch` is mocked via `vi.stubGlobal('fetch', vi.fn())` where needed.

**Exit criteria**

- [x] Every row in the AEV2-407 coverage matrix (success, auth failure, validation failure, lease-fencing-sensitive state transitions, redelivery, offline fallback) is exercised by a test.
- [x] Test files follow the `vi.hoisted` + `vi.mock` pattern from `__tests__/trades-route.test.ts`.
- [x] `npm test` passes without network access.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

**STOP. Review. Commit. This is the Sprint 3 exit gate.**

### Sprint 3 Exit Gate

- [x] `AEV2-307` through `AEV2-407` landed in checkpoint order.
- [x] Every new file lives under `lib/agents/`, `lib/validations/`, `app/api/agents/`, or `__tests__/`. No file under `services/` was modified.
- [x] `lib/db/schema.ts` unchanged. No new migrations.
- [x] All four implemented blueprints compile and can be resolved via `resolveBlueprint(job)`. Scan blueprints throw `'blueprint not implemented in Sprint 3'` at step execution.
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run build`
- [x] `npm test`
- [x] `HANDOFF.md` updated after the final checkpoint closes.

### Complexity

- Overall complexity: `XL` (largest sprint in the AEV2 buildout — touches runtime wiring, app routes, and the contract-test layer).
- Highest-risk checkpoint: Checkpoint 4 (worker loop + macro cron) because it is where Sprint 2 queue fencing meets real job lifecycle. A bug here corrupts lease state for every downstream sprint.
- Second-highest-risk checkpoint: Checkpoint 1 (Discord delivery). Idempotency key mistakes here mean duplicate reports or duplicate webhook posts in production. The two-marker design is load-bearing.
