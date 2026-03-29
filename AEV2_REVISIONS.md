# AEV2_REVISIONS.md — Literal Patch Plan for `AGENTIC_EXPANSIONV2.md`

> Generated: 2026-03-28 | Status: APPLY THESE PATCHES BEFORE SPRINT-BOARD CONVERSION

## Locked Decisions (Do Not Re-open During This Pass)

- `POST /api/agents/chat` always creates exactly **one `orchestrator` `chat` job** in V1.
- The **Orchestrator owns routing after job creation**.
- If a specialist is `offline` or `degraded`, the **Orchestrator handles the request in fallback mode**.
- Offline/degraded fallback must emit:
  - a caller-visible warning when relevant
  - a server log entry
  - a Discord `#agent-system` alert
- The Discord bot uses **separate service routes** protected by `requireServiceAuth()`.
- The Discord bot must **not** call user routes or admin routes.
- `small-cap:research` must include the trade-example memory-loading step as part of the canonical V1 blueprint.
- `INTERACTIVE_LLM_API_BASE_URL` and `BACKGROUND_LLM_API_BASE_URL` store **provider root URLs ending at `/v1`**.
  - Groq: `https://api.groq.com/openai/v1`
  - NVIDIA: `https://integrate.api.nvidia.com/v1`
  - DeepSeek later option: `https://api.deepseek.com/v1`

---

## Patch 1 — Executive Summary: Make the Entry Model Explicit

### Target

- Section 1, opening summary paragraphs

### Replace the existing opening three paragraphs under `## 1. Executive Summary` with this exact text

```md
This document specifies a multi-agent system for Nexus Terminal consisting of three runtime components: an **Orchestrator** (with built-in research routing pipeline and macro cron), a **Small Cap Trader (Short-Selling Specialist)** agent, and a **Swing Trader** agent. In V1, all user chat enters through `POST /api/agents/chat`, which always creates exactly one `orchestrator` `chat` job first. The Orchestrator then decides whether to handle the request directly or use specialist workflows according to deterministic routing rules. Multi-agent fanout for a single request is deferred to V2.

Agents run as Docker Compose services on a home server (16GB RAM laptop). They communicate via a Postgres-backed job queue (Neon Launch plan). The LLM provider is configurable via two deterministic lanes: INTERACTIVE_LLM (Orchestrator chat — optimized for speed) and BACKGROUND_LLM (specialist agent scans — optimized for cost/quality). Both use OpenAI-compatible endpoints. Testing uses Groq free tier with `llama-3.3-70b-versatile`. Production defaults to NVIDIA API during initial rollout, with the background lane allowed to switch to DeepSeek later without changing the lane contract. Market data comes from Massive API (Polygon-compatible, unlimited rate limit on stock starter kit). Ticker research comes from AskEdgar API.

The web UI migrates from the current Jarvis chat to a polling-based agent chat for the Orchestrator. Specialist-agent reports are Discord-first, published to channel webhooks, and persisted in `agent_reports` for history. V1 has no in-app approval queue.
```

### Add this sentence immediately after the existing design-principles bullet `- **The Orchestrator owns routing.** ...`

```md
In V1, this means API routes do not directly create specialist chat jobs for normal user chat; they create an Orchestrator job first, and routing happens inside the Orchestrator flow.
```

---

## Patch 2 — Orchestrator Responsibilities: Remove the Last Ambiguity

### Target

- Section 6.1 `Orchestrator`

### Replace responsibility item `1. **Request routing (Research Analyst logic).** ...` with this exact block

```md
1. **Request routing (Research Analyst logic).** Deterministic rules — no LLM call for routing:
   - All standard user chat enters the system as an `orchestrator` `chat` job first
   - Market cap < $200M AND pre-market gain >= 50% → route to `small-cap-trader` workflow
   - Momentum/trending/MDR/parabolic/swing topic → route to `swing-trader` workflow
   - Ambiguous or mixed-domain → keep with `orchestrator`
   - Multi-agent fanout for a single request is deferred to V2
   - Simple factual lookup → handle directly via Massive API/AskEdgar without specialist delegation
   - If a target specialist is `offline` or `degraded`, the Orchestrator does not delegate and instead handles the request in fallback mode while emitting an operational alert
```

### Add this sentence immediately after responsibility item 1

