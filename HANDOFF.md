# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Sprint 1, Sprint 2, and Sprint 3 are complete. Older detail was removed from this file; use git history and `AEV2_PLAN.md` for archived context.

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

> Generated: 2026-04-07 | Agent: Codex
> Status: COMPLETE

### Summary

- Landed the Sprint 3 Discord delivery helpers in [`lib/agents/discord.ts`](/home/jared/Nexus-Terminal/lib/agents/discord.ts), the agent config/blueprint registry in [`lib/agents/config.ts`](/home/jared/Nexus-Terminal/lib/agents/config.ts), the prompt loader in [`lib/agents/prompts-loader.ts`](/home/jared/Nexus-Terminal/lib/agents/prompts-loader.ts), and the pure HTML fetcher in [`lib/agents/scrape-lite.ts`](/home/jared/Nexus-Terminal/lib/agents/scrape-lite.ts).
- Implemented the four Sprint 3 blueprints under [`lib/agents/blueprints/`](/home/jared/Nexus-Terminal/lib/agents/blueprints): `orchestrator-chat.ts`, `orchestrator-macro-summary.ts`, `small-cap-research.ts`, `swing-trader-research.ts`. The three scan blueprints remain registered as `notImplementedBlueprint` stubs that fail at step execution as `contract` errors.
- Landed the worker runtime: [`lib/agents/heartbeat.ts`](/home/jared/Nexus-Terminal/lib/agents/heartbeat.ts), [`lib/agents/worker.ts`](/home/jared/Nexus-Terminal/lib/agents/worker.ts), and [`lib/agents/macro-cron.ts`](/home/jared/Nexus-Terminal/lib/agents/macro-cron.ts) — including lease-loss handling, mid-job lease renewal, and a single-transaction macro-cron claim/job/update flow.
- Shipped every `/api/agents/*` route under [`app/api/agents/`](/home/jared/Nexus-Terminal/app/api/agents) with centralized Zod validation in [`lib/validations/agents.ts`](/home/jared/Nexus-Terminal/lib/validations/agents.ts) and the additive `requireServiceKey()` helper in [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts).
- Made [`lib/server-db-utils.ts`](/home/jared/Nexus-Terminal/lib/server-db-utils.ts) lazy-load auth and degraded [`lib/auth-config.ts`](/home/jared/Nexus-Terminal/lib/auth-config.ts) to an empty Google provider list when OAuth env vars are missing, so `npm run build` succeeds without secrets.
- Added the additive `StepInput` runtime fields, `NotImplementedBlueprintError`, and `AdminStatsResponse` contract to [`lib/agents/types.ts`](/home/jared/Nexus-Terminal/lib/agents/types.ts), plus `failureClass` propagation and `skipWhenRouted` semantics in [`lib/agents/blueprint-runner.ts`](/home/jared/Nexus-Terminal/lib/agents/blueprint-runner.ts).
- Locked route contract coverage in `__tests__/agent-discord.test.ts`, `__tests__/agent-scrape-lite.test.ts`, `__tests__/agent-config.test.ts`, `__tests__/agent-blueprints.test.ts`, `__tests__/agent-worker.test.ts`, `__tests__/agent-macro-cron.test.ts`, `__tests__/agent-service-chat-route.test.ts`, `__tests__/agent-reports-route.test.ts`, `__tests__/agent-research-route.test.ts`, `__tests__/agent-admin-stats-route.test.ts`, `__tests__/agent-admin-memory-route.test.ts`, `__tests__/agent-admin-redeliver-route.test.ts`, and `__tests__/agent-macro-summary-route.test.ts`.
- Kept Sprint 3 strictly inside `lib/agents/`, `lib/validations/`, `app/api/agents/`, and `__tests__/`. No `services/**` files, no schema changes, no new migrations, no new npm dependencies.

### Validation

- `npm run lint` OK
- `npx tsc --noEmit` OK
- `npm run build` OK
- `npm test` OK

### Archive Note

- The Sprint 3 execution contracts (Discord delivery flow, blueprint step shapes, worker lease semantics, AdminStatsResponse formulas, route contracts, six checkpoint gates) were intentionally removed from `HANDOFF.md` now that Sprint 3 is closed. Recover via `git log -- HANDOFF.md` if needed.

---

## AEV2 Sprint 4 — Docker, Discord Bot, and Launch Hardening

> Generated: 2026-04-08 | Agent: Claude (Plan)
> Status: READY FOR CODEX

### Objective

Take the Sprint 1–3 library + API surface and prove it as a runnable home-server deployment. Sprint 4 builds the agent Docker image, rewrites Compose for the V1 topology (Orchestrator + Small Cap Trader + Swing Trader + Discord bot, no Redis), ships the minimal `discord.js` bot in `services/discord-bot/`, validates service-side TypeScript, drops the observability SQL + ops runbooks, and walks the deploy smoke checklist. After Sprint 4 closes, the AEV2 V1 system is launch-ready and the user can run `docker compose up -d` against the home server.

### Stories

- AEV2-501 — Generic agent container runtime (`services/agent.Dockerfile` + `services/agent-entrypoint.ts`)
- AEV2-502 — Rewrite `services/docker-compose.yml` for V1 topology (3 agents + Discord bot, Redis removed)
- AEV2-503 — Verify `services/.env.example` completeness for the V1 surface
- AEV2-504 — Build minimal Discord bot runtime (`services/discord-bot/`)
- AEV2-505 — Implement bot request/poll/reply flow against `/api/agents/service/chat`
- AEV2-506 — Service-side TypeScript validation (`services/tsconfig.json` + scripted check)
- AEV2-507 — Observability artifacts (`scripts/ops/agent-observability.sql`)
- AEV2-508 — Rollback and home-server recovery runbooks (`docs/ops/`)
- AEV2-509 — Deploy smoke checklist execution
- AEV2-510 — Pre-launch config and secrets re-validation

### Current State

- Sprint 3 is complete. Every `/api/agents/*` route, the worker loop (`startWorker`), the macro cron (`startMacroCron`), the heartbeat (`startHeartbeat`), the four implemented blueprints, the Discord delivery helpers, and the agent config/registry are landed in `lib/agents/` and `app/api/agents/`. Sprint 4 must NOT modify any of those files except the additive items called out below.
- [`services/docker-compose.yml`](/home/jared/Nexus-Terminal/services/docker-compose.yml) currently contains a Redis service plus a stub `discord-bot` service that builds from `./discord-bot` (a directory that does NOT exist) and points at `host.docker.internal:3000`. Sprint 4 deletes the Redis service entirely and rewrites the bot service alongside the three agent services.
- [`services/.env.example`](/home/jared/Nexus-Terminal/services/.env.example) already covers `DATABASE_URL`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, all six `DISCORD_WEBHOOK_*` vars, the four `INTERACTIVE_LLM_*` / `BACKGROUND_LLM_*` vars (key, base URL, model — but NOT timeout), `MASSIVE_API_KEY`, `ASKEDGAR_API_KEY`, `AGENT_ADMIN_KEY`, `AGENT_SERVICE_KEY`, `AGENT_POLL_INTERVAL_MS`, `MACRO_CRON_HOUR`, `TZ`. It is MISSING the entries listed below (verified against `lib/agents/llm-client.ts` defaults — six `AGENT_*` caps total, NOT seven; `AGENT_MAX_ASKEDGAR_CALLS_PER_SCAN` from `AGENTIC_EXPANSIONV2.md` §19 is design-doc-only and is NOT consumed by the runtime, so Sprint 4 does NOT add it). `ASKEDGAR_DAILY_LIMIT` and `TRADINGVIEW_SESSION_ID` already exist in the root [`.env.example`](/home/jared/Nexus-Terminal/.env.example) but are also live-read by the trader blueprints, so Sprint 4 mirrors them into `services/.env.example` and the two trader containers:
  - `INTERACTIVE_LLM_TIMEOUT_MS=30000` (per-request timeout consumed by `lib/agents/llm-client.ts:103`)
  - `BACKGROUND_LLM_TIMEOUT_MS=60000` (per-request timeout consumed by `lib/agents/llm-client.ts:115`)
  - `AGENT_DAILY_BUDGET_CENTS=500` (default in `lib/agents/llm-client.ts:14`)
  - `AGENT_MONTHLY_BUDGET_CENTS=10000` (default in `lib/agents/llm-client.ts:15`)
  - `AGENT_MAX_CONTEXT_TOKENS=32000` (default in `lib/agents/llm-client.ts:16`)
  - `AGENT_MAX_SCAN_CANDIDATES=20` (default in `lib/agents/llm-client.ts:17`)
  - `AGENT_MAX_PATTERN_HISTORY=50` (default in `lib/agents/llm-client.ts:18`)
  - `AGENT_MAX_RETRIES_PER_STEP=2` (default in `lib/agents/llm-client.ts:19`)
  - `ASKEDGAR_DAILY_LIMIT=100` (default in `lib/askedgar.ts:36`, consumed via `parseDailyLimit()` in `lib/askedgar.ts:136`)
  - `TRADINGVIEW_SESSION_ID=` (blank/optional, read by both trader blueprints in `lib/agents/blueprints/small-cap-research.ts:109` and `lib/agents/blueprints/swing-trader-research.ts:112`)
  - `MACRO_HEADLINES_URLS=` (blank — fallback baked into `lib/agents/blueprints/orchestrator-macro-summary.ts:8`: `https://www.marketwatch.com/latest-news,https://finance.yahoo.com/topic/stock-market-news/`)
  - `NEXUS_API_URL=` (blank — public Vercel URL, used ONLY by the discord-bot service, never by an agent service)
  - `MASSIVE_API_BASE_URL=https://api.polygon.io` (design-doc reserved; not yet consumed by runtime, but kept for parity with `AGENTIC_EXPANSIONV2.md` §19)
