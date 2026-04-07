# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Sprint 1 and Sprint 2 are complete. Older detail was removed from this file; use git history and `AEV2_PLAN.md` for archived context.

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
> Status: READY FOR CODEX

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
- No `/api/agents/*` route exists yet. Sprint 3 creates all of them.
- `lib/agents/config.ts`, `lib/agents/discord.ts`, `lib/agents/scrape-lite.ts`, `lib/agents/worker.ts`, `lib/agents/heartbeat.ts`, `lib/agents/macro-cron.ts`, and `lib/agents/blueprints/` do not exist yet. Sprint 3 creates them.
- `lib/agents/prompts/global-policy.md`, `orchestrator.md`, `small-cap.md`, and `swing-trader.md` already exist from Sprint 1. Sprint 3 adds a loader, not new prompt files.
- [`services/docker-compose.yml`](/home/jared/Nexus-Terminal/services/docker-compose.yml), [`services/.env.example`](/home/jared/Nexus-Terminal/services/.env.example), and the `services/discord-bot/` tree still reflect pre-AEV2 state. Sprint 3 does NOT touch them — Sprint 4 owns the Compose rewrite and the service container wiring.
- Root `tsconfig.json` still excludes `services/`. Sprint 3 must stay runnable under the existing root `tsc --noEmit` with no config changes.
- `lib/agents/llm-client.ts` exports `getInteractiveLlmConfig`, `getBackgroundLlmConfig`, `getLlmBudgetConfig`, and `callLlm(request, lane, overrides?)`. Sprint 3 consumes these directly.

### Scope

- **In scope:** `AEV2-307` through `AEV2-407`. New files under `lib/agents/`, new routes under `app/api/agents/`, new Zod schemas under `lib/validations/agents.ts`, and new route/test coverage under `__tests__/`.
- **Out of scope:** `services/**` files, `services/docker-compose.yml`, `services/agent.Dockerfile`, `services/agent-entrypoint.ts`, `services/discord-bot/` rewrites, `/tmp/healthy` real proof (library writes the file but Docker healthcheck wiring waits for Sprint 4), real webhook POSTs to Discord in tests, additional DB migrations, additional schema tables, seed data imports (`AEV2-311`), and any new npm dependency unless explicitly called out below.

### Decisions Locked For Sprint 3

These four decisions remove ambiguity before Codex starts. If any of them is wrong, update this section before execution — do NOT let Codex discover the ambiguity mid-sprint.

- **D1. Blueprint scope.** Sprint 3 implements exactly four blueprints: `orchestrator:chat`, `orchestrator:macro-summary`, `small-cap-trader:research`, and `swing-trader:research`. The scan blueprints (`small-cap-trader:pre-market-scan`, `swing-trader:momentum-scan`, `swing-trader:pattern-check`) are declared in `AGENT_CAPABILITIES` but their blueprint objects throw `new Error('blueprint not implemented in Sprint 3')` at registry lookup time. Sprint 4 or a follow-up sprint adds the scan bodies.
- **D2. Discord delivery proof.** Sprint 3 tests the delivery helpers with a mocked global `fetch`. Real webhook POSTs wait for Sprint 4 smoke runs when the Docker container actually boots. No manual REPL proof step in Sprint 3.
- **D3. Admin stats shape.** `GET /api/agents/admin/stats` returns the full JSON shape from `AGENTIC_EXPANSIONV2.md` §11 (circuitBreakers, today, thisMonth, agents, delivery, memory, macroSummaries). Stubbed subset is not acceptable — Sprint 4 launch hardening expects the full shape to already exist.
- **D4. `scrape-headlines` URL source.** The macro-summary blueprint reads a new env var `MACRO_HEADLINES_URLS` (comma-separated URL list). Default when unset: `https://www.marketwatch.com/latest-news,https://finance.yahoo.com/topic/stock-market-news/`. The URL list is NOT hardcoded inside `scrape-lite.ts` — scrape-lite is a pure fetcher, the blueprint chooses what to fetch.

### Planned File Actions

**New library files (lib/agents/):**

- [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts) — embed builders, webhook delivery, report-write + delivery idempotency helpers
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

- [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts) — add `AdminStatsResponse`, `DiscordEmbed`, `DiscordWebhookPayload`, and `ServiceChatResponse` interfaces only if the new code cannot express them without duplication. No behavioral changes to existing types.
- [`HANDOFF.md`](/home/jared/Nexus-Terminal/HANDOFF.md) — updated after each checkpoint closes.

**Explicitly NOT modified:**

- `lib/db/schema.ts` (no new tables, no column changes)
- Any file under `services/`
- Any file under `app/api/` outside `app/api/agents/`
- `lib/llm-client.ts` (Vercel-side — do not cross-import)
- `middleware.ts` (agent service/admin routes are already covered because `middleware.ts` skips `/api/*`)

### Security And Correctness Notes