```md
For V1 sprint scope, “route to specialist workflow” means the Orchestrator chooses the specialist path after the Orchestrator job already exists; the API layer is not the source of truth for standard chat routing.
```

---

## Patch 3 — Orchestrator Blueprint: Replace the Current Table

### Target

- Section 6.4, subsection `### Orchestrator Blueprints`

### Replace the current `orchestrator:chat` table with this exact table

```md
**Blueprint: `orchestrator:chat`**

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `classify-and-route` | `code` | Parses the user message, applies deterministic routing rules, checks specialist availability, and chooses one of three paths: direct Orchestrator handling, specialist workflow handoff inside the Orchestrator flow, or Orchestrator fallback when the specialist is unavailable. Emits warning/log/alert metadata when fallback is used. |
| 2 | `synthesize-response` | `llm` | Reached when the Orchestrator itself needs to answer the request. Receives the user message + context and returns the final chat response. |
```

### Replace the sentence immediately above that table

Replace:

```md
The Orchestrator uses simpler blueprints since its primary job is routing:
```

With:

```md
The Orchestrator uses a narrow V1 chat blueprint: every standard chat request starts as an Orchestrator job, then the Orchestrator decides whether to answer directly, invoke a specialist workflow path, or stay in fallback mode if a specialist is unavailable.
```

### Delete this phrase wherever it still appears in the Orchestrator chat blueprint area

```md
creates a sub-job and returns early
```

If you still want sub-job language elsewhere in the doc, rewrite it so it is clearly described as an **internal Orchestrator implementation detail**, not the API contract.

---

## Patch 4 — Small Cap Research Blueprint: Make Section 27 Canonical

### Target

- Section 6.4 `Blueprint: small-cap:research`
- Section 27 “How Agents Consume These Examples”

### Replace the current `small-cap:research` table with this exact table

```md
**Blueprint: `small-cap:research`** (on-demand user request)

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `fetch-ticker-data` | `code` | Fetches snapshot + OHLCV from Massive API for the requested ticker. |
| 2 | `fetch-filings` | `code` | Fetches relevant SEC filings from AskEdgar: dilution-data, dilution-rating, offerings, offerings-advanced, ai-chart-analysis, news, registrations. |
| 3 | `calculate-indicators` | `code` | Runs SMA, RSI, VWAP, MACD, Bollinger from `lib/indicators.ts`. |
| 4 | `fetch-theme-context` | `code` | Fetches AskEdgar `/v1/market-strength?latest=true` for current themes narrative. Fetches AskEdgar `/v1/screener` with `min_gain_7_day=30&max_market_cap=500000000&limit=20` for recent top-performing small caps. Returns `{ marketThemes, topPerformers }`. |
| 5 | `load-trade-example-context` | `code` | Reads `agent_memory_v2` where `agent_id = 'small-cap-trader'` and `category IN ('pattern', 'trade_insight')`, filtered by similar tickers and/or pattern categories, and returns structured historical examples for the LLM step. |
| 6 | `analyze-and-report` | `llm` | Receives all structured data from steps 1-5. Uses the AskEdgar Research Prompt (Section 25) as output formatting template. Returns structured research report with all rated sections. |
| 7 | `assemble-report` | `code` | Validates report completeness (all required sections present, all ratings valid enum values). Writes report to `agent_reports`. POSTs Discord embed to `#small-cap-research` and stores `published` or `delivery_failed` based on webhook outcome. |
```

### Replace the Section 27 sentence starting with `**Small Cap Trader (`small-cap:research` blueprint):** Add a code step...` with this exact text

```md
**Small Cap Trader (`small-cap:research` blueprint):** The canonical V1 blueprint already includes a `load-trade-example-context` code step between `fetch-theme-context` and `analyze-and-report`. That step queries `agent_memory_v2 WHERE agent_id = 'small-cap-trader' AND category IN ('pattern', 'trade_insight')`, filtered by similar tickers or pattern categories, and passes structured historical examples into the LLM step as additional context.
```

### Add this sentence immediately after that replacement paragraph

```md
This is part of the canonical V1 blueprint, not a later enhancement.
```

---

## Patch 5 — Route Table: Add Service Routes and Clarify Purpose

### Target

- Section 13 `### New Routes`

### Replace the entire route table with this exact table