- [`services/.env`](/home/jared/Nexus-Terminal/services/.env) exists with real credentials and is `.gitignore`d. Sprint 4 MUST NOT read, copy, edit, or commit this file. Codex only edits `services/.env.example`.
- Root [`tsconfig.json`](/home/jared/Nexus-Terminal/tsconfig.json) excludes `services/`. Sprint 4 must NOT change the root tsconfig — it must add a service-side tsconfig at `services/tsconfig.json` that compiles `services/agent-entrypoint.ts` and the discord bot entrypoint and references `lib/` via the existing `@/*` path alias rooted at the repo.
- `services/discord-bot/` does NOT exist yet. Sprint 4 creates the entire directory tree from scratch — `package.json`, `package-lock.json` (via `npm install`), `tsconfig.json`, `Dockerfile`, and the TypeScript bot entrypoint.
- `scripts/ops/` does NOT exist yet. Sprint 4 creates it and adds `agent-observability.sql`.
- `docs/ops/` does NOT exist yet. Sprint 4 creates it and adds the rollback + home-server recovery + smoke + launch-validation runbooks. The pre-migration backup runbook (`docs/ops/agents-backup-restore.md`) is the only ops doc the source plan assigns to a pre-Sprint-1 epic; since migration 0019 already shipped without it, Sprint 4 produces the doc retroactively with the canonical Neon branch backup/restore procedure and placeholder slots for any user-specific branch IDs or notes that are not in the repo.
- The hardcoded `DISCORD_USER_MAP` in [`lib/agents/admin.ts`](/home/jared/Nexus-Terminal/lib/agents/admin.ts) is currently empty (only commented placeholders). The smoke checklist requires the user to populate it manually after Codex hands off and before the live smoke (see "External Validation Checklist" at the bottom of this sprint). Codex does NOT fill this map — it is operator data.
- `npm run lint`, `npx tsc --noEmit`, and `npm test` all pass on the Sprint 3 baseline as of 2026-04-08. 307 tests across 45 files. `discord.js` and `tsx` are NOT yet in `package.json` — they will live exclusively in `services/discord-bot/package.json`, NOT in the root `package.json`, so the Vercel bundle stays unaffected.

### Scope

- **In scope:** `AEV2-501` through `AEV2-510`. New files under `services/agent.Dockerfile`, `services/agent-entrypoint.ts`, `services/tsconfig.json`, `services/discord-bot/**`, `scripts/ops/agent-observability.sql`, and `docs/ops/**`. Additive edits to `services/docker-compose.yml`, `services/.env.example`, `package.json` (one new script for service typecheck — see D5), and `.gitignore` if needed for the new bot lockfile path. The HANDOFF.md update lands at the end.
- **Out of scope:** Any file under `lib/agents/` or `app/api/agents/` except a documentation comment (no behavior changes — see D6), any file under `lib/validations/`, any file under `__tests__/` (Sprint 4 has NO new vitest tests — service-side validation is a manual build/typecheck/runtime smoke, not a vitest contract), any new DB migration, any change to `lib/db/schema.ts`, any change to `middleware.ts`, any change to `lib/llm-client.ts` (Vercel-side), any change to `next.config.ts` or root `tsconfig.json`, any installation of `discord.js` or `tsx` into the root `package.json`, any new feature flag or backwards-compat shim, any rewrite of unrelated Compose services. Codex must NOT touch `services/.env`, ever. Codex must NOT fill the `DISCORD_USER_MAP` — that is operator data and is part of the External Validation Checklist below. This no-`lib/agents/` rule applies to Codex-authored changes; the operator may add the live Discord mapping in `lib/agents/admin.ts` after handoff before smoke.

### Decisions Locked For Sprint 4

These ten decisions remove ambiguity before Codex starts. If any of them is wrong, update this section before execution — do NOT let Codex discover the ambiguity mid-sprint.

- **D1. Dockerfile install strategy.** `services/agent.Dockerfile` runs `npm ci` (NOT `npm ci --production` or `--omit=dev`). Reason: the agent runtime imports Drizzle, Zod, the schema, and the prompt files at module load. Several of those packages are listed under `dependencies` in the root `package.json`, but the runtime also depends on TypeScript type checks happening through `tsx`'s on-the-fly transpile, and stripping devDependencies risks losing type-only or transitive packages that the runtime indirectly needs. We accept the larger image in V1 in exchange for guaranteed parity with `npm test`. The Dockerfile installs `tsx` separately as a global-style binary via `npm install -g tsx@4` so the production install does not need to mutate `package.json`.
- **D2. Image surface.** The Dockerfile copies the minimum surface the agent runtime touches at runtime: `package.json`, `package-lock.json`, `tsconfig.json`, `lib/`, and `services/agent-entrypoint.ts`. It does NOT copy `app/`, `components/`, `hooks/`, `public/`, `__tests__/`, `drizzle/`, `scripts/`, `docs/`, `.next/`, `node_modules/`, or any of the Next.js UI surface. A `.dockerignore` at the repo root enforces this — Sprint 4 creates it. Because [`lib/agents/prompts-loader.ts`](/home/jared/Nexus-Terminal/lib/agents/prompts-loader.ts) reads `lib/agents/prompts/*.md` at runtime, any broad markdown exclusion MUST explicitly re-include `lib/agents/prompts/*.md`.
- **D3. Entrypoint signature.** `services/agent-entrypoint.ts` ignores the stale example in `AGENTIC_EXPANSIONV2.md` §15 (which calls `startMacroCron()` with zero args and `startWorker({ blueprintResolver })`). The current Sprint 3 contracts are: `startWorker(config: WorkerConfig & { agentConfig: AgentConfig })` and `startMacroCron(db: AgentDb, options?: { hourEt?: number; checkIntervalMs?: number })`. The entrypoint resolves `db = getAgentDb()` once at startup (throwing if null), passes `agentConfig: AGENT_CONFIGS[agentId]` into `startWorker`, and only the orchestrator process calls `startMacroCron(db)`. Pull the `pollIntervalMs` from `process.env.AGENT_POLL_INTERVAL_MS ?? '5000'`.
- **D4. Discord bot tech stack.** `services/discord-bot/` uses `discord.js@14`, runs on Node 20 Alpine, ships with its own `package.json` + `package-lock.json` so the Vercel root install never sees `discord.js`. The bot is written in TypeScript and launched via `tsx services/discord-bot/index.ts` from inside its own container. Polling: 2-second interval with a 60-attempt cap (120s total), then a fixed timeout reply. The bot uses `node:fetch` (built into Node 20) to talk to the Nexus API — no `node-fetch` or `axios` dependency.
- **D5. Service typecheck script.** `package.json` gains exactly one new script: `"typecheck:services": "tsc -p services/tsconfig.json --noEmit"`. The script runs both the agent entrypoint and the Discord bot entrypoint through one tsc invocation by including both source roots in `services/tsconfig.json`. The script is the AEV2-506 acceptance gate. Codex must not collapse it into the existing `lint` script and must not invoke it from `npm test` (vitest would fail on `services/` files). Because `discord.js` lives only under `services/discord-bot/`, this gate is evaluated after the one-time `cd services/discord-bot && npm ci` step from Checkpoint 3 and in any workspace where `services/discord-bot/node_modules` exists. The script is invoked manually as part of Sprint 4's checkpoint validation and is documented in the smoke runbook.
- **D6. lib/agents/ untouched.** Sprint 4 does NOT make Codex-authored behavior changes to `lib/agents/admin.ts`, `lib/agents/worker.ts`, `lib/agents/macro-cron.ts`, `lib/agents/heartbeat.ts`, `lib/agents/config.ts`, or any blueprint file. The checked-in code leaves `DISCORD_USER_MAP` empty; after handoff, the operator may add the live mapping in `lib/agents/admin.ts` before running the smoke. If a contract gap is discovered mid-sprint that would require Codex to edit another `lib/agents/` file or to change `admin.ts` behavior, Codex stops and flips this sprint to `PENDING REVIEW` instead of editing in place.
- **D7. Healthcheck shape.** The Compose healthcheck uses `["CMD-SHELL", "test -f /tmp/healthy && find /tmp/healthy -mmin -2 >/dev/null 2>&1"]`, copied verbatim from `AGENTIC_EXPANSIONV2.md` §15. Reason: the heartbeat loop (`lib/agents/heartbeat.ts`) writes `/tmp/healthy` on a 30-second tick; a 2-minute mtime tolerance accommodates the heartbeat interval plus container clock skew without false-flagging healthy agents.
- **D8. Smoke runbook is markdown only.** The deploy smoke checklist (AEV2-509) ships as `docs/ops/agents-deploy-smoke.md` — not as a script. Codex does NOT write a smoke runner. The user walks each item by hand because most steps require live Discord interaction. Sprint 4's "completion" of AEV2-509 means the markdown exists and matches the External Validation Checklist below — actual smoke execution is the user's responsibility (see External Validation Checklist).
- **D9. `NEXUS_API_URL` is bot-only.** `NEXUS_API_URL` is consumed exclusively by the `discord-bot` Compose service and is referenced nowhere in `lib/agents/`. The three agent services (`orchestrator`, `small-cap-trader`, `swing-trader`) talk to Neon directly and to the LLM lanes via the `INTERACTIVE_LLM_API_BASE_URL` / `BACKGROUND_LLM_API_BASE_URL` env vars — they do NOT need `NEXUS_API_URL` and Codex must NOT add it to any agent service env block. Reason: the var is a Sprint-4 introduction not present in `AGENTIC_EXPANSIONV2.md` §19; making the bot the only consumer keeps the agent attack surface small.
- **D10. discord-bot service has no `DATABASE_URL`.** The `discord-bot` Compose env block in this spec deliberately omits `DATABASE_URL` (which `AGENTIC_EXPANSIONV2.md` §15 lists). Reason: the bot only talks HTTP to the Nexus API and has no DB client. Adding `DATABASE_URL` would needlessly leak the Neon credential into a service that does not use it. This is an intentional deviation from §15.

### Planned File Actions

**New files:**