- `/api/agents/service/*` routes use `requireServiceAuth()` from [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts). `/api/agents/admin/*` routes use `requireAgentAdmin()`. User-facing routes (`/api/agents/reports`, `/api/agents/research`, `/api/agents/macro-summary/latest`) use `requireUser()` from [`lib/server-db-utils.ts`](/home/jared/Nexus-Terminal/lib/server-db-utils.ts). Never mix the three.
- `requireServiceAuth(request, body)` reads the already-parsed body; parse with `parseAndValidate()` first, then pass `parsed.data` into the auth call. Do not call `request.json()` twice.
- Every user-facing reports/research query must filter by `user_id = authenticatedUser.id` AND exclude `user_id = 'system-agent-user'` (system-owned autonomous reports never leak into user history).
- Discord webhook URLs live in env vars only. Never log the URL. Never accept a webhook URL from a request body.
- Delivery idempotency uses TWO separate markers per report: `report-write:${jobId}:${stepName}` for the DB row and `discord-delivery:${reportId}` for the webhook POST. `recordStepEffect()` enforces uniqueness on the idempotency key; re-running a step with the same key must NOT duplicate the `agent_reports` row or re-POST to Discord.
- `POST /api/agents/admin/redeliver` re-reads the stored `report_json` from `agent_reports` and retries ONLY the delivery portion. It must not regenerate the report via the LLM.
- Worker and macro cron code paths write to DB only via Sprint 2 helpers (`claimNextQueuedJob`, `completeJob`, `failJob`, etc.). No Sprint 3 file issues raw `db.update(agentJobs)...` calls — all mutations go through `lib/agents/queue.ts`.
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
  - `orchestrator` + any system alert -> `DISCORD_WEBHOOK_SYSTEM`
  - `small-cap-trader` + `pre-market-scan` -> `DISCORD_WEBHOOK_SCANS`
  - `small-cap-trader` + `research` -> `DISCORD_WEBHOOK_RESEARCH`
  - `swing-trader` + `momentum-scan` or `research` -> `DISCORD_WEBHOOK_SWING_SETUPS`
  - `swing-trader` + `pattern-check` -> `DISCORD_WEBHOOK_SWING_ALERTS`
  - Unknown combination -> return `null` and log once. Never throw.
- **`writeAndDeliverReport` order** (MUST match this sequence — it mirrors the V1 Discord-first publish flow):
  1. Build `reportId = crypto.randomUUID()`.
  2. Call `recordStepEffect(db, { jobId, stepName: 'write-report', effectType: 'report-write', idempotencyKey: '${jobId}:write-report:report-write' })`. If it returns `false`, the row already exists — re-read it by `job_id + report_type` and skip to step 4.
  3. Insert the `agent_reports` row with `status = 'published'`, `delivered_at = null`, `delivery_error = null`.
  4. Call `recordStepEffect(db, { jobId, stepName: 'deliver-report', effectType: 'discord-delivery', idempotencyKey: 'discord-delivery:${reportId}' })`. If it returns `false`, delivery already happened — return `{ reportId, status: 'published', deliveryError: null }`.
  5. Resolve the webhook URL. If null, update the row to `status = 'delivery_failed'`, `delivery_error = 'no webhook configured for ${agentId}/${reportType}'`, and return.
  6. Build the embed via the correct `build*Embed` function and POST to the webhook with `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) })`.
  7. On HTTP 2xx: update `agent_reports` to `delivered_at = now()`, `status = 'published'`. Return `{ reportId, status: 'published', deliveryError: null }`.
  8. On any other status or fetch throw: update `agent_reports` to `status = 'delivery_failed'`, `delivery_error = '<status code>: <truncated body>'`. Return `{ reportId, status: 'delivery_failed', deliveryError }`. Do NOT throw — delivery failures are expected and must become data, not exceptions.
- **`redeliverReport`.** Re-reads the existing row by `reportId`, re-runs steps 5-8 above using the stored `report_json` and a fresh `discord-delivery:${reportId}:retry-${timestamp}` idempotency key so the retry is not short-circuited by the original delivery marker. Does NOT call the LLM and does NOT modify `report_json`.
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