```md
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/agents/chat` | POST | User-facing chat entrypoint. Creates exactly one `orchestrator` `chat` job and returns `{ job_id }`. |
| `/api/agents/chat` | GET | User-facing polling endpoint for chat jobs: `?job_id=X` → returns `{ status, result?, error?, warning? }` |
| `/api/agents/service/chat` | POST | Discord-bot/service entrypoint. Creates the same `orchestrator` `chat` job shape as the user chat route. |
| `/api/agents/service/chat` | GET | Discord-bot/service polling endpoint for chat jobs. |
| `/api/agents/reports` | GET | List report history `?status=published|delivery_failed|archived` |
| `/api/agents/reports/[id]` | GET | Get single report |
| `/api/agents/research` | POST | Create direct specialist research job |
| `/api/agents/research` | GET | List past research reports |
| `/api/agents/admin/stats` | GET | Admin ops data: cost, latency, retries, validation failures, health |
| `/api/agents/admin/memory` | GET/DELETE | Admin memory management |
| `/api/agents/admin/redeliver` | POST | Manual report redelivery |
| `/api/agents/macro-summary/latest` | GET | Latest macro summary |
```

---

## Patch 6 — User Chat Contract: Make Job Creation Exact

### Target

- Section 13, `#### POST /api/agents/chat`
- Section 13, `#### GET /api/agents/chat?job_id=...`

### Keep the request body and success response blocks, but replace the numbered flow under `GET /api/agents/chat?job_id=...` with this exact text

```md
1. Client POSTs `{ message, session_id?, agent_id? }` to `/api/agents/chat`
2. Server saves the user message to `agent_conversations`, creates exactly one `agent_jobs` row with `agent_id = 'orchestrator'` and `job_type = 'chat'`, and returns `{ job_id, session_id, agent_id: 'orchestrator' }`
3. The Orchestrator applies deterministic routing rules after job creation
4. Client polls `GET /api/agents/chat?job_id=X` every **2 seconds**
5. Returns one of:
   - `{ status: 'queued', job_id, agent_id, progress_note: null }`
   - `{ status: 'processing', job_id, agent_id, progress_note: 'Step 1/2: classify-and-route' }`
   - `{ status: 'completed', job_id, agent_id, session_id, result: { message }, warning?: '...' }`
   - `{ status: 'failed', job_id, agent_id, error: { message, failureClass? } }`
```

### Add this sentence immediately after the polling examples

```md
For standard user chat, `agent_id` in the POST body is a routing hint, not permission for the API route to bypass the Orchestrator and create a specialist chat job directly.
```

---

## Patch 7 — Add Explicit Service Chat Contracts

### Target

- Section 13, immediately after the `GET /api/agents/chat?job_id=...` subsection

### Insert this new subsection verbatim

```md
#### `POST /api/agents/service/chat`

Service-only route for the Discord bot.

**Headers**

```http
x-agent-service-key: <AGENT_SERVICE_KEY>
```

**Request body**

```json
{
  "message": "Research BMNR",
  "session_id": "optional-session-id",
  "user_id": "resolved-nexus-user-id",
  "channel": "discord"
}
```

**Success response**

```json
{
  "job_id": "job_123",
  "session_id": "session_123",
  "agent_id": "orchestrator"
}
```

This route creates the same Orchestrator chat job shape as `POST /api/agents/chat`, but it uses service auth instead of browser session auth.

#### `GET /api/agents/service/chat?job_id=...`

Service-only polling route for the Discord bot.

**Headers**

```http
x-agent-service-key: <AGENT_SERVICE_KEY>
```

**Success response variants**

- `{ status: 'queued', job_id, agent_id, progress_note: null }`
- `{ status: 'processing', job_id, agent_id, progress_note: '...' }`
- `{ status: 'completed', job_id, agent_id, session_id, result: { message }, warning?: '...' }`
- `{ status: 'failed', job_id, agent_id, error: { message, failureClass? } }`
```

---

## Patch 8 — Routing Logic Notes: Move the Routing Function Inside Orchestrator Scope

### Target

- Section 13, subsection `### Agent Routing Logic`

### Replace the subsection title with this exact title

```md
### Orchestrator Routing Logic
```

### Replace the explanatory sentence around the function with this exact sentence

```md
The following routing logic runs inside the Orchestrator after the `orchestrator` `chat` job has already been created.
```

### Keep the function body if you want, but add this sentence immediately after it