- [`services/agent.Dockerfile`](/home/jared/Nexus-Terminal/services/agent.Dockerfile) — Node 20 Alpine image for the three agent services. WORKDIR `/app`, COPY `package.json package-lock.json tsconfig.json ./`, `RUN npm ci && npm install -g tsx@4`, COPY `lib/ ./lib/`, COPY `services/agent-entrypoint.ts ./services/`, CMD `["tsx", "services/agent-entrypoint.ts"]`.
- [`services/agent-entrypoint.ts`](/home/jared/Nexus-Terminal/services/agent-entrypoint.ts) — boots one agent service. Reads `AGENT_ID` env, validates via `AGENT_CONFIGS`, resolves `db = getAgentDb()` (throw if null), starts `startMacroCron(db)` only when `agentId === 'orchestrator'`, starts `startWorker({ agentId, pollIntervalMs, agentConfig: AGENT_CONFIGS[agentId] })`, wires `SIGINT`/`SIGTERM` to call the returned `stop()` handles in order (worker first, then macro cron) and then `process.exit(0)`.
- [`services/tsconfig.json`](/home/jared/Nexus-Terminal/services/tsconfig.json) — extends the root tsconfig minimally and inherits the repo-root `@/*` path alias without overriding it. `include: ["agent-entrypoint.ts", "discord-bot/index.ts", "../lib/**/*.ts"]`, `exclude: ["../node_modules", "../.next", "discord-bot/node_modules"]`. Compiles under `tsc -p services/tsconfig.json --noEmit` once the bot dependencies are installed locally in `services/discord-bot/`.
- [`services/discord-bot/index.ts`](/home/jared/Nexus-Terminal/services/discord-bot/index.ts) — TypeScript bot entrypoint. Uses `discord.js@14` `Client` with `GatewayIntentBits.Guilds | GuildMessages | MessageContent`. Listens on `messageCreate` only in the `#orchestrator` channel (resolved by name from the configured `DISCORD_GUILD_ID`). For each non-bot message, posts to `${NEXUS_API_URL}/api/agents/service/chat` with `x-agent-service-key` header and body `{ message, discord_user_id: msg.author.id, channel: 'discord', session_id: 'discord:<author>:<channel>' }` (a stable per-author/per-channel string so the Orchestrator can reuse `agent_conversations` rows). On 201, polls `GET /api/agents/service/chat?job_id=<id>` every 2s for up to 60 attempts (120s). On `completed` with `result.message`, posts an embed with title `Orchestrator`, color `0x10B981`, description = result.message (truncated to 4000 chars + `… (truncated — see logs)` suffix if longer); on `completed` with `result.routed === true`, replies `Routed to specialist (job: <specialistJobId>)`; on `failed`, replies `Request failed (job: <jobId>). Check the agent logs.` and logs the upstream error body server-side only; on timeout, replies `Request timed out after 120s (job: <jobId>).`; on any HTTP error from the Nexus API (4xx/5xx), replies `Nexus API rejected the request (status N).` (NEVER echoes the upstream response body to Discord). Never calls `/api/agents/admin/*` or any user-facing route.
- [`services/discord-bot/package.json`](/home/jared/Nexus-Terminal/services/discord-bot/package.json) — `name: "nexus-discord-bot"`, `version: "0.1.0"`, `private: true`, `type: "module"`, `scripts: { "start": "tsx index.ts" }`, `dependencies: { "discord.js": "^14.16.3", "tsx": "^4.19.2" }`, `engines: { "node": ">=20" }`. Codex generates and commits `services/discord-bot/package-lock.json`, then runs `cd services/discord-bot && npm ci` once during Checkpoint 3 so the local typecheck gate can resolve the bot dependencies.
- [`services/discord-bot/tsconfig.json`](/home/jared/Nexus-Terminal/services/discord-bot/tsconfig.json) — minimal local tsconfig for in-container compile via `tsx`. Targets Node 20, ESM, strict. Only used at runtime by `tsx`; the Sprint 4 typecheck gate runs through `services/tsconfig.json` instead.
- [`services/discord-bot/Dockerfile`](/home/jared/Nexus-Terminal/services/discord-bot/Dockerfile) — Node 20 Alpine, WORKDIR `/app`, COPY `package.json package-lock.json ./`, `RUN npm ci`, COPY `index.ts tsconfig.json ./`, CMD `["npx", "tsx", "index.ts"]`.
- [`scripts/ops/agent-observability.sql`](/home/jared/Nexus-Terminal/scripts/ops/agent-observability.sql) — read-only SQL queries the operator can paste into Drizzle Studio or `psql`. Covers: queue depth, oldest queued job age, jobs stuck in `processing` past lease expiry, missed `agent_scheduled_runs` (today's row not present after cron hour), `agent_reports.delivery_failed` count by day, `agent_registry.last_heartbeat` freshness, and recent `agent_request_log` totals by lane. Each query is named with a `-- name: ...` comment so the operator can grep for one block at a time.
- [`docs/ops/agents-rollback.md`](/home/jared/Nexus-Terminal/docs/ops/agents-rollback.md) — step-by-step rollback. Covers app rollback (`vercel rollback` to the last green deploy), Docker service rollback (`docker compose down && git checkout <prior tag> && docker compose up -d --build`), and migration 0019 partial-failure recovery (manual `psql` block that drops the new tables in reverse FK order if a future re-migrate is needed).
- [`docs/ops/home-server-recovery.md`](/home/jared/Nexus-Terminal/docs/ops/home-server-recovery.md) — reboot/recovery procedure for the WSL2 home server. Documents `wsl --shutdown` recovery, Docker daemon restart (`sudo systemctl start docker`), `docker compose up -d` after reboot, healthcheck verification (`docker compose ps` should show the three agent services as `healthy` and `discord-bot` as `Up`/running), and the exact reboot order after an ISP outage or power loss.
- [`docs/ops/agents-deploy-smoke.md`](/home/jared/Nexus-Terminal/docs/ops/agents-deploy-smoke.md) — the manual smoke checklist matching the External Validation Checklist below. Each item is a checkbox plus the exact command or Discord interaction to run, plus the expected result.
- [`docs/ops/agents-launch-validation.md`](/home/jared/Nexus-Terminal/docs/ops/agents-launch-validation.md) — pre-launch config and secret re-validation checklist (AEV2-510). Documents how to re-verify the lane keys, base URLs, models, the two service/admin keys, and the six webhook URLs against `services/.env` before `docker compose up -d`.
- [`docs/ops/agents-backup-restore.md`](/home/jared/Nexus-Terminal/docs/ops/agents-backup-restore.md) — retroactive Neon backup/restore doc. Documents the Neon "branch" pattern as the canonical backup mechanism and leaves branch IDs or any user-specific notes as placeholders unless the user provides them. Lives in `docs/ops/` even though `AGENTIC_EXPANSIONV2.md` §16 originally assigned it to EPIC-2 — Sprint 4 lands it as a launch-readiness artifact since EPIC-2 closed without it.
- [`.dockerignore`](/home/jared/Nexus-Terminal/.dockerignore) — repo-root ignore so the agent image build context stays small. Excludes `node_modules`, `.next`, `app`, `components`, `hooks`, `public`, `__tests__`, `drizzle`, `scripts`, `docs`, `services/.env`, `services/discord-bot/node_modules`, `*.log`, plus `.git`, `.github`, `.vscode`, `.claude`, `coverage`, `.env*`. If it also excludes general markdown files, it MUST re-include `!lib/agents/prompts/*.md` so the runtime prompt files remain in the image. (The `.git` exclusion alone trims ~100MB+ from the build context.)

**Modified files:**

- [`services/docker-compose.yml`](/home/jared/Nexus-Terminal/services/docker-compose.yml) — full rewrite per D7 and the inline contract below (NOT the stale §15 example). Removes the `redis` service entirely, removes the `redis-data` volume, drops the deprecated top-level `version:` field, removes `TRADE_WEBHOOK_SECRET` from the bot environment, replaces the `discord-bot` build context to point at `./discord-bot` (which now actually exists), adds the three agent services (`orchestrator`, `small-cap-trader`, `swing-trader`) with the inline env block, healthcheck (with `start_period: 60s`), `restart: unless-stopped`, `stop_grace_period: 30s`, and json-file logging block from the contract. The two trader services also pass through `ASKEDGAR_DAILY_LIMIT` and `TRADINGVIEW_SESSION_ID` because the live blueprints read them at runtime. `NEXUS_API_URL` is referenced ONLY in the discord-bot service (per D9). Codex leaves the value as `${NEXUS_API_URL}` and the operator fills it via `services/.env`.
- [`services/.env.example`](/home/jared/Nexus-Terminal/services/.env.example) — additive only. Adds the missing entries listed in "Current State" above (`INTERACTIVE_LLM_TIMEOUT_MS=30000`, `BACKGROUND_LLM_TIMEOUT_MS=60000`, the six `AGENT_*` caps with their runtime defaults, `ASKEDGAR_DAILY_LIMIT=100`, `TRADINGVIEW_SESSION_ID=` blank, `MACRO_HEADLINES_URLS=` blank with the fallback URL list as a comment line above it, `NEXUS_API_URL=` blank, `MASSIVE_API_BASE_URL=https://api.polygon.io`). Adds a one-line comment above `MASSIVE_API_KEY` clarifying it is Docker-side only. Does NOT remove or rename existing entries.
- [`package.json`](/home/jared/Nexus-Terminal/package.json) — adds exactly one script: `"typecheck:services": "tsc -p services/tsconfig.json --noEmit"`. No new dependencies. No other changes.
- [`HANDOFF.md`](/home/jared/Nexus-Terminal/HANDOFF.md) — updated after each checkpoint closes.

**Explicitly NOT modified:**

- Any file under `lib/agents/`, including `lib/agents/admin.ts` (per D6).
- Any file under `app/api/`, including `app/api/agents/`.
- Any file under `lib/validations/`.
- Any file under `__tests__/`. Sprint 4 has no new vitest tests.
- `lib/db/schema.ts`. No new tables.
- `tsconfig.json` (root). The new `services/tsconfig.json` is independent.
- `next.config.ts`, `middleware.ts`, `eslint.config.js`, `vitest.config.ts`.
- `services/.env`. Codex must never read, copy, edit, or commit this file.
- The root `package.json` `dependencies` / `devDependencies` blocks. `discord.js` and `tsx` live exclusively under `services/discord-bot/`.

### Security And Correctness Notes

- The Docker image must NOT bake any secret in. Every secret arrives via `services/.env` -> Compose `environment:` block -> `process.env.*`. Codex does not write a secret value into any committed file.
- The `.dockerignore` MUST exclude `services/.env` so a stray rebuild does not leak credentials into the image layer.
- The Discord bot must NOT call `/api/agents/admin/*` or `/api/agents/reports`/`/api/agents/research`. Only `/api/agents/service/chat` POST and GET. This is enforced by the bot source — there is no admin client and no admin key on the bot side. The bot's only credential is `AGENT_SERVICE_KEY`.
- The bot also must NOT log the message body, the service key, or any portion of the Nexus API response that could contain user data. Logging is `console.log` with structured fields: `event`, `discord_user_id`, `job_id`, `status`. Never log `message`, `result`, or `error`.
- The healthcheck uses a 2-minute mtime tolerance via `find -mmin -2`. If the operator changes the heartbeat interval above ~90s in `lib/agents/heartbeat.ts` after Sprint 4, the healthcheck will start false-flagging — note this in `agents-launch-validation.md`.
- `services/agent-entrypoint.ts` MUST NOT swallow `db === null`. If `getAgentDb()` returns null, the entrypoint logs a single structured error and exits with code `1` so Compose's restart policy + the user's eyes catch it immediately.
- The agent services run as the default `node` user from the Node Alpine image — do NOT add a `USER root` directive. The healthcheck file `/tmp/healthy` is writable by `node` since `/tmp` is world-writable in Alpine.
- `services/.env.example` additions must not include any real secret. Use empty values or commented examples only.
- The retroactive `agents-backup-restore.md` doc records the canonical Neon branch backup/restore flow. It may reference real branch IDs only if the user provides them; otherwise leave the branch ID line as a placeholder for the user to fill. Do not invent branch IDs.

### Execution Contracts

These are the inline shapes Codex needs to write the new files without consulting `AGENTIC_EXPANSIONV2.md`. Where the design doc and the current Sprint 3 runtime disagree (notably the entrypoint signature), the runtime is authoritative.

#### `services/agent.Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund --prefer-offline \
  && npm install -g tsx@4 --no-audit --no-fund

COPY lib/ ./lib/
COPY services/agent-entrypoint.ts ./services/agent-entrypoint.ts

# NODE_ENV set AFTER npm ci so devDependencies install (see D1).
ENV NODE_ENV=production

# Compose owns the healthcheck — explicitly disable any Dockerfile-level check.
HEALTHCHECK NONE

# Run as the non-root `node` user that ships with the Alpine image.
USER node

CMD ["tsx", "services/agent-entrypoint.ts"]
```

Notes:
- `npm ci` (NOT `--production`) per D1. The `--no-audit --no-fund --prefer-offline` flags trim ~30s of npm chatter from each build.
- `tsx` is installed globally (`-g`) so it does not mutate the committed `package.json` lockfile contents.
- `USER node` switches to the unprivileged user that ships with `node:20-alpine`. `/tmp` is world-writable so the heartbeat can still write `/tmp/healthy`.
- The image does NOT install or run any Next.js code path. It only runs the agent entrypoint.
- Healthcheck is wired in `docker-compose.yml`, not the Dockerfile, so the same image can be reused if a future smoke run wants a different healthcheck.

#### `services/agent-entrypoint.ts`

```ts
import { startWorker } from '../lib/agents/worker';
import { startMacroCron } from '../lib/agents/macro-cron';
import { AGENT_CONFIGS } from '../lib/agents/config';
import { getAgentDb } from '../lib/agents/db';
import type { AgentId } from '../lib/agents/types';

async function main() {
  const agentId = process.env.AGENT_ID as AgentId | undefined;
  if (!agentId || !(agentId in AGENT_CONFIGS)) {
    console.error(JSON.stringify({ event: 'entrypoint.unknown_agent_id', agentId }));
    process.exit(1);
  }

  const db = getAgentDb();
  if (!db) {
    console.error(JSON.stringify({ event: 'entrypoint.db_unavailable', agentId }));
    process.exit(1);
  }

  const pollIntervalMs = Number(process.env.AGENT_POLL_INTERVAL_MS) || 5000;

  const macroCron = agentId === 'orchestrator' ? startMacroCron(db) : null;

  const worker = await startWorker({
    agentId,
    pollIntervalMs,
    agentConfig: AGENT_CONFIGS[agentId],
  });

  console.log(JSON.stringify({ event: 'entrypoint.started', agentId, pollIntervalMs }));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // guard against SIGTERM+SIGINT double-fire
    shuttingDown = true;
    console.log(JSON.stringify({ event: 'entrypoint.shutdown_begin', agentId, signal }));
    try {
      await worker.stop();
      if (macroCron) {
        await macroCron.stop();
      }
      console.log(JSON.stringify({ event: 'entrypoint.shutdown_complete', agentId }));
      process.exit(0);
    } catch (error) {
      console.error(JSON.stringify({ event: 'entrypoint.shutdown_failed', agentId, error: String(error) }));
      process.exit(1);
    }
  };

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}