- `notImplementedBlueprint(name)` returns a `Blueprint` with a single `code` step whose `run()` throws `new Error('blueprint not implemented in Sprint 3: ${name}')`. Per D1, the scan blueprints are declared but unusable in Sprint 3.
- `resolveFromCapabilities(agentId, job)` throws if `job.jobType` is not in `capabilities[agentId]`, otherwise returns `AGENT_CONFIGS[agentId].blueprints[job.jobType]`. If the resolved blueprint is the `notImplementedBlueprint`, still return it — the runner will fail the job at step-execution time, which is where D1 says the gate lives.
- No side effects at module load. `AGENT_CONFIGS` is a plain const.

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
      run: async ({ jobInput, context: _ctx }) => {
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
      metadata: { canRetry: true, timeoutMs: 30000, maxRepairAttempts: 1, sideEffect: false, lane: 'interactive' },
      run: async ({ previousOutput: _prev, context: _ctx }) => {
        // Only reached when step 1 returned decision === 'handle-directly' OR 'fallback-to-self'.
        // When decision === 'route-to-specialist', step 2 is skipped by the runner because the
        // step 1 code also enqueues a new agent_jobs row for the specialist and completes the
        // orchestrator job with { routed: true, specialistJobId }.
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
- **Handoff enqueue.** When `decision = 'route-to-specialist'`, step 1's `run()` inserts a new `agent_jobs` row via `getAgentDb()` directly (this is allowed — it is a code step, not a queue-helper boundary violation). The insert sets `agent_id = targetAgentId`, `user_id = job.userId`, `job_type = 'research'`, `status = 'queued'`, `input = { ticker: extractedTicker, originator_job_id: job.id }`. The step then returns `{ decision: 'route-to-specialist', targetAgentId, specialistJobType: 'research', warning: null, message: 'routed' }`.
- **Runner-level short-circuit for routed jobs.** The runner treats step 2 as skippable when `previousOutput.decision === 'route-to-specialist'`. The blueprint expresses this by leaving step 2 as the final step; the worker loop (not the runner) checks the final output and, when it sees `routed: true`, writes `result = { routed: true, specialistJobId: <new job id> }` into the orchestrator job. The blueprint itself does NOT need special-case runner logic — the worker's result-packaging code handles it.
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
      // Fetches index/sector/commodity prices from Massive API using MASSIVE_API_KEY.
      // If MASSIVE_API_KEY is unset, return { snapshot: null, note: 'no massive api key' }.
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
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true, idempotencyKey: 'PLACEHOLDER' },
      // idempotencyKey is assigned by the runner at call time using ${job.id}:save-summary:report-write
      // -- see the Execution Contracts note below on how blueprint metadata keys interact with the runner.
      run: async () => {
        // Calls writeAndDeliverReport(db, { jobId, userId: 'system-agent-user', agentId: 'orchestrator',
        //   reportType: 'macro-summary', title: '<date> macro briefing', summary, reportJson })
      },
    },
  ],
};
```

Contract notes:

- **Idempotency key template.** The runner today reads `step.metadata.idempotencyKey` as-is. Sprint 3 adds a small convention: if the key equals `'PLACEHOLDER'`, the runner substitutes `${job.id}:${step.name}:report-write` before calling `recordStepEffect`. This keeps the template co-located with the step without hardcoding job IDs at blueprint construction time. Implement the substitution inside `lib/agents/blueprint-runner.ts` as an additive change — do NOT rewrite the existing idempotency logic.
- **Macro summary ownership.** The save-summary step always writes with `userId = 'system-agent-user'`. The orchestrator-macro-summary blueprint is the only Sprint 3 blueprint that runs against the system user.
- **Massive API absence.** If `MASSIVE_API_KEY` is unset, step 2 returns a `null` snapshot and the step succeeds. Step 3 handles a null snapshot gracefully. This keeps Sprint 3 runnable in dev without Massive credentials.

#### `lib/agents/blueprints/small-cap-research.ts`

Three steps: fetch filings from AskEdgar, fetch price/volume from TradingView (via the existing `/api/tradingview/gainers` route OR a direct TradingView scanner call — agent code MAY call the Vercel route over HTTP using `process.env.NEXUS_API_URL`), synthesize the report.

```ts
export const smallCapResearchBlueprint: Blueprint = {
  id: 'small-cap-trader:research',
  description: 'Short-sell / dilution research for a single ticker.',
  steps: [
    {
      name: 'fetch-filings',
      type: 'code',
      inputSchema: z.object({ ticker: z.string().min(1) }),
      outputSchema: z.object({ ticker: z.string(), filings: z.array(z.unknown()), cashPosition: z.unknown().nullable() }),
      metadata: { canRetry: true, timeoutMs: 30000, maxRepairAttempts: 0, sideEffect: false },
      // Calls AskEdgar for the ticker. Caches per (ticker, endpoint) in agent_memory_v2
      // with category 'fact' and key 'askedgar:${endpoint}:${ticker}' and a 1-hour TTL.
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
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true, idempotencyKey: 'PLACEHOLDER' },
      run: async () => { /* calls writeAndDeliverReport with reportType: 'research' */ },
    },
  ],
};
```

Contract notes:

- **AskEdgar caching.** Read `agent_memory_v2` for `category = 'fact'`, `key = 'askedgar:filings:${ticker}'`. If the row exists and `updated_at > now() - interval '1 hour'`, use `value_json` as the cached response. Otherwise call AskEdgar and upsert the row via `upsertMemory()` with `expiresAt = now() + interval '1 hour'`. This is the cross-restart cache required by `AGENTIC_EXPANSIONV2.md` §9.
- **Ticker normalization.** Step 1 uppercases and trims the incoming ticker before any external call. Invalid tickers (non-alphabetic or > 5 chars) short-circuit with `failureClass: 'input-quality'`.
- **Report ownership.** `userId = job.userId` — research reports belong to the user who requested them, never to `system-agent-user`.

#### `lib/agents/blueprints/swing-trader-research.ts`

Same three-step shape as small-cap-research, but the LLM focuses on MDR similarity scoring, momentum indicators, and entry/stop/target levels. Schema:

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

Uses `callLlm(..., 'background')`. Same save-research step shape (idempotencyKey placeholder). Same user-owned report.

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
- Tests mock `node:fs` and `getAgentDb()` and advance vi fake timers to prove both the UPDATE and the file touch happen per tick.

#### `lib/agents/worker.ts`

```ts
import type { AgentConfig, WorkerConfig } from './types';

export interface WorkerHandle { stop: () => Promise<void> }