```md
This function does not change the API-layer job-creation rule: standard chat still enters as one Orchestrator job first.
```

---

## Patch 9 — Auth Conventions: Separate User, Service, and Admin Paths

### Target

- Section 13, subsection `### Route Implementation Conventions`

### Replace the existing bullet list with this exact list

```md
- `requireUser()` for user-facing routes (returns 401 on failure)
- `requireServiceAuth()` for `/api/agents/service/*` routes used by the Discord bot
- `requireAgentAdmin()` for admin routes (validates `x-agent-admin-key` header)
- `getDb()` / `dbUnavailable()` for database access
- Input validation via Zod schemas with `parseAndValidate()` where applicable
- Standard error responses: `{ error: string }` with appropriate HTTP status codes
```

### Replace the current service-auth note with this exact text

```md
Service auth is limited to `/api/agents/service/*` routes only. User routes remain session-authenticated. Admin routes remain admin-key protected. The Discord bot must not use user routes or admin routes.
```

---

## Patch 10 — Endpoint Role Clarification: Replace the Table

### Target

- Section 13, subsection `### Endpoint Role Clarification`

### Replace the table with this exact table

```md
| Route | Role | Relationship to Chat |
|-------|------|---------------------|
| `POST /api/agents/chat` | Primary user-facing chat entrypoint | Always creates one Orchestrator chat job first |
| `POST /api/agents/service/chat` | Primary service chat entrypoint for Discord bot | Creates the same Orchestrator chat job shape using service auth |
| `POST /api/agents/research` | Convenience wrapper | Creates a direct specialist `research` job for `small-cap-trader` or `swing-trader`, skipping standard chat |
```

### Replace the sentence below the table with this exact text

```md
These convenience endpoints exist for programmatic callers (for example, MarketsTab triggering research on a ticker). They are not the standard user-chat entrypoint and do not change the rule that normal chat begins as an Orchestrator job.
```

---

## Patch 11 — Offline Agent Behavior: Replace the Entire Subsection

### Target

- Section 13, subsection `### Offline Agent Behavior`

### Replace the entire subsection with this exact text

```md
### Offline Agent Behavior

If the Orchestrator selects `small-cap-trader` or `swing-trader` but that specialist has `status = 'degraded'` or `status = 'offline'` in `agent_registry`:

- the Orchestrator does **not** delegate work to that specialist
- the Orchestrator handles the request in fallback mode
- the system writes a server log entry describing the fallback
- the system posts an operational alert to `#agent-system`
- the completed response may include a non-fatal warning such as:
  - `warning: 'Swing Trader offline; Orchestrator handled this request in fallback mode.'`

This keeps V1 responsive without queueing specialist work for a worker that is known to be unavailable.
```

### Add this sentence immediately after the subsection

```md
For direct specialist research created through `POST /api/agents/research`, the route should reject unavailable agents explicitly rather than silently queueing the job.
```

---

## Patch 12 — Env Var Tables: Replace Full Endpoint Defaults With Provider Roots

### Target

- Section 8.5 `Env Var Unification`
- Section 18 `Environment Variables`
- Phase 0 curl example
- Local-model example in Section 8.3

### Replace these exact strings everywhere they appear

- Replace:
  - ``https://api.groq.com/openai/v1/chat/completions``
- With:
  - ``https://api.groq.com/openai/v1``

- Replace:
  - ``http://host.docker.internal:8080/v1/chat/completions``
- With:
  - ``http://host.docker.internal:8080/v1``

### In Section 8.1 or 8.2, add this exact canonical rule sentence

```md
`INTERACTIVE_LLM_API_BASE_URL` and `BACKGROUND_LLM_API_BASE_URL` store the provider root ending at `/v1`. `callLlm()` appends `/chat/completions` internally.
```

### In Section 8.5, replace the lane default rows so they read exactly as follows

```md
| `INTERACTIVE_LLM_API_BASE_URL` | → `AGENT_API_BASE_URL` → `JARVIS_API_BASE_URL` | `https://api.groq.com/openai/v1` |
| `BACKGROUND_LLM_API_BASE_URL` | → `AGENT_API_BASE_URL` → `JARVIS_API_BASE_URL` | `https://api.groq.com/openai/v1` |
```

### In Section 18, replace the two base-url rows so they read exactly as follows

```md
| `INTERACTIVE_LLM_API_BASE_URL` | `https://api.groq.com/openai/v1` | Orchestrator (chat) | LLM provider root for interactive lane |
| `BACKGROUND_LLM_API_BASE_URL` | `https://api.groq.com/openai/v1` | Small Cap, Swing, Orchestrator (cron) | LLM provider root for background lane |
```

### In Phase 0, replace the Groq verification curl command with this exact command

```bash
curl https://api.groq.com/openai/v1/chat/completions -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"ping"}]}'
```

### Add this sentence right after the env-var table in Section 18

```md
Groq and NVIDIA are the default testing/provider roots in this spec. The background lane may later switch to DeepSeek (`https://api.deepseek.com/v1`) without changing the lane contract.
```

---

## Patch 13 — Discord Adapter: Point It at Service Routes

### Target

- Section 19 `V1 Discord Orchestrator Adapter`

### Replace bullet 3 in the numbered flow with this exact line

```md
3. The bot calls `/api/agents/service/chat` using `requireServiceAuth()` semantics and creates the corresponding Orchestrator chat job with `channel = 'discord'`
```

### Replace the acceptance-criteria bullet

Replace:

```md
- calls the app with `requireServiceAuth()`
```

With:

```md
- calls `/api/agents/service/chat` with `requireServiceAuth()`
```

### Add this sentence immediately after the prerequisites line

```md
The Discord bot does not call `/api/agents/chat` or `/api/agents/admin/*`; it only uses `/api/agents/service/*`.
```

---

## Patch 14 — Build Order: Add Missing Sprint-Board-Critical Work

### Target

- Section 16 `Build Order`

### Replace the current Phase 4 table with this exact table

```md
### Phase 4: API Routes

| Step | Route | Depends On |
|------|-------|------------|
| 25 | `app/api/agents/chat/route.ts` (`POST`) | Phase 3 |
| 26 | `app/api/agents/chat/route.ts` (`GET`) | Phase 3 |
| 27 | `app/api/agents/service/chat/route.ts` (`POST` + `GET`) | Phase 3 |
| 28 | `app/api/agents/reports/route.ts` | Phase 3 |
| 29 | `app/api/agents/reports/[id]/route.ts` | Phase 3 |
| 30 | `app/api/agents/research/route.ts` | Phase 3 |
| 31 | `app/api/agents/admin/stats/route.ts` | Phase 3 |
| 32 | `app/api/agents/admin/memory/route.ts` | Phase 3 |
| 33 | `app/api/agents/admin/redeliver/route.ts` | Phase 3 |
| 34 | `app/api/agents/macro-summary/latest/route.ts` | Phase 3 |
```

### Replace the current Phase 5 table with this exact table

```md
### Phase 5: Docker Runtime & Discord Bot

| Step | File | Depends On |
|------|------|------------|
| 35 | `services/agent.Dockerfile` | Phase 3 |
| 36 | `services/agent-entrypoint.ts` | Phase 3 |
| 37 | `services/docker-compose.yml` (rewrite — keep discord-bot, add 3 agent services, remove redis) | Steps 35-36 |
| 38 | `services/.env.example` | — |
| 39 | Build minimal V1 Discord bot runtime in `services/discord-bot/` | Phase 4 |
| 40 | Implement bot message → `/api/agents/service/chat` → poll → reply flow | Step 39 |
| 41 | Validate service TypeScript explicitly (example: `cd services/discord-bot && npx tsc --noEmit`) | Step 39 |
```

### In Phase 3, add these explicit implementation rows if they are not already present

```md
| X | `lib/agents/discord-embed.ts` | types.ts |
| X | `lib/agents/discord-delivery.ts` | types.ts |
| X | Blueprint definitions/config wiring for Orchestrator, Small Cap, Swing | blueprint-runner.ts, prompts.ts |
| X | `scripts/seed-trade-examples.ts` | Phase 2 |
```

If you want stable numbering, renumber the whole section in one pass after inserting the missing rows.

### Add this acceptance-criteria block near the end of Section 16

```md
### Phase-Level Acceptance Criteria That Must Exist Before Sprint Import

- queue lease fencing prevents stale workers from completing jobs after lease ownership changes
- scheduled-run dedupe prevents duplicate daily jobs for the same `agent_id + trigger_type + trading_date`
- checkpoint resume starts from the latest saved checkpoint instead of replaying the blueprint from step 1
- `delivery_failed` reports can be manually redelivered via `POST /api/agents/admin/redeliver`
- offline specialist fallback emits a warning, a server log entry, and a Discord `#agent-system` alert
```

---

## Patch 15 — File Inventory: Add the Missing Files

### Target

- Section 17 `Complete File Inventory`

### In the “Files to CREATE” list, add these paths if any are missing

```md
app/api/agents/service/chat/route.ts
lib/agents/discord-embed.ts
lib/agents/discord-delivery.ts
scripts/generate-trade-template.ts
scripts/seed-trade-examples.ts
```

### In the “Files to MODIFY” list, keep `services/docker-compose.yml` but ensure the comment mentions service routes/bot auth if you want the inventory to match the build order

### Add this note under the inventory section

```md
If blueprint definitions remain embedded only implicitly in `config.ts`, note that the implementation still requires explicit blueprint/config wiring work even if it does not create additional files.
```

---

## Patch 16 — Add an Operational Readiness / Runbooks Section

### Target

- Insert a new section **between Section 15 and Section 16**

### Insert this exact section

```md
## 15.1 Operational Readiness / Runbooks

These items are launch blockers for V1 even if the implementation is functionally complete.

### Backup and Restore Before Migration 0017

- Take a Neon backup/snapshot/export before running migration 0017.
- Document the restore procedure.
- Do not call the system launch-ready without a tested restore path.

### Rollback Procedure

- Document app code rollback.
- Document Docker service rollback.
- Document migration 0017 partial-failure recovery.
- Document migration 0018 rollback caution separately because destructive cleanup is not equivalent to additive rollout.

### Home-Server Recovery Checklist

- Verify laptop reboot recovery.
- Verify WSL startup.
- Verify Docker daemon startup.
- Verify `docker compose` restart behavior.
- Define expected recovery steps after ISP outage or power loss.

### Minimum Observability

- queue depth
- oldest queued job age
- jobs stuck in `processing`
- missed scheduled runs
- delivery failure count
- agent heartbeat freshness
- container restart loops

### Deploy Smoke Checklist

- web chat end-to-end
- Discord bot end-to-end
- report delivery webhook path
- macro-summary latest route
- admin stats route
- one forced offline-specialist fallback path

### Config and Secret Validation

- Review Vercel env vars and `services/.env` together before launch.
- Verify `AGENT_ADMIN_KEY` and `AGENT_SERVICE_KEY` separately.
- Validate Discord webhook URLs.
- Validate lane keys, base URLs, and models before launch.
```

### After inserting it, renumber subsequent section headings if desired for consistency

If you renumber, make sure all internal section references still point to the right section numbers.

---

## Patch 17 — Revision Notes: Stop Claiming the Prior Pass Fully Solved This

### Target

- Revision summary text near Section 28 / Revision 5 summary line

### Replace the current Revision 5 summary paragraph with this exact text

```md
> This revision addressed a large first-wave consistency pass from `AEV2_REVISIONS.md`, including migration numbering, durable queue semantics, idempotency, scheduled-run tables, market-status gating, frontend migration scope, shared-type extraction, and broader API contracts. A final literal patch pass still remains to lock routing entry semantics, service-route separation, offline specialist fallback behavior, blueprint consistency, provider-root URL conventions, and launch-readiness runbooks.
```

---

## Final Sweep Checklist

After applying all patches above, run one final manual sweep and remove any stale wording that still implies any of the following:

- standard chat routes directly create specialist jobs
- `POST /api/agents/chat` bypasses the Orchestrator when `agent_id` is supplied
- offline specialists passively queue normal user work for later pickup
- the Discord bot uses `/api/agents/chat` instead of `/api/agents/service/chat`
- `small-cap:research` is still a 6-step blueprint
- base URLs in env vars should end with `/chat/completions`
- the spec is sprint-board ready without the missing implementation rows and ACs
- the spec is launch-ready without backup/restore, rollback, observability, and smoke-test runbooks

## Done Condition

Do **not** convert `AGENTIC_EXPANSIONV2.md` into sprint tickets until the patches above are applied and the document reads consistently front-to-back with:

1. one clear chat-entry model,
2. one clear offline-specialist fallback model,
3. one clear service-route auth model,
4. one canonical small-cap research blueprint,
5. one canonical provider-root URL convention, and
6. explicit sprint-board and launch-readiness sections.