void main();
```

Notes:
- The example in `AGENTIC_EXPANSIONV2.md` §15 is stale — it calls `startMacroCron()` with no args and `startWorker({ blueprintResolver })`. Use the signatures above, which match the Sprint 3 runtime.
- The entrypoint never imports anything from `app/` or `services/discord-bot/`.
- All log lines are JSON one-liners so Docker's json-file driver stays scrapable.

#### `services/tsconfig.json`

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".."
  },
  "include": [
    "agent-entrypoint.ts",
    "discord-bot/index.ts",
    "../lib/**/*.ts"
  ],
  "exclude": [
    "../node_modules",
    "../.next",
    "discord-bot/node_modules"
  ]
}
```

Notes:
- Root `tsconfig.json` excludes `services/`, so the service-side check needs its own config. This file does NOT touch the root tsconfig.
- `"extends": "../tsconfig.json"` inherits strict mode and all the existing compiler options from the root.
- Do NOT override `baseUrl` or `paths` here. The inherited repo-root alias already resolves `@/*` correctly.
- Including `../lib/**/*.ts` means a type drift in `lib/agents/*` is caught when Codex (or the user) runs the new `npm run typecheck:services` script.
- `discord-bot/node_modules` is excluded so the bot's `discord.js` types don't double-resolve.

#### `services/docker-compose.yml`

The full rewrite must match the inline contract below. `AGENTIC_EXPANSIONV2.md` §15 is the original source but is incomplete (missing `start_period`, `stop_grace_period`, deprecated `version` field, missing `AGENT_*` cap details). Use the YAML below verbatim — do NOT consult §15 mid-execution.

1. Drop `redis` service and `redis-data` volume completely.
2. Drop the top-level `version:` field entirely. Compose v2 ignores it and emits a deprecation warning. Removing it keeps smoke logs clean.
3. The `discord-bot` service block becomes:

```yaml
  discord-bot:
    build:
      context: ./discord-bot
    environment:
      - NODE_ENV=production
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID}
      - DISCORD_GUILD_ID=${DISCORD_GUILD_ID}
      - NEXUS_API_URL=${NEXUS_API_URL}
      - AGENT_SERVICE_KEY=${AGENT_SERVICE_KEY}
    restart: unless-stopped
    stop_grace_period: 15s
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"
```

Per D10, `DATABASE_URL` is intentionally absent from the bot's env block.

4. Each of the three agent services (`orchestrator`, `small-cap-trader`, `swing-trader`) follows this representative shape (orchestrator shown — repeat for the other two with the diffs in step 5):

```yaml
  orchestrator:
    build:
      context: ..
      dockerfile: services/agent.Dockerfile
    environment:
      - AGENT_ID=orchestrator
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - INTERACTIVE_LLM_API_KEY=${INTERACTIVE_LLM_API_KEY}
      - INTERACTIVE_LLM_API_BASE_URL=${INTERACTIVE_LLM_API_BASE_URL}
      - INTERACTIVE_LLM_MODEL=${INTERACTIVE_LLM_MODEL}
      - INTERACTIVE_LLM_TIMEOUT_MS=${INTERACTIVE_LLM_TIMEOUT_MS}
      - BACKGROUND_LLM_API_KEY=${BACKGROUND_LLM_API_KEY}
      - BACKGROUND_LLM_API_BASE_URL=${BACKGROUND_LLM_API_BASE_URL}
      - BACKGROUND_LLM_MODEL=${BACKGROUND_LLM_MODEL}
      - BACKGROUND_LLM_TIMEOUT_MS=${BACKGROUND_LLM_TIMEOUT_MS}
      - AGENT_DAILY_BUDGET_CENTS=${AGENT_DAILY_BUDGET_CENTS}
      - AGENT_MONTHLY_BUDGET_CENTS=${AGENT_MONTHLY_BUDGET_CENTS}
      - AGENT_MAX_CONTEXT_TOKENS=${AGENT_MAX_CONTEXT_TOKENS}
      - AGENT_MAX_SCAN_CANDIDATES=${AGENT_MAX_SCAN_CANDIDATES}
      - AGENT_MAX_PATTERN_HISTORY=${AGENT_MAX_PATTERN_HISTORY}
      - AGENT_MAX_RETRIES_PER_STEP=${AGENT_MAX_RETRIES_PER_STEP}
      - AGENT_POLL_INTERVAL_MS=${AGENT_POLL_INTERVAL_MS}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
      - MASSIVE_API_KEY=${MASSIVE_API_KEY}
      - MACRO_CRON_HOUR=${MACRO_CRON_HOUR}
      - MACRO_HEADLINES_URLS=${MACRO_HEADLINES_URLS}
      - DISCORD_WEBHOOK_MACRO_DAILY=${DISCORD_WEBHOOK_MACRO_DAILY}
      - DISCORD_WEBHOOK_SYSTEM=${DISCORD_WEBHOOK_SYSTEM}
      - TZ=${TZ}
    restart: unless-stopped
    stop_grace_period: 30s
    healthcheck:
      test: ["CMD-SHELL", "test -f /tmp/healthy && find /tmp/healthy -mmin -2 >/dev/null 2>&1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"
```