export async function startWorker(config: WorkerConfig & { agentConfig: AgentConfig }): Promise<WorkerHandle>;
```

Behavior contract:

- On start: writes/updates the agent's `agent_registry` row to `status = 'online'`, then starts `startHeartbeat(db, agentId)`, then begins the poll loop.
- Poll loop:
  1. `const claim = await claimNextQueuedJob(db, agentId, workerId)` where `workerId = '${agentId}:${process.pid}'`.
  2. If null, `await sleep(pollIntervalMs)` and continue.
  3. If claimed: resolve the blueprint via `config.agentConfig.blueprintResolver(claim.job)`. Catch "not implemented" errors and immediately call `failJob(db, claim.job.id, workerId, claim.leaseVersion, 'blueprint not implemented: ${jobType}')`.
  4. Call `runBlueprint(blueprint, claim.job, config.agentConfig, db, { lockedBy: workerId, leaseVersion: claim.leaseVersion })`.
  5. **Result packaging for the orchestrator routed-job case.** If `claim.job.agentId === 'orchestrator' && claim.job.jobType === 'chat'` and the runner's `finalOutput` contains `{ decision: 'route-to-specialist', ... }`, the worker writes `result = { routed: true, specialistJobId: <the job id the blueprint enqueued> }`. Otherwise `result = finalOutput`. Then call `completeJob(db, job.id, workerId, leaseVersion, result)`.
  6. If `runBlueprint` returns `{ status: 'failed', failureReason }`, classify and branch:
     - `failureClass === 'transient'` and `claim.job.attempt < claim.job.maxAttempts` -> `scheduleJobRetry(db, job.id, workerId, leaseVersion, new Date(Date.now() + calculateBackoffMs(claim.job.attempt)), failureReason)`.
     - Otherwise -> `failJob(db, job.id, workerId, leaseVersion, failureReason)`.
  7. Loop.
- Graceful shutdown: `stop()` sets an internal `shuttingDown = true` flag. The poll loop checks it before claiming a new job. If a job is in flight, the loop awaits the current `runBlueprint` call (does NOT cancel) and then exits. After the loop exits, call the heartbeat `stop()`.
- Backoff helper lives inline: `function calculateBackoffMs(attempt: number) { return Math.pow(2, attempt) * 2000 }` — 2s, 8s, 32s at attempts 1, 2, 3.
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
     VALUES (${randomUUID()}, 'orchestrator', 'macro-summary-cron', ${tradingDate}, 'processing', now(), now())
     ON CONFLICT (agent_id, trigger_type, trading_date) DO NOTHING
     RETURNING id;
     ```
     If zero rows returned, another tick already claimed the run — skip.
  4. If one row returned: insert a new `agent_jobs` row with `agent_id = 'orchestrator'`, `user_id = 'system-agent-user'`, `job_type = 'macro-summary'`, `status = 'queued'`, `input = { tradingDate }`. Then update the scheduled-run row with `job_id = <new job id>`, `status = 'completed'`, `completed_at = now()`.
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

##### `app/api/agents/service/chat/route.ts`

**POST** — `x-agent-service-key` header; body = `ServiceChatPostInput`.

1. `parseAndValidate(request, serviceChatPostSchema)` -> `{ data }` or 400.
2. `requireServiceAuth(request, data)` -> `{ user, discordUserId }` or 400/401/403 Response.
3. `const db = getAgentDb()`. If null, return `Response.json({ error: 'Database not configured' }, { status: 503 })`.
4. Resolve or create `session_id`: if provided, use it; otherwise `randomUUID()`.
5. Insert a row into `agent_conversations` with `role = 'user'`, `content = data.message`, `channel = 'discord'`, `user_id = user.id`, `agent_id = 'orchestrator'`, `session_id`.
6. Insert a new `agent_jobs` row: `id = randomUUID()`, `agent_id = 'orchestrator'`, `user_id = user.id`, `job_type = 'chat'`, `status = 'queued'`, `input = { message: data.message, session_id, channel: 'discord', discord_user_id: discordUserId }`, `priority = 0`, `max_attempts = 3`.
7. Return `Response.json({ job_id, session_id, agent_id: 'orchestrator' }, { status: 201 })`.

**GET** — `x-agent-service-key` header; query = `job_id`.

1. Parse `job_id` via `serviceChatGetQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))`.
2. `requireServiceAuth(request, {})` -- body is empty here because GET requests have no parseable body but the header check still must run. Workaround: the helper returns 400 for missing `discord_user_id`; for GET polling we call `requireAgentAdmin`-equivalent logic using only the service key. Implement a tiny helper in the route file: verify `x-agent-service-key` directly (same check as `requireServiceAuth` step 1-4), without the discord user mapping. Return 401 on mismatch.
3. `getAgentDb()` or 503.
4. `SELECT id, agent_id, status, progress_note, result, error_message FROM agent_jobs WHERE id = ${job_id}`. If no row, 404 `{ error: 'job not found' }`.
5. Return the correct status variant from `AGENTIC_EXPANSIONV2.md` §13:
   - `queued` -> `{ status: 'queued', job_id, agent_id, progress_note: null }`
   - `processing` -> `{ status: 'processing', job_id, agent_id, progress_note }`
   - `completed` with `result.routed === true` -> `{ status: 'completed', job_id, agent_id, result: { routed: true, specialistJobId: result.specialistJobId } }`
   - `completed` otherwise -> `{ status: 'completed', job_id, agent_id, session_id: result.session_id, result: { message: result.content ?? result.message ?? '' } }` (read `content` or `message` — blueprints may put either)
   - `failed` -> `{ status: 'failed', job_id, agent_id, error: { message: error_message, failureClass: <parsed from stepLog tail if present> } }`

##### `app/api/agents/reports/route.ts`

**GET** — `requireUser()`.

1. Parse query via `reportsListQuerySchema`.
2. Query `agent_reports` with `user_id = user.id AND user_id <> 'system-agent-user'` plus optional `status` and `agent_id` filters, ordered by `created_at DESC`, limit = `query.limit ?? 50`.
3. Return `{ reports: [{ id, agent_id, report_type, status, title, created_at }] }`.

##### `app/api/agents/reports/[id]/route.ts`