5. Diffs for the other two agent services (relative to the orchestrator block above):
   - `small-cap-trader`: change `AGENT_ID=small-cap-trader`. Remove `MACRO_CRON_HOUR`, `MACRO_HEADLINES_URLS`, `DISCORD_WEBHOOK_MACRO_DAILY`, `DISCORD_WEBHOOK_SYSTEM`. Add `ASKEDGAR_DAILY_LIMIT=${ASKEDGAR_DAILY_LIMIT}`, `TRADINGVIEW_SESSION_ID=${TRADINGVIEW_SESSION_ID}`, `DISCORD_WEBHOOK_SCANS=${DISCORD_WEBHOOK_SCANS}`, and `DISCORD_WEBHOOK_RESEARCH=${DISCORD_WEBHOOK_RESEARCH}`.
   - `swing-trader`: change `AGENT_ID=swing-trader`. Remove `MACRO_CRON_HOUR`, `MACRO_HEADLINES_URLS`, `DISCORD_WEBHOOK_MACRO_DAILY`, `DISCORD_WEBHOOK_SYSTEM`. Add `ASKEDGAR_DAILY_LIMIT=${ASKEDGAR_DAILY_LIMIT}`, `TRADINGVIEW_SESSION_ID=${TRADINGVIEW_SESSION_ID}`, `DISCORD_WEBHOOK_SWING_SETUPS=${DISCORD_WEBHOOK_SWING_SETUPS}`, and `DISCORD_WEBHOOK_SWING_ALERTS=${DISCORD_WEBHOOK_SWING_ALERTS}`.

6. Codex does NOT introduce a network override, a custom Compose project name, or a `depends_on` block — all four services are independent (Discord bot polls Nexus API over the public URL, agents poll Neon directly).
7. `start_period: 60s` exists because the worker takes ~10–20s to boot before writing `/tmp/healthy`; without it the first ~3 healthchecks would fail and Docker would briefly mark the container `unhealthy`.
8. `stop_grace_period: 30s` exists because a stuck LLM call can take >10s to abort during shutdown; Docker's default is 10s, after which it `SIGKILL`s mid-cleanup.

#### `services/discord-bot/index.ts`

Skeleton (Codex fills in the message handler body). `discord.js` v14 client, intents `Guilds | GuildMessages | MessageContent`, listens on `messageCreate`, filters to the channel resolved by name `'orchestrator'` inside the configured guild, then implements the request/poll/reply flow described in the New Files block above. Concrete contract:

```ts
import { Client, GatewayIntentBits, EmbedBuilder, ChannelType, type Message } from 'discord.js';

const NEXUS_API_URL = process.env.NEXUS_API_URL;
const AGENT_SERVICE_KEY = process.env.AGENT_SERVICE_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const ORCHESTRATOR_CHANNEL_NAME = 'orchestrator';
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 60;
// 4000 leaves 96 chars of headroom under Discord's 4096 embed cap for the truncation suffix.
const EMBED_DESCRIPTION_LIMIT = 4000;
const TRUNCATION_SUFFIX = '\n\n… (truncated — see logs)';

const REQUIRED_ENV: Record<string, string | undefined> = {
  NEXUS_API_URL,
  AGENT_SERVICE_KEY,
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
};
const missing = Object.entries(REQUIRED_ENV).filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  console.error(JSON.stringify({ event: 'bot.missing_env', missing }));
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('ready', () => {
  console.log(JSON.stringify({ event: 'bot.ready', user: client.user?.tag }));
});

client.on('messageCreate', async (msg: Message) => {
  if (msg.author.bot) return;
  if (msg.guildId !== DISCORD_GUILD_ID) return;
  if (msg.channel.type !== ChannelType.GuildText) return;
  if (msg.channel.name !== ORCHESTRATOR_CHANNEL_NAME) return;

  const sessionId = `discord:${msg.author.id}:${msg.channelId}`;
  let createResponse: Response;
  try {
    createResponse = await fetch(`${NEXUS_API_URL}/api/agents/service/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-service-key': AGENT_SERVICE_KEY!,
      },
      body: JSON.stringify({
        message: msg.content,
        discord_user_id: msg.author.id,
        channel: 'discord',
        session_id: sessionId,
      }),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'bot.create_failed', discord_user_id: msg.author.id, error: String(error) }));
    await msg.reply('Failed to reach Nexus API.');
    return;
  }

  if (!createResponse.ok) {
    // Read and discard the body server-side; never echo it to Discord (could leak auth detail).
    const text = await createResponse.text().catch(() => '');
    console.error(JSON.stringify({ event: 'bot.create_http_error', status: createResponse.status, body: text.slice(0, 500) }));
    await msg.reply(`Nexus API rejected the request (status ${createResponse.status}).`);
    return;
  }

  const created = (await createResponse.json()) as { job_id?: string };
  const jobId = created.job_id;
  if (!jobId) {
    await msg.reply('Nexus API returned no job_id.');
    return;
  }

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let pollResponse: Response;
    try {
      pollResponse = await fetch(`${NEXUS_API_URL}/api/agents/service/chat?job_id=${encodeURIComponent(jobId)}`, {
        headers: { 'x-agent-service-key': AGENT_SERVICE_KEY! },
      });
    } catch (error) {
      // Log at warn-style after first failure to avoid log spam under flapping network conditions.
      console.warn(JSON.stringify({ event: 'bot.poll_failed', job_id: jobId, attempt, error: String(error) }));
      continue;
    }

    if (!pollResponse.ok) {
      console.warn(JSON.stringify({ event: 'bot.poll_http_error', job_id: jobId, attempt, status: pollResponse.status }));
      continue;
    }

    const body = (await pollResponse.json()) as {
      status: 'queued' | 'processing' | 'completed' | 'failed';
      result?: { message?: string; routed?: boolean; specialistJobId?: string };
      error?: { message?: string };
    };

    if (body.status === 'completed') {
      if (body.result?.routed) {
        await msg.reply(`Routed to specialist (job: ${body.result.specialistJobId ?? 'unknown'}).`);
        return;
      }
      const raw = body.result?.message ?? '';
      const description = raw.length > EMBED_DESCRIPTION_LIMIT
        ? raw.slice(0, EMBED_DESCRIPTION_LIMIT) + TRUNCATION_SUFFIX
        : raw;
      const embed = new EmbedBuilder()
        .setTitle('Orchestrator')
        .setColor(0x10b981)
        .setDescription(description);
      await msg.reply({ embeds: [embed] });
      return;
    }

    if (body.status === 'failed') {
      // Same rule as the create-error path: never echo a raw upstream error body.
      console.error(JSON.stringify({ event: 'bot.job_failed', job_id: jobId, error: body.error?.message }));
      await msg.reply(`Request failed (job: ${jobId}). Check the agent logs.`);
      return;
    }
  }

  await msg.reply(`Request timed out after 120s (job: ${jobId}).`);
});

void client.login(DISCORD_BOT_TOKEN);
```

Notes:
- Channel resolution is by name `'orchestrator'` per `AGENTIC_EXPANSIONV2.md` §20. If the operator renames the channel, update `ORCHESTRATOR_CHANNEL_NAME` and rebuild.
- The bot uses Node 20's built-in `fetch` and `Response` — no `node-fetch` dependency.
- The `session_id` shape `discord:<user>:<channel>` is intentionally stable so the Orchestrator can reuse `agent_conversations` rows for short multi-turn chats.
- The bot logs structured JSON only; never logs `msg.content` or `body.result.message`.

#### `services/discord-bot/package.json`

```json
{
  "name": "nexus-discord-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx index.ts"
  },
  "dependencies": {
    "discord.js": "^14.16.3",
    "tsx": "^4.19.2"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Codex generates `services/discord-bot/package-lock.json` by running `npm install` inside `services/discord-bot/` once and committing the result. The bot directory's `node_modules/` stays gitignored (root `.gitignore` already covers `**/node_modules`).

#### `services/discord-bot/Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.ts tsconfig.json ./

ENV NODE_ENV=production

CMD ["npx", "tsx", "index.ts"]
```

#### `services/discord-bot/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["index.ts"]
}
```

Notes:
- This config is only used at runtime by `tsx`. The Sprint 4 typecheck gate runs through `services/tsconfig.json` (the parent), not this file.
- `types: ["node"]` is required so the bot can use `Response` and `fetch` typings without pulling DOM types.

#### `scripts/ops/agent-observability.sql`

```sql
-- name: queue-depth
-- Eligible queued jobs awaiting a worker.
SELECT count(*) AS queued_jobs
FROM agent_jobs
WHERE status = 'queued'
  AND (next_retry_at IS NULL OR next_retry_at <= now());

-- name: oldest-queued-job-age
-- Age (seconds) of the oldest eligible queued job.
SELECT extract(epoch FROM (now() - min(created_at)))::int AS oldest_age_seconds
FROM agent_jobs
WHERE status = 'queued'
  AND (next_retry_at IS NULL OR next_retry_at <= now());

-- name: stuck-processing
-- Jobs in processing past lease expiry or with stale heartbeat.
-- Threshold = 10 × JOB_LEASE_HEARTBEAT_INTERVAL_MS.
-- With JOB_LEASE_HEARTBEAT_INTERVAL_MS = 60s in lib/agents/worker.ts:23, the stale-heartbeat threshold is 10 minutes.
SELECT id, agent_id, locked_by, lock_expires_at, last_heartbeat_at
FROM agent_jobs
WHERE status = 'processing'
  AND (lock_expires_at < now() OR last_heartbeat_at < now() - interval '10 minutes');

-- name: missed-macro-summary
-- Today's macro-summary scheduled run row, if present.
-- `agent_scheduled_runs.trading_date` is stored as ISO `YYYY-MM-DD` text in the live schema/runtime.
-- Zero rows after the configured cron hour means the run was missed.
SELECT id, status, started_at, completed_at, job_id
FROM agent_scheduled_runs
WHERE agent_id = 'orchestrator'
  AND trigger_type = 'macro-summary'
  AND trading_date = to_char((now() AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD');

-- name: delivery-failures-by-day
-- Failed Discord deliveries grouped by UTC day, last 7 days.
SELECT date_trunc('day', created_at) AS day, count(*) AS failed_deliveries
FROM agent_reports
WHERE status = 'delivery_failed'
  AND created_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;

-- name: agent-heartbeat-freshness
-- Last heartbeat per agent and the seconds since.
SELECT id, status, last_heartbeat,
       extract(epoch FROM (now() - last_heartbeat))::int AS seconds_since_heartbeat
FROM agent_registry
ORDER BY id;

-- name: token-totals-today
-- Token usage and cost by lane, current UTC day.
SELECT lane,
       sum(input_tokens + output_tokens) AS total_tokens,
       sum(estimated_cost_cents) AS total_cost_cents,
       count(*) AS total_requests
FROM agent_request_log
WHERE created_at >= date_trunc('day', now())
GROUP BY lane;
```

Codex must not invent column names. The fan-out review confirmed every column above resolves cleanly against `lib/db/schema.ts` as of 2026-04-08, so all seven queries SHALL be present in the final file. If Codex discovers during execution that a column has drifted, STOP and flip Sprint 4 to `PENDING REVIEW` instead of dropping the query — partial SQL is worse than a paused sprint.

Checkpoint 5 is intentionally SQL-only. It does NOT add new `/api/agents/admin/stats` fields. The `AGENTIC_EXPANSIONV2.md` §16 "container restart loops" observability requirement is satisfied by the later ops docs and smoke commands (`docker compose ps`, `docker compose logs`) in Checkpoints 6 and 7, not by this SQL file.

#### `docs/ops/agents-rollback.md`, `docs/ops/home-server-recovery.md`, `docs/ops/agents-deploy-smoke.md`, `docs/ops/agents-launch-validation.md`, `docs/ops/agents-backup-restore.md`

These are markdown runbooks. Length target: 100–200 lines each. Codex writes them based on the items in `AGENTIC_EXPANSIONV2.md` §16 plus the External Validation Checklist below. No code blocks beyond the actual commands the operator must run. No marketing language.

The smoke runbook (`agents-deploy-smoke.md`) MUST be a 1:1 mirror of the External Validation Checklist below — same checkboxes, same order, same expected outputs. The user runs that file as the canonical smoke after Sprint 4 lands.

### Order Of Operations

1. Land the Dockerfile, the `.dockerignore`, and the entrypoint together (Checkpoint 1).
2. Land the Compose rewrite + the `.env.example` additions next so the container topology compiles (Checkpoint 2).
3. Land the Discord bot directory tree (Checkpoint 3).
4. Land `services/tsconfig.json` and the `package.json` script for AEV2-506 typecheck gate (Checkpoint 4).
5. Land `scripts/ops/agent-observability.sql` (Checkpoint 5).
6. Land the four (+1 retroactive) ops markdown files (Checkpoint 6).
7. Final repo-wide validation + HANDOFF.md collapse readiness (Checkpoint 7).

### Checkpoint 1 — Agent Image + Entrypoint

**Stories:** `AEV2-501`

**Review focus:** confirm the Dockerfile copies only `lib/`, `services/agent-entrypoint.ts`, and the package metadata; the entrypoint resolves the DB once and passes `agentConfig` (not `blueprintResolver`); SIGTERM/SIGINT cleanly stop the worker and the macro cron in order; `.dockerignore` excludes `services/.env` while preserving `lib/agents/prompts/*.md`.

**Suggested commit:** `feat(aev2): add agent docker image and service entrypoint`

**Check off before commit**

- [x] `services/agent.Dockerfile` matches the contract verbatim — `npm ci` (NOT `--production`), `npm install -g tsx@4`, COPY `lib/`, COPY entrypoint, CMD `["tsx", "services/agent-entrypoint.ts"]`.
- [x] `services/agent-entrypoint.ts` calls `getAgentDb()` once, exits with code `1` on null, starts `startMacroCron(db)` only for `agentId === 'orchestrator'`, and starts `startWorker({ agentId, pollIntervalMs, agentConfig: AGENT_CONFIGS[agentId] })`.
- [x] Entrypoint logs structured JSON, never logs message bodies or secrets, and shuts down worker before macro cron on SIGTERM/SIGINT.
- [x] `.dockerignore` exists at the repo root and excludes `services/.env`, `node_modules`, `.next`, `app`, `components`, `hooks`, `public`, `__tests__`, `drizzle`, `scripts`, `docs`, `services/discord-bot/node_modules`, and `*.log`. If it excludes general markdown files, it explicitly keeps `!lib/agents/prompts/*.md`.
- [x] Entrypoint compiles under the existing root `npx tsc --noEmit` (it lives in `services/`, which is excluded — it must NOT trip the existing `tsc` baseline). Service-side typecheck is verified in Checkpoint 4.

**Exit criteria**

- [x] Image instructions are reproducible: `docker build -f services/agent.Dockerfile .` would succeed conceptually (Codex does NOT execute Docker — see Checkpoint 7 for the user's manual build step).
- [x] Entrypoint stop order is documented in the file as a comment: worker first, macro cron second.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`

**STOP. Review. Commit. Then continue.**

### Checkpoint 2 — Compose Rewrite + .env.example

**Stories:** `AEV2-502`, `AEV2-503`

**Review focus:** confirm `services/docker-compose.yml` removes `redis` entirely, all four services have the env block + healthcheck + logging block, and `services/.env.example` gains every missing entry without removing anything that already exists.

**Suggested commit:** `feat(aev2): rewrite docker compose for v1 topology`

**Check off before commit**

- [ ] `services/docker-compose.yml` has exactly four services: `discord-bot`, `orchestrator`, `small-cap-trader`, `swing-trader`. No `redis` service. No `redis-data` volume. No `volumes:` block at the bottom unless something new is required.
- [ ] Each agent service uses `build.context: ..` and `dockerfile: services/agent.Dockerfile`. Each agent service lists every env var from the inline Compose contract above plus the agent-specific webhook URLs.
- [ ] Orchestrator service additionally passes `MACRO_CRON_HOUR=${MACRO_CRON_HOUR}` and pulls `DISCORD_WEBHOOK_MACRO_DAILY` + `DISCORD_WEBHOOK_SYSTEM`.
- [ ] Small-cap service pulls `ASKEDGAR_DAILY_LIMIT`, `TRADINGVIEW_SESSION_ID`, `DISCORD_WEBHOOK_SCANS`, and `DISCORD_WEBHOOK_RESEARCH`.
- [ ] Swing-trader service pulls `ASKEDGAR_DAILY_LIMIT`, `TRADINGVIEW_SESSION_ID`, `DISCORD_WEBHOOK_SWING_SETUPS`, and `DISCORD_WEBHOOK_SWING_ALERTS`.
- [ ] Each agent service has the `["CMD-SHELL", "test -f /tmp/healthy && find /tmp/healthy -mmin -2 >/dev/null 2>&1"]` healthcheck with `interval: 30s`, `timeout: 10s`, `retries: 3`, `start_period: 60s`.
- [ ] Each agent service has `restart: unless-stopped`, `stop_grace_period: 30s`, and the json-file logging block with `max-size: "50m"` / `max-file: "3"`.
- [ ] The `discord-bot` service has `restart: unless-stopped` and `stop_grace_period: 15s` (not 30s — the bot has no LLM call to drain).
- [ ] `discord-bot` service builds from `./discord-bot`, drops `TRADE_WEBHOOK_SECRET`, omits `DATABASE_URL` per D10, and uses `NEXUS_API_URL=${NEXUS_API_URL}` (NOT `host.docker.internal:3000`).
- [ ] `NEXUS_API_URL` does NOT appear in any of the three agent service env blocks (per D9). It is bot-only.
- [ ] The top-level `version:` field is NOT present (Compose v2 deprecated it).
- [ ] `services/.env.example` adds the following entries (exact names + defaults from `lib/agents/llm-client.ts`). No existing entries removed.
  - `INTERACTIVE_LLM_TIMEOUT_MS=30000`
  - `BACKGROUND_LLM_TIMEOUT_MS=60000`
  - `AGENT_DAILY_BUDGET_CENTS=500`
  - `AGENT_MONTHLY_BUDGET_CENTS=10000`
  - `AGENT_MAX_CONTEXT_TOKENS=32000`
  - `AGENT_MAX_SCAN_CANDIDATES=20`
  - `AGENT_MAX_PATTERN_HISTORY=50`
  - `AGENT_MAX_RETRIES_PER_STEP=2`
  - `ASKEDGAR_DAILY_LIMIT=100`
  - `TRADINGVIEW_SESSION_ID=`
  - `MACRO_HEADLINES_URLS=` (blank — add a comment line above it: `# Default if unset: https://www.marketwatch.com/latest-news,https://finance.yahoo.com/topic/stock-market-news/`)
  - `NEXUS_API_URL=` (blank — public Vercel URL; bot-only per D9)
  - `MASSIVE_API_BASE_URL=https://api.polygon.io`
- [ ] `services/.env.example` adds a one-line comment above `MASSIVE_API_KEY` clarifying it is Docker-side only.
- [ ] Codex did NOT touch `services/.env`.

**Exit criteria**

- [ ] `docker compose -f services/docker-compose.yml config` would parse cleanly (Codex does NOT execute Docker in Sprint 4 — verified by user in Checkpoint 7).
- [ ] Every env var the agent runtime touches (per `Current State`) has a corresponding entry in `services/.env.example`.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`

**STOP. Review. Commit. Then continue.**

### Checkpoint 3 — Discord Bot Directory

**Stories:** `AEV2-504`, `AEV2-505`

**Review focus:** confirm the bot lives entirely under `services/discord-bot/`, only calls `/api/agents/service/chat`, never logs message bodies, and has its own `package.json` + `package-lock.json` so the root install never sees `discord.js`.

**Suggested commit:** `feat(aev2): add minimal discord bot runtime`

**Check off before commit**

- [x] `services/discord-bot/package.json`, `services/discord-bot/package-lock.json`, `services/discord-bot/tsconfig.json`, `services/discord-bot/Dockerfile`, and `services/discord-bot/index.ts` all exist.
- [x] `services/discord-bot/package.json` lists exactly two dependencies: `discord.js@^14.16.3` and `tsx@^4.19.2`. No dev dependencies. `type: "module"`. `engines.node: ">=20"`.
- [x] Root `package.json` has NOT gained `discord.js` or `tsx`.
- [x] `services/discord-bot/index.ts` matches the contract: `discord.js` v14 client with `Guilds | GuildMessages | MessageContent` intents, filters to channel name `'orchestrator'` in the configured `DISCORD_GUILD_ID`, posts to `/api/agents/service/chat` with the four required fields (`message`, `discord_user_id`, `channel: 'discord'`, `session_id`), polls every 2s up to 60 attempts, replies via `EmbedBuilder` for `completed`, plain reply for `failed`/routed/timeout, and logs only structured JSON without message bodies.
- [x] The bot exits with code `1` if any of the four required env vars (`NEXUS_API_URL`, `AGENT_SERVICE_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`) is missing.
- [x] The bot does NOT import or call `/api/agents/admin/*`, `/api/agents/reports`, or `/api/agents/research`.
- [x] The bot uses Node 20's built-in `fetch` — no `node-fetch` or `axios` dependency.
- [x] `services/discord-bot/Dockerfile` runs `npm ci` against the bot's own lockfile and CMD `["npx", "tsx", "index.ts"]`.

**Exit criteria**

- [x] `services/discord-bot/` is fully self-contained — running `npm ci` inside that directory installs everything the bot needs.
- [x] No root `package.json` change beyond what Checkpoint 4 introduces (the typecheck script).

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] (Manual) `cd services/discord-bot && npm ci` succeeds locally — verified once during the checkpoint, then the lockfile is committed.

**STOP. Review. Commit. Then continue.**

### Checkpoint 4 — Service-Side Typecheck Gate

**Stories:** `AEV2-506`

**Review focus:** confirm `services/tsconfig.json` compiles both entrypoints and the imported `lib/` surface, and that `npm run typecheck:services` is wired in `package.json` and exits 0 against the current tree after the one-time `cd services/discord-bot && npm ci` step from Checkpoint 3.

**Suggested commit:** `chore(aev2): add services typecheck gate`

**Check off before commit**

- [x] `services/tsconfig.json` exists and `extends` the root tsconfig.
- [x] `services/tsconfig.json` includes `agent-entrypoint.ts`, `discord-bot/index.ts`, and `../lib/**/*.ts`.
- [x] `services/tsconfig.json` excludes `../node_modules`, `../.next`, and `discord-bot/node_modules`.
- [x] `services/tsconfig.json` inherits the root `@/*` alias without redefining `baseUrl`/`paths` to point outside the repo.
- [x] Root `package.json` has exactly one new script: `"typecheck:services": "tsc -p services/tsconfig.json --noEmit"`.
- [x] `npm run typecheck:services` exits 0 against the current tree after the one-time `cd services/discord-bot && npm ci` step from Checkpoint 3.
- [x] Root `npm run lint` and `npx tsc --noEmit` still pass — the new tsconfig must not interfere with the existing root typecheck.
- [x] `npm test` still passes — vitest does NOT pick up `services/` files.

**Exit criteria**

- [x] AEV2-506 acceptance gate (service-side TypeScript validation) is now an automatable command the user can run from the repo root.
- [ ] The script is documented in `docs/ops/agents-launch-validation.md` (Checkpoint 6; deferred to that checkpoint).

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm run typecheck:services`
- [x] `npm test`

**STOP. Review. Commit. Then continue.**

### Checkpoint 5 — Observability SQL

**Stories:** `AEV2-507`

**Review focus:** confirm every SQL block references real columns from `lib/db/schema.ts`, queries are read-only, each block is named via a `-- name:` comment, and the live schema/runtime (not the older design-doc type hints) is the source of truth for `agent_scheduled_runs.trading_date`.

**Suggested commit:** `feat(aev2): add agent observability sql`

**Check off before commit**

- [x] `scripts/ops/agent-observability.sql` exists with all seven named queries from the contract: `queue-depth`, `oldest-queued-job-age`, `stuck-processing`, `missed-macro-summary`, `delivery-failures-by-day`, `agent-heartbeat-freshness`, `token-totals-today`.
- [x] Every table and column referenced by the seven SQL blocks exists in `lib/db/schema.ts`. Verify against the live schema file before committing; do NOT rely on older `AGENTIC_EXPANSIONV2.md` type hints.
- [x] `missed-macro-summary` treats `agent_scheduled_runs.trading_date` as ISO `YYYY-MM-DD` text, matching the live schema/runtime, and zero rows after the configured cron hour is the "missed run" signal.
- [x] Every query is read-only (`SELECT` only — no `INSERT`/`UPDATE`/`DELETE`).
- [x] No query depends on Drizzle internals — pasteable into raw `psql` against the Neon DB.

**Exit criteria**

- [x] An operator can `psql $DATABASE_URL -f scripts/ops/agent-observability.sql` (or paste blocks individually) to answer the DB-backed operational questions from `AGENTIC_EXPANSIONV2.md` §16.
- [x] Container restart-loop observability remains a Checkpoint 6/7 ops-doc + smoke concern, not a Checkpoint 5 SQL or `/api/agents/admin/stats` change.

**Validation**

- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`

**STOP. Review. Commit. Then continue.**

### Checkpoint 6 — Ops Runbooks

**Stories:** `AEV2-508`, `AEV2-510` (the launch-validation doc itself)

**Review focus:** confirm the four runbook files exist, each is 100–200 lines of plain markdown, the smoke runbook mirrors the External Validation Checklist below 1:1, and no runbook invents repo scripts, internal paths, or code paths the repo does not support.

**Suggested commit:** `docs(aev2): add ops rollback, recovery, smoke, launch-validation, and backup runbooks`

**Check off before commit**

- [ ] `docs/ops/agents-rollback.md` covers Vercel rollback, Docker service rollback, and migration 0019 partial-failure recovery.
- [ ] `docs/ops/home-server-recovery.md` covers WSL2 reboot, Docker daemon restart, `docker compose up -d`, healthcheck verification, and the post-ISP-outage / post-power-loss sequence.
- [ ] `docs/ops/agents-deploy-smoke.md` mirrors the External Validation Checklist below — same items, same order, same expected results.
- [ ] `docs/ops/agents-launch-validation.md` covers the AEV2-510 acceptance gate: re-verifying lane keys, base URLs, models, `AGENT_ADMIN_KEY`, `AGENT_SERVICE_KEY`, all six webhook URLs, and the `npm run typecheck:services` command from Checkpoint 4.
- [ ] `docs/ops/agents-backup-restore.md` exists with the retroactive Neon backup/restore steps. Branch IDs are placeholders for the user to fill if not provided.
- [ ] No runbook invents a repo script, internal path, or code path that does not exist. Standard external ops commands like `docker compose`, `psql`, `curl`, `vercel rollback`, `wsl --shutdown`, `systemctl`, and `sudo reboot` are expected.
- [ ] No runbook contains a real secret value.

**Exit criteria**

- [ ] AEV2-508 and AEV2-510 acceptance criteria are met.
- [ ] The smoke runbook is the canonical AEV2-509 artifact — actual smoke execution is the user's responsibility, tracked via the External Validation Checklist below.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`

**STOP. Review. Commit. Then continue.**

### Checkpoint 7 — Final Repo Validation

**Stories:** `AEV2-509` (artifact only — actual smoke is the user's job per D8)

**Review focus:** confirm the entire Sprint 4 surface area is in place, all four validation commands pass on a clean run, and HANDOFF.md is ready to be collapsed by the next planning pass after the user completes the External Validation Checklist.

**Suggested commit:** `chore(aev2): finalize sprint 4 validation`

**Check off before commit**

- [ ] Every file listed in "Planned File Actions" exists with the expected content.
- [ ] No Codex-authored file under `lib/agents/`, `app/api/`, `lib/validations/`, or `__tests__/` has been modified.
- [ ] `npm run lint` exits 0.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npm run typecheck:services` exits 0.
- [ ] `npm test` exits 0 (still 307+ tests passing — Sprint 4 added zero new vitest cases).
- [ ] `services/.env` is unchanged (verify via `git status` showing no diff against that path).
- [ ] `package.json` has exactly one new script (`typecheck:services`) and no new dependencies.
- [ ] `package-lock.json` is unchanged at the root (only `services/discord-bot/package-lock.json` is new).

**Exit criteria**

- [ ] Sprint 4 acceptance criteria for AEV2-501 through AEV2-510 are satisfied EXCEPT for items the user must validate manually — those live in the External Validation Checklist below and cause Sprint 4's status to remain `IN PROGRESS` until the user signs off.
- [ ] HANDOFF.md is updated to reflect the post-Sprint-4 state.

**Validation**

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run typecheck:services`
- [ ] `npm test`

**STOP. This is the Sprint 4 code-side exit gate. The user then runs the External Validation Checklist below before flipping status to COMPLETE.**

### Sprint 4 Exit Gate (Code-Side)

- [ ] `AEV2-501` through `AEV2-510` artifacts landed in checkpoint order.
- [ ] No Codex-authored file under `lib/agents/`, `app/api/`, `lib/validations/`, `__tests__/`, `lib/db/`, or `drizzle/` was modified.
- [ ] `services/.env` was not touched.
- [ ] Root `package.json` gained one script and zero dependencies.
- [ ] `services/discord-bot/package.json` is the only package manifest that declares `discord.js` and `tsx` as dependencies.
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:services`, and `npm test` all pass.
- [ ] HANDOFF.md updated after Checkpoint 7 closes.

### External Validation Checklist (User — Cannot Be Automated)

These items live outside the codebase. They are the actual launch gate for V1 — Sprint 4 is not COMPLETE until each is checked by the user. Codex does not execute any of these.

**Before the user runs the smoke (operator-owned steps, usually after Codex hands off):**

- [ ] **Populate `DISCORD_USER_MAP` in `lib/agents/admin.ts`.** Codex left this empty per D6. Add at least one entry mapping a real Discord user ID to a real Nexus user `{ id, email, name, picture }`. This is the only expected post-handoff edit under `lib/agents/`. Without this, the bot will get 403 on every message. Reason: V1 deliberately hardcodes the mapping rather than introducing a `discord_user_links` table.
- [ ] **Fill `services/.env`.** Confirm every var added to `services/.env.example` in Checkpoint 2 has a real value in `services/.env`. Pay special attention to `NEXUS_API_URL` (must be the public Vercel domain, NOT `localhost`), `AGENT_SERVICE_KEY` (must match what Vercel sees), `AGENT_ADMIN_KEY` (separate from `AGENT_SERVICE_KEY`), and all six `DISCORD_WEBHOOK_*` URLs.
- [ ] **Verify Vercel env vars match `services/.env`.** Specifically: `AGENT_SERVICE_KEY` and `AGENT_ADMIN_KEY` must be set in Vercel dashboard with the same values as `services/.env`. The Nexus API rejects bot calls if the service key does not match.
- [ ] **Confirm a Neon backup branch exists before any Compose-side migration.** No new migration ships in Sprint 4, but the user should re-confirm that a usable Neon branch backup exists. If the exact branch ID is unknown, capture it manually in `docs/ops/agents-backup-restore.md` during the smoke.
- [ ] **Sleep / power management on the home server.** Confirm `systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target` is set so Docker stays up.

**After Codex hands off (smoke checklist — the canonical AEV2-509 walk-through):**

- [ ] **`docker compose -f services/docker-compose.yml config`** exits 0 and shows the four expected services with no Redis.
- [ ] **`docker compose -f services/docker-compose.yml build`** completes without errors for all four services. Note any image build that takes >5 minutes.
- [ ] **`docker compose -f services/docker-compose.yml up -d`** brings all four containers up. After ~60 seconds, `docker compose ps` shows the three agent services as `healthy` and `discord-bot` as `Up`/running. If any agent service shows `unhealthy`, check `docker compose logs <service>` for the heartbeat write error. If `discord-bot` exits, inspect `docker compose logs discord-bot`.
- [ ] **Discord `#orchestrator` smoke — handle-directly.** Post a plain message ("what's the market doing today?"). Within 60 seconds, the bot should reply with an Orchestrator embed. Verify the embed color is emerald and the title is `Orchestrator`.
- [ ] **Discord `#orchestrator` smoke — routed-to-specialist.** Post `/research AAPL`. Within 30 seconds, the bot should reply with `Routed to specialist (job: <id>)`. The Small Cap Trader should pick up the routed job and post a research embed in the `#small-cap-research` channel within ~120 seconds (depending on AskEdgar latency).
- [ ] **Discord `#orchestrator` smoke — offline-fallback.** Stop the `small-cap-trader` container with `docker compose stop small-cap-trader`. The container's SIGTERM handler runs `worker.stop()` → `heartbeat.stop()` → flips `agent_registry.status` to `offline` (typically <10s, capped by `stop_grace_period: 30s`). Verify with `psql $DATABASE_URL -c "SELECT id, status FROM agent_registry WHERE id = 'small-cap-trader';"` — wait until `status = 'offline'`. Then post `/research AAPL` again. The Orchestrator should fall back to handling it directly with a warning (per `lib/agents/blueprints/orchestrator-chat.ts:163-178`). Restart with `docker compose start small-cap-trader`.
- [ ] **Macro summary smoke.** `curl https://<your-domain>/api/agents/macro-summary/latest` should return the previous day's summary if any. To force a fresh one, set `MACRO_CRON_HOUR` to the current ET hour in `services/.env`, run `docker compose up -d orchestrator` (Compose detects the env change and restarts the orchestrator container), and wait one cron tick (~60s). Verify the new row appears in `agent_reports`:
  ```sh
  psql $DATABASE_URL -c "SELECT id, report_type, created_at FROM agent_reports WHERE report_type = 'macro-summary' ORDER BY created_at DESC LIMIT 1;"
  ```
  And confirm the embed posts in the `#macro-daily` Discord channel. Revert `MACRO_CRON_HOUR` to `6` afterward.
- [ ] **Admin stats smoke.** `curl -H "x-agent-admin-key: $AGENT_ADMIN_KEY" https://<your-domain>/api/agents/admin/stats` should return the full `AdminStatsResponse` shape with non-null `agents`, `circuitBreakers`, and `queue.depth` fields.
- [ ] **Admin redeliver smoke.** Pick one report id from `agent_reports`. `curl -X POST -H "x-agent-admin-key: $AGENT_ADMIN_KEY" -H "Content-Type: application/json" -d '{"report_id":"<id>"}' https://<your-domain>/api/agents/admin/redeliver` should return `{ report_id, status: 'published' }` and the embed should re-post in the matching channel.
- [ ] **Observability SQL smoke.** Paste each block from `scripts/ops/agent-observability.sql` into Drizzle Studio (or `psql $DATABASE_URL`) and confirm it runs without error and returns sensible numbers.
- [ ] **Restart resilience.** Run `docker compose restart orchestrator`. Within 90 seconds, the orchestrator should be back to `healthy` and the heartbeat row should be fresh. The bot should still respond to `#orchestrator` messages.
- [ ] **Logging tail.** `docker compose logs --tail=100 orchestrator small-cap-trader swing-trader discord-bot` should show no leaked secrets. The new entrypoint and `discord-bot` lines should be structured JSON; existing `lib/agents/*` runtime lines may remain plain text. Unexpected crash loops or repeated stack traces are a failure.
- [ ] **Power-loss simulation (optional).** `sudo reboot`. Verify Docker autostarts and all four agent services come back up with `restart: unless-stopped`.

**After the smoke passes:**

- [ ] **Flip Sprint 4 status in HANDOFF.md to COMPLETE** and re-run the planning pass to collapse Sprint 4 into the same 3-block format as Sprints 1–3.
- [ ] **Update `AEV2_PLAN.md`** to mark EPIC-5 stories AEV2-501 through AEV2-510 as DONE.
- [ ] **Tag the launch commit** (e.g., `aev2-v1-launch`) so the rollback runbook has a known-good target.

### Complexity

- Overall complexity: `L` — significantly smaller than Sprint 3 because no new tests, no library logic, no API routes. Most of the work is configuration, Dockerfiles, and runbooks.
- Highest-risk checkpoint: Checkpoint 3 (Discord bot). The bot is the only NEW runtime code and the only place a logic bug can leak user content into Discord. The structured-logging-only rule matters.
- Second-highest-risk checkpoint: Checkpoint 2 (Compose rewrite). A typo in a webhook env var name will silently route a report to `null` and the failure shows up only as a `delivery_failed` row hours later. The validation here is "the env var name in Compose matches the env var name in `lib/agents/discord.ts::resolveWebhookUrl`".

### Change Log (Sprint 4)

- 2026-04-08: Sprint 4 spec drafted and locked. READY FOR CODEX.
- 2026-04-08: Applied fan-out review amendments. Added D9 (`NEXUS_API_URL` is bot-only) and D10 (discord-bot drops `DATABASE_URL`). Enumerated the six `AGENT_*` caps with explicit names + defaults from `lib/agents/llm-client.ts` (the design doc's 7th cap `AGENT_MAX_ASKEDGAR_CALLS_PER_SCAN` is NOT consumed by the runtime and is intentionally NOT added). Inlined the full Compose contract for one agent service plus diffs for the other two; dropped the deprecated `version: '3.8'` field; added `start_period: 60s` and `stop_grace_period: 30s`. Hardened the Dockerfile (`USER node`, `HEALTHCHECK NONE`, `--no-audit --no-fund --prefer-offline`). Added SIGINT/SIGTERM double-fire guard to the entrypoint. Tightened the Discord bot security surface: never echo upstream response bodies to Discord, use `ChannelType.GuildText` instead of magic `0`, embed truncation now adds a suffix, missing-env exit names which var, timeout/failure replies include `jobId` for log correlation. Expanded `.dockerignore` to exclude `.git`, `.github`, `.vscode`, `.claude`, `coverage`, `.env*`, with the prompt-markdown exception clarified by the later compaction pass. Added explicit SQL snippets to the External Validation Checklist for the macro summary smoke and pinned the offline-fallback wait time. Added a comment on the `stuck-processing` SQL query tying its threshold to `JOB_LEASE_HEARTBEAT_INTERVAL_MS`. Resolved the Checkpoint 5 contradiction (all 7 queries SHALL exist; column drift triggers `PENDING REVIEW`, not partial SQL). Status remains READY FOR CODEX.
- 2026-04-08: Compacted Sprint 4 to remove execution ambiguities. Normalized the live LLM env names to `INTERACTIVE_LLM_API_BASE_URL` / `BACKGROUND_LLM_API_BASE_URL`, fixed the inline `services/tsconfig.json` alias contract so it inherits the repo-root `@/*` mapping, and made the `typecheck:services` precondition explicit (`cd services/discord-bot && npm ci` once before the gate). Clarified that `.dockerignore` may exclude broad markdown only if it re-includes `lib/agents/prompts/*.md`, relaxed health/log acceptance text to match the actual bot/agent healthcheck surface, and changed the backup/runbook wording to require the canonical Neon branch procedure plus placeholders instead of undocumented historical steps. Also made the `DISCORD_USER_MAP` edit an explicit operator-owned post-handoff exception rather than an implied Codex scope break.