**GET** — `requireUser()`.

1. `SELECT * FROM agent_reports WHERE id = ${params.id} AND user_id = ${user.id} LIMIT 1`.
2. If no row, 404. If row, return `{ report: { id, agent_id, report_type, status, report_json } }`.

##### `app/api/agents/research/route.ts`

**POST** — `requireUser()`; body = `researchPostSchema`.

1. Parse + auth.
2. `SELECT status FROM agent_registry WHERE id = ${data.agent_id}`. If `status !== 'online'`, return 400 `{ error: 'agent unavailable', agent_id, status }` (AEV2-403 contract — reject, do not silently queue).
3. Insert `agent_jobs` row: `agent_id = data.agent_id`, `user_id = user.id`, `job_type = 'research'`, `input = { ticker: data.ticker }`, `status = 'queued'`.
4. Return `{ job_id, agent_id, job_type: 'research' }`.

**GET** — `requireUser()`.

1. `SELECT id, agent_id, report_type, report_json -> 'ticker' AS ticker FROM agent_reports WHERE user_id = ${user.id} AND user_id <> 'system-agent-user' AND report_type = 'research' ORDER BY created_at DESC LIMIT 50`.
2. Return `{ reports: [{ id, agent_id, report_type, ticker }] }`.

##### `app/api/agents/admin/stats/route.ts`

**GET** — `requireAgentAdmin()`.

Return the full `AdminStatsResponse` shape from `AGENTIC_EXPANSIONV2.md` §11 (per D3). Query plan:

- `circuitBreakers`: `SELECT id, config -> 'circuitBreaker' FROM agent_registry`.
- `today.*`: aggregates over `agent_request_log` where `created_at >= start of current UTC day`.
- `today.byLane`: `GROUP BY lane`.
- `today.byAgent`: `GROUP BY agent_id`.
- `thisMonth.*`: aggregates over `agent_request_log` where `created_at >= first of current UTC month`. Include `budgetCents` from `getLlmBudgetConfig().monthlyBudgetCents` and `budgetUsedPercent`.
- `agents`: `SELECT id, display_name, status, last_heartbeat FROM agent_registry`.
- `delivery.publishedToday`: `SELECT count(*) FROM agent_reports WHERE status = 'published' AND created_at >= start of current UTC day`.
- `delivery.deliveryFailures`: same with `status = 'delivery_failed'`.
- `memory.total` and `memory.byCategory`: over `agent_memory_v2`.
- `macroSummaries.latestGeneratedAt`: latest published macro report's `created_at`.

Include `queueDepth`, `oldestQueuedJobAgeSeconds`, `stuckProcessing` (jobs in `processing` for > 10 minutes with stale heartbeat), `retryRate`, and `deliveryFailureRate` — these are the AEV2-404 acceptance criteria add-ons on top of the §11 shape.

##### `app/api/agents/admin/memory/route.ts`

**GET** — `requireAgentAdmin()`; query = `adminMemoryListQuerySchema`.

1. Query `agent_memory_v2` with optional filters on `user_id`, `agent_id`, `category`, limit 200, order by `updated_at DESC`.
2. Return `{ memory: [{ id, user_id, agent_id, category, key }] }`.

**DELETE** — `requireAgentAdmin()`; body = `adminMemoryDeleteSchema`.

1. `DELETE FROM agent_memory_v2 WHERE id = ${data.id}`.
2. Return `{ deleted: true }`. If the delete affected zero rows, return 404 `{ error: 'memory row not found' }`.

##### `app/api/agents/admin/redeliver/route.ts`

**POST** — `requireAgentAdmin()`; body = `redeliverSchema`.

1. `const result = await redeliverReport(getAgentDb(), data.report_id)`.
2. Return `{ report_id: data.report_id, status: result.status }`.
3. 404 if the report does not exist.

##### `app/api/agents/macro-summary/latest/route.ts`

**GET** — no auth (public read; matches `AGENTIC_EXPANSIONV2.md` §13).

1. `SELECT created_at AS generated_at, report_json AS content FROM agent_reports WHERE user_id = 'system-agent-user' AND agent_id = 'orchestrator' AND report_type = 'macro-summary' AND status = 'published' ORDER BY created_at DESC LIMIT 1`.
2. If no row, return `{ summary: null }` with 200.
3. Otherwise return `{ summary: { generated_at, content } }`.

#### Route Test Mocking Pattern (AEV2-407)

All route tests follow the pattern in `__tests__/trades-route.test.ts`. Key rules:

- Use `vi.hoisted(() => ({ ... }))` to create the mock functions.
- `vi.mock('@/lib/agents/db', () => ({ getAgentDb: getAgentDbMock }))`.
- `vi.mock('@/lib/agents/admin', () => ({ requireAgentAdmin: requireAgentAdminMock, requireServiceAuth: requireServiceAuthMock }))`.
- `vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock, dbUnavailable: ... }))`.
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
  - For redeliver: prove idempotency — calling twice does not duplicate `agent_reports` rows or double-POST to Discord (mock `fetch` twice, assert second call is a no-op or uses a fresh retry idempotency key)
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

**Review focus:** confirm report-write and Discord-delivery idempotency markers are separate, and that a failed webhook POST becomes data (status = `delivery_failed`) instead of an exception.

**Suggested commit:** `feat(aev2): add agent discord embed and delivery helpers`

**Check off before commit**

- [ ] `lib/agents/discord.ts` exists and exports exactly the symbols listed in the execution contract (`DiscordEmbed`, `DiscordWebhookPayload`, five `build*Embed` functions, `resolveWebhookUrl`, `writeAndDeliverReport`, `redeliverReport`).
- [ ] `writeAndDeliverReport` uses two separate `recordStepEffect` calls: `report-write` keyed by `${jobId}:write-report:report-write`, then `discord-delivery` keyed by `discord-delivery:${reportId}`.
- [ ] `resolveWebhookUrl` maps every (agentId, reportType) combination listed in the contract and returns `null` for unknowns without throwing.
- [ ] Webhook POST uses `fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed] }) })` and respects a 10s AbortController timeout.
- [ ] HTTP 2xx sets `status = 'published'` and `delivered_at = now()`. Non-2xx or fetch throw sets `status = 'delivery_failed'` with `delivery_error` populated. Neither path throws to the caller.
- [ ] `redeliverReport` re-reads the stored `report_json`, uses a fresh retry idempotency key, and re-runs delivery only (no LLM call, no re-write of `report_json`).
- [ ] `__tests__/agent-discord.test.ts` covers: happy-path write+deliver, duplicate call short-circuits via idempotency marker, HTTP 500 becomes `delivery_failed`, `fetch` throw becomes `delivery_failed`, `resolveWebhookUrl` unknown combo returns null, and redeliver retry posts again with the retry idempotency key.

**Exit criteria**

- [ ] Retries cannot duplicate `agent_reports` rows or webhook posts.
- [ ] Delivery failure becomes observable state, not a thrown exception.
- [ ] No blueprint file yet imports from `discord.ts` — blueprints land in Checkpoint 3.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run __tests__/agent-discord.test.ts`

**STOP. Review. Commit. Then continue.**

### Checkpoint 2 — Scrape-Lite, Prompt Loader, Config Registry

**Stories:** `AEV2-308` (part 1)

**Review focus:** confirm `scrape-lite.ts` is a pure fetcher, `prompts-loader.ts` fails fast on missing files, and `AGENT_CONFIGS` is a plain const with no side effects.

**Suggested commit:** `feat(aev2): add agent scrape-lite, prompts loader, and config registry skeleton`

**Check off before commit**

- [ ] `lib/agents/scrape-lite.ts` exports only `fetchPageText(url, options?)`. No URL list in this file.
- [ ] `fetchPageText` strips `<script>`, `<style>`, HTML tags, decodes the five listed entities, normalizes whitespace, returns first 30000 chars, uses a 10s AbortController timeout, and throws on non-2xx with the status + truncated body.
- [ ] `lib/agents/prompts-loader.ts` exports `loadGlobalPolicyPrompt`, `loadRolePrompt`, and `buildLlmSystemPrompt`. Files are read once at module load and cached in a module-level const.
- [ ] `buildLlmSystemPrompt('orchestrator')` returns `${globalPolicy}\n\n---\n\n${orchestratorPrompt}`.
- [ ] `lib/agents/config.ts` exports `AGENT_CONFIGS` and `resolveBlueprint(job)`. The four implemented blueprints are imported; the three scan blueprints are declared via `notImplementedBlueprint(name)` helper.
- [ ] The config file compiles even though the blueprint files are still empty stubs — use empty default exports in the blueprint files for this checkpoint and fill them in Checkpoint 3.
- [ ] `__tests__/agent-scrape-lite.test.ts` covers: happy-path HTML->text, entity decoding, 30k cap, non-2xx throw, and timeout behavior with `vi.useFakeTimers()`.
- [ ] `__tests__/agent-config.test.ts` covers: every `AgentId` resolves an `AgentConfig`, `resolveBlueprint` throws on unknown `agentId`, `notImplementedBlueprint` surfaces the expected error at `step.run()` invocation time.

**Exit criteria**

- [ ] Prompts fail fast at module load if any file is missing.
- [ ] Scrape-lite is reusable by any blueprint — no URL hardcoding.
- [ ] Config registry compiles and routes can import `resolveBlueprint` even before blueprint bodies land.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run __tests__/agent-scrape-lite.test.ts __tests__/agent-config.test.ts`

**STOP. Review. Commit. Then continue.**

### Checkpoint 3 — Blueprint Implementations

**Stories:** `AEV2-308` (part 2)

**Review focus:** confirm the four implemented blueprints match their execution contracts: deterministic routing for orchestrator:chat, writeAndDeliverReport for every save step, `lane: 'background'` override for the macro synthesis step, and the `'PLACEHOLDER'` idempotency key convention.

**Suggested commit:** `feat(aev2): implement sprint 3 agent blueprints`

**Check off before commit**

- [ ] `lib/agents/blueprints/orchestrator-chat.ts` exports `orchestratorChatBlueprint` with two steps. Step 1 `classify-and-route` is deterministic (no LLM call), enforces the five routing rules verbatim, checks `agent_registry.status`, and enqueues the specialist handoff when needed. Step 2 `synthesize-response` uses `callLlm(..., 'interactive')` with `buildLlmSystemPrompt('orchestrator')`.
- [ ] `lib/agents/blueprints/orchestrator-macro-summary.ts` exports four steps matching the contract. Step 1 reads `MACRO_HEADLINES_URLS` env with the documented default. Step 3 uses `lane: 'background'`. Step 4 uses `writeAndDeliverReport` with `userId = 'system-agent-user'` and the `'PLACEHOLDER'` idempotency key.
- [ ] `lib/agents/blueprints/small-cap-research.ts` exports four steps. Step 1 caches AskEdgar responses in `agent_memory_v2` with `category = 'fact'`, `key = 'askedgar:${endpoint}:${ticker}'`, and a 1-hour TTL. Step 3 uses `lane: 'background'`. Step 4 uses `writeAndDeliverReport` with `userId = job.userId` and `reportType = 'research'`.
- [ ] `lib/agents/blueprints/swing-trader-research.ts` exports four steps with the MDR-focused output schema. Same save-research contract.
- [ ] `lib/agents/blueprint-runner.ts` is extended (additive only) to substitute `'PLACEHOLDER'` in `step.metadata.idempotencyKey` with `${job.id}:${step.name}:report-write` before calling `recordStepEffect`. No other runner changes.
- [ ] `__tests__/agent-blueprints.test.ts` covers: orchestrator routing (each rule branches correctly), orchestrator offline-specialist fallback, macro-summary step 3 using the background lane, small-cap AskEdgar cache hit/miss, research save step using `writeAndDeliverReport`.

**Exit criteria**

- [ ] All four implemented blueprints are callable through `resolveBlueprint(job)` in tests.
- [ ] Scan blueprints still throw `'blueprint not implemented in Sprint 3: ...'` at step execution time — not at import time.
- [ ] Runner `'PLACEHOLDER'` substitution is the only runner change.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run __tests__/agent-blueprints.test.ts __tests__/agent-blueprint-runner.test.ts`

**STOP. Review. Commit. Then continue.**

### Checkpoint 4 — Heartbeat, Worker Loop, Macro Cron

**Stories:** `AEV2-309`, `AEV2-310`

**Review focus:** confirm the worker loop claims through `claimNextQueuedJob`, packages the orchestrator routed-job result correctly, and retries only on `transient` failure class. Confirm the macro cron uses `INSERT ... ON CONFLICT DO NOTHING` for dedupe.

**Suggested commit:** `feat(aev2): add agent worker loop, heartbeat, and macro cron`

**Check off before commit**

- [ ] `lib/agents/heartbeat.ts` exports `startHeartbeat(db, agentId, intervalMs?)` returning `{ stop }`. Each tick updates `agent_registry.last_heartbeat` and `status = 'online'`, and touches `/tmp/healthy`. Errors are logged, not rethrown. `stop()` sets `status = 'offline'`.
- [ ] `lib/agents/worker.ts` exports `startWorker(config)` returning `{ stop }`. The poll loop calls `claimNextQueuedJob` / `runBlueprint` / `completeJob` in the canonical order from the execution contract.
- [ ] Routed orchestrator jobs return `result = { routed: true, specialistJobId }` via the worker's result packager — not via blueprint logic.
- [ ] Retry branch: `failureClass === 'transient' && attempt < maxAttempts` -> `scheduleJobRetry` with `calculateBackoffMs`. Otherwise `failJob`.
- [ ] Not-implemented blueprints fail immediately via `failJob` with message `'blueprint not implemented: <job_type>'`.
- [ ] Graceful shutdown waits for the in-flight `runBlueprint` to finish but does not cancel it. Heartbeat `stop()` runs after the loop exits.
- [ ] `lib/agents/macro-cron.ts` exports `startMacroCron(db, options?)` returning `{ stop }`. Tick checks `currentHour === hourEt` in `America/New_York`, claims the scheduled run with `INSERT ... ON CONFLICT (agent_id, trigger_type, trading_date) DO NOTHING RETURNING id`, and only enqueues an `agent_jobs` row when the insert returned a row.
- [ ] Stale-job reaper is NOT implemented in Sprint 3 (out of scope per the contract).
- [ ] `__tests__/agent-worker.test.ts` uses `vi.useFakeTimers()` and covers: claim happy path, empty-claim sleep, routed-job result packaging, transient failure scheduling a retry, non-transient failure failing the job, and graceful shutdown draining one in-flight job.
- [ ] `__tests__/agent-macro-cron.test.ts` covers: tick outside the trigger hour skips, tick inside the trigger hour inserts the scheduled run + enqueues the job, and concurrent ticks (simulated via two insert calls) only produce one job.

**Exit criteria**

- [ ] The worker loop routes every lease-fenced mutation through Sprint 2 queue helpers.
- [ ] Macro cron is deduped by `(agent_id, trigger_type, trading_date)`.
- [ ] Heartbeat touches `/tmp/healthy` on every tick.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run __tests__/agent-worker.test.ts __tests__/agent-macro-cron.test.ts`

**STOP. Review. Commit. Then continue.**

### Checkpoint 5 — API Routes

**Stories:** `AEV2-401`, `AEV2-402`, `AEV2-403`, `AEV2-404`, `AEV2-405`, `AEV2-406`

**Review focus:** confirm every route uses the correct auth helper (`requireServiceAuth` / `requireAgentAdmin` / `requireUser`), user-facing routes exclude `system-agent-user` rows, and the admin stats route returns the full §11 shape per D3.

**Suggested commit:** `feat(aev2): add /api/agents/* routes and validation schemas`

**Check off before commit**

- [ ] `lib/validations/agents.ts` exists and exports every schema listed in the execution contract. Route files import from `@/lib/validations/agents`.
- [ ] `app/api/agents/service/chat/route.ts` implements POST and GET per the contract. POST inserts one `agent_conversations` row and one `agent_jobs` row. GET returns the five state variants from `AGENTIC_EXPANSIONV2.md` §13.
- [ ] `app/api/agents/reports/route.ts` (GET) excludes `user_id = 'system-agent-user'` rows.
- [ ] `app/api/agents/reports/[id]/route.ts` (GET) scopes to `user_id = user.id`.
- [ ] `app/api/agents/research/route.ts` POST rejects offline/degraded specialists with 400 `{ error: 'agent unavailable' }`. GET lists user-owned research reports only.
- [ ] `app/api/agents/admin/stats/route.ts` returns the full `AGENTIC_EXPANSIONV2.md` §11 JSON shape, including `queueDepth`, `oldestQueuedJobAgeSeconds`, `stuckProcessing`, `retryRate`, and `deliveryFailureRate`.
- [ ] `app/api/agents/admin/memory/route.ts` GET filters by query params and DELETE returns 404 on missing id.
- [ ] `app/api/agents/admin/redeliver/route.ts` delegates to `redeliverReport()` and returns `{ report_id, status }`.
- [ ] `app/api/agents/macro-summary/latest/route.ts` queries system-owned macro report and returns `{ summary: null }` on empty state.
- [ ] No route file calls `request.json()` directly — all parsing goes through `parseAndValidate`.
- [ ] No route file writes to `agent_jobs`, `agent_reports`, or `agent_memory_v2` outside of `db.insert()` / `db.update()` / `db.delete()` on the imported schema — no raw `sql` template writes.

**Exit criteria**

- [ ] Every route listed in AEV2-401 through AEV2-406 is reachable and compiles.
- [ ] Validation schemas are centralized in `lib/validations/agents.ts`.
- [ ] Admin stats shape matches the launch target so Sprint 4 can focus on deployment.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build` (proves every route compiles under Next.js)

**STOP. Review. Commit. Then continue.**

### Checkpoint 6 — Route Test Coverage (AEV2-407 Gate)

**Stories:** `AEV2-407`

**Review focus:** confirm every required coverage row is exercised, mocks follow the `__tests__/trades-route.test.ts` pattern, and no test touches a real DB or real webhook.

**Suggested commit:** `test(aev2): add agent api route contract tests`

**Check off before commit**

- [ ] `__tests__/agent-service-chat-route.test.ts` covers POST success (201), POST 400 missing `discord_user_id`, POST 401 invalid service key, POST 403 unknown Discord user, POST 503 on `getAgentDb() === null`, GET queued/processing/completed/failed/routed variants, GET 404 on unknown job_id.
- [ ] `__tests__/agent-reports-route.test.ts` covers GET list success, GET list filtered by `status` + `agent_id`, GET list excludes `system-agent-user` rows, GET detail success, GET detail 404, auth failure 401.
- [ ] `__tests__/agent-research-route.test.ts` covers POST success, POST 400 invalid ticker, POST 400 on offline/degraded specialist, GET list success, GET list excludes system-owned rows.
- [ ] `__tests__/agent-admin-stats-route.test.ts` covers the full §11 response shape (at minimum asserts the top-level keys exist), 401 on missing admin key, and the `queueDepth` / `stuckProcessing` fields populate from mocked query results.
- [ ] `__tests__/agent-admin-memory-route.test.ts` covers GET with filters, GET without filters, DELETE success, DELETE 404, 401 on missing admin key.
- [ ] `__tests__/agent-admin-redeliver-route.test.ts` covers success (mocks `redeliverReport` to return `published`), delivery_failed path, idempotency (second call with same report_id uses the retry idempotency key), and 404 on unknown report_id.
- [ ] `__tests__/agent-macro-summary-route.test.ts` covers happy path, empty state returning `{ summary: null }`, and query targets `user_id = 'system-agent-user'` + `report_type = 'macro-summary'`.
- [ ] No test calls the real `fetch` or a real Neon connection. `global.fetch` is mocked via `vi.stubGlobal('fetch', vi.fn())` where needed.

**Exit criteria**

- [ ] Every row in the AEV2-407 coverage matrix (success, auth failure, validation failure, lease-fencing-sensitive state transitions, redelivery, offline fallback) is exercised by a test.
- [ ] Test files follow the `vi.hoisted` + `vi.mock` pattern from `__tests__/trades-route.test.ts`.
- [ ] `npm test` passes without network access.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm test`

**STOP. Review. Commit. This is the Sprint 3 exit gate.**

### Sprint 3 Exit Gate

- [ ] `AEV2-307` through `AEV2-407` landed in checkpoint order.
- [ ] Every new file lives under `lib/agents/`, `lib/validations/`, `app/api/agents/`, or `__tests__/`. No file under `services/` was modified.
- [ ] `lib/db/schema.ts` unchanged. No new migrations.
- [ ] All four implemented blueprints compile and can be resolved via `resolveBlueprint(job)`. Scan blueprints throw `'blueprint not implemented in Sprint 3'` at step execution.
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `HANDOFF.md` updated after the final checkpoint closes.

### Complexity

- Overall complexity: `XL` (largest sprint in the AEV2 buildout — touches runtime wiring, app routes, and the contract-test layer).
- Highest-risk checkpoint: Checkpoint 4 (worker loop + macro cron) because it is where Sprint 2 queue fencing meets real job lifecycle. A bug here corrupts lease state for every downstream sprint.
- Second-highest-risk checkpoint: Checkpoint 1 (Discord delivery). Idempotency key mistakes here mean duplicate reports or duplicate webhook posts in production. The two-marker design is load-bearing.
