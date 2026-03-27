# AGENTIC_EXPANSION_V2.md — Revision 3: Dual-Lane LLM Config, Budget Enforcement & Provider Update

> Generated: 2026-03-27 | Status: SPEC — Apply these changes to AGENTIC_EXPANSION_V2.md before implementation begins

---

## Why This Revision Exists

The R2 plan has three weaknesses that were identified during architecture review:

1. **Single generic LLM config path.** `AGENT_API_KEY`, `AGENT_API_BASE_URL`, `AGENT_MODEL` treat all agents the same. The Orchestrator chat needs speed (user is waiting). Background scans need quality/cost efficiency (async, nobody waiting). One config lane can't optimize for both.

2. **Budget is observability-only.** The plan says "no hard enforcement, just dashboard tracking" (line 806). A bad loop or prompt regression can burn through budget with no guardrails.

3. **Stale provider references.** The live codebase already uses Groq + `llama-3.3-70b-versatile`, but the plan still defaults to NVIDIA API + `deepseek-v3.2` in 13 places. R1.3 partially fixed this but never propagated upstream.

---

## Decisions (Confirmed)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM lane architecture | Two deterministic lanes: INTERACTIVE + BACKGROUND | Speed for chat, cost/quality for scans. Simple, no dynamic routing. |
| Model for both lanes | `llama-3.3-70b-versatile` everywhere for now | Same model removes variables during testing. Differentiate later based on real usage. |
| Testing provider | Groq free tier (`https://api.groq.com/openai/v1/chat/completions`) | Already working for Jarvis. Free. Fast. |
| Production provider | NVIDIA API key for both lanes | Upgrade path: paid Groq or DeepSeek when needed. No need for Google/OpenAI. |
| Budget scope | Per-agent (not global) | Each agent has independent daily/monthly caps. One runaway can't starve others. $5/day x 3 agents = $15/day max. |
| Step lane override | Yes — `lane?: LlmLane` on `StepMetadata` | Orchestrator needs interactive lane for chat, background lane for macro cron. |
| API key split | By purpose: dev/test, prod interactive, prod background | Easier budget tracking, rate-limit isolation, safer key rotation. |

---

## Change 1 of 13 — Executive Summary (Line 11)

### Current
```
The LLM provider is NVIDIA API (OpenAI-compatible endpoint, currently running `deepseek-v3.2`) with support for local models via llama.cpp.
```

### Replace with
```
The LLM provider is configurable via two deterministic lanes: INTERACTIVE_LLM (Orchestrator chat — optimized for speed) and BACKGROUND_LLM (specialist agent scans — optimized for cost/quality). Both use OpenAI-compatible endpoints. Testing uses Groq free tier with `llama-3.3-70b-versatile`. Production uses NVIDIA API. Local llama.cpp is supported as a fallback for either lane.
```

---

## Change 2 of 13 — Design Principle (Line 23)

### Current
```
- **Provider-agnostic LLM.** The LLM wrapper detects provider from URL. Swapping from NVIDIA API to a local llama.cpp server is a config change.
```

### Replace with
```
- **Provider-agnostic, dual-lane LLM.** The LLM wrapper uses two named config lanes — INTERACTIVE (Orchestrator chat) and BACKGROUND (specialist agent scans) — each with its own API key, base URL, model, and timeout. Lane assignment is deterministic per blueprint step, not URL-detected. Swapping providers per lane is a config-only change.
```

---

## Change 3 of 13 — `AgentConfig` Interface (Lines 588-596, Section 7.1)

### Current
```typescript
interface AgentConfig {
  id: AgentId;
  displayName: string;
  model: string;              // e.g. 'deepseek-v3.2' or 'local/mistral-7b'
  temperature: number;
  capabilities: JobType[];
  rolePromptPath: string;
  blueprints: Record<string, Blueprint>;
}
```

### Replace with
```typescript
interface AgentConfig {
  id: AgentId;
  displayName: string;
  llmLane: LlmLane;          // 'interactive' (orchestrator chat) or 'background' (specialist scans)
  modelOverride?: string;    // optional override within the lane (e.g. use a different model than lane default)
  temperature: number;
  capabilities: JobType[];
  rolePromptPath: string;
  blueprints: Record<string, Blueprint>;
}
```

**What changed:** `model` → `llmLane` + optional `modelOverride`. The agent declares which lane it uses by default. The model comes from the lane's env var config unless overridden.

**Lane assignments:**
- Orchestrator: `llmLane: 'interactive'` (but its macro cron blueprint steps override to `'background'`)
- Small Cap Trader: `llmLane: 'background'`
- Swing Trader: `llmLane: 'background'`

---

## Change 4 of 13 — `StepMetadata` Interface (Lines 375-381, Section 6.4)

### Current
```typescript
interface StepMetadata {
  canRetry: boolean;
  timeoutMs: number;
  maxRepairAttempts: number;
  sideEffect: boolean;
  idempotencyKey?: string;
}
```

### Replace with
```typescript
interface StepMetadata {
  canRetry: boolean;
  timeoutMs: number;
  maxRepairAttempts: number;
  sideEffect: boolean;
  idempotencyKey?: string;
  lane?: LlmLane;            // only for 'llm' steps — overrides the agent's default llmLane
}
```

**What changed:** Added optional `lane` field. Only relevant for `llm` type steps. If omitted, the step uses the agent's default `llmLane` from `AgentConfig`. This lets the Orchestrator's `synthesize-response` (chat) use `interactive` while `generate-briefing` (macro cron) uses `background`.

**Blueprint step lane assignments:**

| Blueprint | Step | Lane |
|-----------|------|------|
| `orchestrator:chat` | `synthesize-response` | `interactive` (agent default) |
| `orchestrator:macro-summary` | `generate-briefing` | `background` (step override) |
| `small-cap:pre-market-scan` | `analyze-dilution` | `background` (agent default) |
| `small-cap:pre-market-scan` | `analyze-technicals` | `background` (agent default) |
| `small-cap:research` | `analyze-and-report` | `background` (agent default) |
| `swing:momentum-scan` | `analyze-mdr-patterns` | `background` (agent default) |
| `swing:research` | `analyze-momentum-thesis` | `background` (agent default) |

---

## Change 5 of 13 — `LlmProviderConfig` Interface & Functions (Lines 653-661, Section 8.1)

### Current
```typescript
interface LlmProviderConfig {
  apiKey: string;              // AGENT_API_KEY env var
  baseUrl: string;             // AGENT_API_BASE_URL env var
  model: string;               // AGENT_MODEL, can be overridden per-agent
  timeoutMs: number;           // AGENT_LLM_TIMEOUT_MS, default 30000
}

function getLlmConfig(): LlmProviderConfig;
async function callLlm(request: LlmRequest, config?: Partial<LlmProviderConfig>): Promise<LlmResponse>;
```

### Replace with
```typescript
// --- Lane Config ---
// Each lane has its own credentials, endpoint, model, and timeout.
// Both lanes use OpenAI-compatible /v1/chat/completions format.

interface LlmLaneConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

// Lane discriminator — forces callers to be explicit, no default fallback.
type LlmLane = 'interactive' | 'background';

// --- Budget Config ---
// Hard limits enforced by callLlm() before every LLM call.
// Budget is per-agent — each agent checks its own spend.

interface LlmBudgetConfig {
  dailyBudgetCents: number;        // AGENT_DAILY_BUDGET_CENTS, default 500 ($5/day)
  monthlyBudgetCents: number;      // AGENT_MONTHLY_BUDGET_CENTS, default 10000 ($100/mo)
  maxContextTokens: number;        // AGENT_MAX_CONTEXT_TOKENS, default 32000
  maxScanCandidates: number;       // AGENT_MAX_SCAN_CANDIDATES, default 20
  maxPatternHistoryItems: number;  // AGENT_MAX_PATTERN_HISTORY, default 50
  maxRetriesPerStep: number;       // AGENT_MAX_RETRIES_PER_STEP, default 2
}

// --- Functions ---

function getInteractiveLlmConfig(): LlmLaneConfig;   // reads INTERACTIVE_LLM_* env vars
function getBackgroundLlmConfig(): LlmLaneConfig;    // reads BACKGROUND_LLM_* env vars
function getLlmBudgetConfig(): LlmBudgetConfig;       // reads AGENT_* budget env vars

// lane is REQUIRED — no default. Forces every callsite to be explicit about which
// lane it's using. This prevents background agents from accidentally using the
// interactive key (or vice versa).
async function callLlm(
  request: LlmRequest,
  lane: LlmLane,
  overrides?: Partial<LlmLaneConfig>
): Promise<LlmResponse>;
```

**What changed:**
- `LlmProviderConfig` → `LlmLaneConfig` (same fields, new name)
- Single `getLlmConfig()` → two lane-specific getters + budget getter
- `callLlm()` now requires a `lane` parameter — callers must be explicit
- New `LlmBudgetConfig` interface for hard enforcement limits

---

## Change 6 of 13 — Provider Detection (Lines 666-669, Section 8.2)

### Current
```
The wrapper detects provider from the base URL:
- `https://integrate.api.nvidia.com/*` → NVIDIA API (current provider)
- `http://localhost:*` or `http://127.0.0.1:*` → local llama.cpp server (OpenAI-compatible)
- Any other URL → treated as generic OpenAI-compatible API

All providers use the `/v1/chat/completions` format. Swapping providers is a config change (env vars only).
```

### Replace with
```
### 8.2 Provider Detection (for cost estimation only)

Provider detection is used ONLY for cost estimation — it does NOT control lane assignment. Lane assignment is deterministic, set by the caller passing `lane: 'interactive' | 'background'` to `callLlm()`.

The wrapper detects provider from the base URL for pricing lookups:
- `https://api.groq.com/*` → Groq (apply Groq pricing)
- `https://integrate.api.nvidia.com/*` → NVIDIA (apply NVIDIA pricing)
- `https://api.deepseek.com/*` → DeepSeek direct (apply DeepSeek pricing)
- `http://localhost:*` or `http://127.0.0.1:*` → local model (cost = 0)
- Any other URL → generic OpenAI-compatible (use model name for pricing lookup, fallback to 0)

All providers use the `/v1/chat/completions` format. Swapping providers per lane is a config change (env vars only).
```

---

## Change 7 of 13 — Local Model Support (Line 677, Section 8.3)

### Current
```
- Set `AGENT_API_BASE_URL=http://host.docker.internal:8080/v1/chat/completions` and `AGENT_API_KEY=not-needed`
```

### Replace with
```
- To use a local model for the background lane: set `BACKGROUND_LLM_API_BASE_URL=http://host.docker.internal:8080/v1/chat/completions` and `BACKGROUND_LLM_API_KEY=not-needed`. The interactive lane can remain on Groq/NVIDIA independently.
- To use a local model for everything: set both `INTERACTIVE_LLM_API_BASE_URL` and `BACKGROUND_LLM_API_BASE_URL` to the local endpoint.
```

---

## Change 8 of 13 — Env Var Unification Table (Lines 690-699, Section 8.5)

### Current
```
| New Name | Fallback | Default |
|----------|----------|---------|
| `AGENT_API_KEY` | `JARVIS_API_KEY` | (required) |
| `AGENT_API_BASE_URL` | `JARVIS_API_BASE_URL` | `https://integrate.api.nvidia.com/v1/chat/completions` |
| `AGENT_MODEL` | `JARVIS_MODEL` | `deepseek-v3.2` |
| `AGENT_LLM_TIMEOUT_MS` | `JARVIS_TIMEOUT_MS` | `30000` |
```

### Replace with
```
### Interactive Lane

| Name | Fallback Chain | Default |
|------|---------------|---------|
| `INTERACTIVE_LLM_API_KEY` | → `AGENT_API_KEY` → `JARVIS_API_KEY` | (required) |
| `INTERACTIVE_LLM_API_BASE_URL` | → `AGENT_API_BASE_URL` → `JARVIS_API_BASE_URL` | `https://api.groq.com/openai/v1/chat/completions` |
| `INTERACTIVE_LLM_MODEL` | → `AGENT_MODEL` → `JARVIS_MODEL` | `llama-3.3-70b-versatile` |
| `INTERACTIVE_LLM_TIMEOUT_MS` | → `AGENT_LLM_TIMEOUT_MS` → `JARVIS_TIMEOUT_MS` | `30000` |

### Background Lane

| Name | Fallback Chain | Default |
|------|---------------|---------|
| `BACKGROUND_LLM_API_KEY` | → `AGENT_API_KEY` → `JARVIS_API_KEY` | (required) |
| `BACKGROUND_LLM_API_BASE_URL` | → `AGENT_API_BASE_URL` → `JARVIS_API_BASE_URL` | `https://api.groq.com/openai/v1/chat/completions` |
| `BACKGROUND_LLM_MODEL` | → `AGENT_MODEL` → `JARVIS_MODEL` | `llama-3.3-70b-versatile` |
| `BACKGROUND_LLM_TIMEOUT_MS` | → `AGENT_LLM_TIMEOUT_MS` → `JARVIS_TIMEOUT_MS` | `60000` |

**Fallback behavior:** If only `JARVIS_API_KEY` is set (legacy), both lanes use it. A startup warning is logged: "Using legacy JARVIS_API_KEY for both lanes — set INTERACTIVE_LLM_API_KEY and BACKGROUND_LLM_API_KEY for production." This makes the migration smooth — existing `.env.local` files work without changes during development.

**Note:** `BACKGROUND_LLM_TIMEOUT_MS` defaults to `60000` (60s), not 30s. Background scans have heavier LLM steps (up to 60s timeout already declared in blueprint step metadata).
```

---

## Change 9 of 13 — types.ts Export List (Line 707, Section 9)

### Current (excerpt)
```
`LlmProviderConfig`, `TokenTrackingEntry`
```

### Replace with
```
`LlmLaneConfig`, `LlmLane`, `LlmBudgetConfig`, `TokenTrackingEntry`
```

---

## Change 10 of 13 — Cost Estimation & MODEL_PRICING (Lines 792-801, Section 11)

### Current
```
- `model_used` — actual model string (e.g., `deepseek-v3.2`)

const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  'deepseek-v3.2': { inputPer1k: 0.014, outputPer1k: 0.014 },
  'local/*': { inputPer1k: 0, outputPer1k: 0 },
};
```

### Replace with
```
- `model_used` — actual model string (e.g., `llama-3.3-70b-versatile`)
- `lane` — which config lane was used: `'interactive'` or `'background'`

const MODEL_PRICING: Record<string, { inputPer1kCents: number; outputPer1kCents: number }> = {
  // Groq — testing default + possible prod interactive
  'llama-3.3-70b-versatile':        { inputPer1kCents: 0.059, outputPer1kCents: 0.079 },
  // NVIDIA API — prod (placeholder pricing, confirm with actual tier)
  'nvidia/llama-3.3-70b-instruct':  { inputPer1kCents: 0.040, outputPer1kCents: 0.040 },
  // DeepSeek direct — future upgrade path for background lane
  'deepseek-chat':                   { inputPer1kCents: 0.027, outputPer1kCents: 0.110 },
  // Local models — zero cost
  'local/*':                         { inputPer1kCents: 0, outputPer1kCents: 0 },
};
```

### Also: Add `lane` column to `agent_request_log` schema (Section 3.5, line ~185)

Add after the `mode` field:
```
├── lane                 TEXT NOT NULL DEFAULT 'background'  -- 'interactive' | 'background'
```

---

## Change 11 of 13 — Budget: Observability → Enforcement (Lines 804-808, Section 11)

### Current
```
### Monthly Budget

- Default: `AGENT_MONTHLY_BUDGET_CENTS=10000` ($100/month)
- **Observability only in v1** — no hard enforcement, just dashboard tracking
- UI warning at >80% used, critical alert at >100%
```

### Replace with
```
### Budget Enforcement

Hard limits checked by `callLlm()` before every LLM call. Budget is per-agent — each agent checks its own spend against `agent_request_log`.

| Limit | Env Var | Default | What Happens When Hit |
|-------|---------|---------|----------------------|
| Daily spend cap | `AGENT_DAILY_BUDGET_CENTS` | `500` ($5/day per agent) | `BudgetExceededError` thrown, step fails with `failureClass: 'policy'`, no retry. Warning posted to `#agent-system` Discord. |
| Monthly spend cap | `AGENT_MONTHLY_BUDGET_CENTS` | `10000` ($100/mo per agent) | Same as daily — hard stop + Discord alert. |
| Max context tokens per LLM call | `AGENT_MAX_CONTEXT_TOKENS` | `32000` | Input is truncated to fit. Warning logged. LLM call still proceeds. |
| Max scan candidates sent to LLM | `AGENT_MAX_SCAN_CANDIDATES` | `20` | Code step slices candidate list before passing to LLM step. Excess candidates dropped with log. |
| Max pattern history items loaded | `AGENT_MAX_PATTERN_HISTORY` | `50` | Code step slices pattern list before passing to LLM step. Oldest patterns dropped first. |
| Max retries per LLM step | `AGENT_MAX_RETRIES_PER_STEP` | `2` | After N repair attempts, step fails with `failureClass: 'contract'`. Overrides `maxRepairAttempts` on step metadata if lower. |

**How budget check works inside `callLlm()`:**
1. Read `agent_request_log` WHERE `agent_id = current agent` AND `created_at > now() - 24h` → sum `estimated_cost_cents` → compare to daily cap
2. Read `agent_request_log` WHERE `agent_id = current agent` AND `created_at > now() - 30d` → sum `estimated_cost_cents` → compare to monthly cap
3. If either cap exceeded → throw `BudgetExceededError` (no LLM call made)
4. These are fast queries — `idx_agent_request_log_agent_created` index covers them

**Per-agent, not global:** With 3 agents at $5/day default, the total system max is $15/day ($450/month). To reduce total system spend, lower the per-agent cap. A global budget pool is intentionally avoided — one runaway agent should not be able to starve another agent's budget.

**Observability layer (on top of enforcement):**
- Dashboard warning at 80% of daily cap
- Dashboard critical at 100% (already blocked by enforcement)
- Same thresholds for monthly cap
- All budget events posted to `#agent-system` Discord webhook
```

---

## Change 12 of 13 — Docker Compose Env Blocks (Lines 993-1070, Section 15)

### Current (same pattern in all 3 services)
```yaml
      - AGENT_API_KEY=${AGENT_API_KEY}
      - AGENT_API_BASE_URL=${AGENT_API_BASE_URL}
      - AGENT_MODEL=${AGENT_MODEL}
```

### Replace with (in ALL 3 services — orchestrator, small-cap-trader, swing-trader)
```yaml
      # LLM — Interactive lane (Orchestrator chat)
      - INTERACTIVE_LLM_API_KEY=${INTERACTIVE_LLM_API_KEY}
      - INTERACTIVE_LLM_API_BASE_URL=${INTERACTIVE_LLM_API_BASE_URL}
      - INTERACTIVE_LLM_MODEL=${INTERACTIVE_LLM_MODEL:-llama-3.3-70b-versatile}
      - INTERACTIVE_LLM_TIMEOUT_MS=${INTERACTIVE_LLM_TIMEOUT_MS:-30000}
      # LLM — Background lane (specialist scans/research)
      - BACKGROUND_LLM_API_KEY=${BACKGROUND_LLM_API_KEY}
      - BACKGROUND_LLM_API_BASE_URL=${BACKGROUND_LLM_API_BASE_URL}
      - BACKGROUND_LLM_MODEL=${BACKGROUND_LLM_MODEL:-llama-3.3-70b-versatile}
      - BACKGROUND_LLM_TIMEOUT_MS=${BACKGROUND_LLM_TIMEOUT_MS:-60000}
      # Budget enforcement
      - AGENT_DAILY_BUDGET_CENTS=${AGENT_DAILY_BUDGET_CENTS:-500}
      - AGENT_MONTHLY_BUDGET_CENTS=${AGENT_MONTHLY_BUDGET_CENTS:-10000}
      - AGENT_MAX_CONTEXT_TOKENS=${AGENT_MAX_CONTEXT_TOKENS:-32000}
      - AGENT_MAX_SCAN_CANDIDATES=${AGENT_MAX_SCAN_CANDIDATES:-20}
      - AGENT_MAX_PATTERN_HISTORY=${AGENT_MAX_PATTERN_HISTORY:-50}
      - AGENT_MAX_RETRIES_PER_STEP=${AGENT_MAX_RETRIES_PER_STEP:-2}
```

**Why all 3 services get both lanes:** Every container receives both lane configs even if it only uses one. This prevents Docker compose failures from undefined variables, and allows flipping an agent's lane without changing the compose file. The agent's `AgentConfig.llmLane` (or the step's `StepMetadata.lane`) picks which lane config to read at runtime — unused lane vars are simply ignored.

---

## Change 13 of 13 — Section 18 Environment Variables (Lines 1259-1288)

### Replace the entire section with:

```
## 18. Environment Variables

### Agent LLM Config — Two-Lane

| Variable | Default | Used By | Purpose |
|----------|---------|---------|---------|
| `INTERACTIVE_LLM_API_KEY` | (required, falls back to JARVIS_API_KEY) | Orchestrator (chat) | API key for user-facing chat lane |
| `INTERACTIVE_LLM_API_BASE_URL` | `https://api.groq.com/openai/v1/chat/completions` | Orchestrator (chat) | LLM endpoint for interactive lane |
| `INTERACTIVE_LLM_MODEL` | `llama-3.3-70b-versatile` | Orchestrator (chat) | Model for interactive lane |
| `INTERACTIVE_LLM_TIMEOUT_MS` | `30000` | Orchestrator (chat) | Timeout for interactive lane (30s) |
| `BACKGROUND_LLM_API_KEY` | (required, falls back to JARVIS_API_KEY) | Small Cap, Swing, Orchestrator (cron) | API key for background scan lane |
| `BACKGROUND_LLM_API_BASE_URL` | `https://api.groq.com/openai/v1/chat/completions` | Small Cap, Swing, Orchestrator (cron) | LLM endpoint for background lane |
| `BACKGROUND_LLM_MODEL` | `llama-3.3-70b-versatile` | Small Cap, Swing, Orchestrator (cron) | Model for background lane |
| `BACKGROUND_LLM_TIMEOUT_MS` | `60000` | Small Cap, Swing, Orchestrator (cron) | Timeout for background lane (60s) |

### Agent Budget Limits — Hard Enforcement

| Variable | Default | Used By | Purpose |
|----------|---------|---------|---------|
| `AGENT_DAILY_BUDGET_CENTS` | `500` | All agents (per-agent) | Hard daily spend cap ($5/day). Enforced in `callLlm()`. |
| `AGENT_MONTHLY_BUDGET_CENTS` | `10000` | All agents (per-agent) | Hard monthly spend cap ($100/mo). Enforced in `callLlm()`. |
| `AGENT_MAX_CONTEXT_TOKENS` | `32000` | All agents | Max tokens per LLM call input. Truncates if exceeded. |
| `AGENT_MAX_SCAN_CANDIDATES` | `20` | Small Cap, Swing Trader | Max tickers per scan passed to LLM step. |
| `AGENT_MAX_PATTERN_HISTORY` | `50` | Swing Trader | Max pattern history items loaded per LLM call. |
| `AGENT_MAX_RETRIES_PER_STEP` | `2` | All agents | Max repair retries per LLM step. |

### Agent Infrastructure (unchanged from R2)

| Variable | Default | Used By | Purpose |
|----------|---------|---------|---------|
| `DATABASE_URL` | (existing, required) | All agents + Next.js | Neon Postgres connection string |
| `AGENT_POLL_INTERVAL_MS` | `5000` | All agents | Job queue poll interval |
| `AGENT_ID` | (required per service) | Each Docker service | Agent identity |
| `AGENT_ADMIN_KEY` | (falls back to `JARVIS_ADMIN_KEY`) | Next.js app | Admin API auth |
| `MACRO_CRON_HOUR` | `6` | Orchestrator | Hour (ET) to run macro summary |
| `MASSIVE_API_KEY` | (existing) | All agents | Market data API |
| `ASKEDGAR_API_KEY` | (existing) | All agents | SEC filings API |
| `TZ` | `America/New_York` | All agents | Timezone for cron/schedule alignment |

### Discord Webhooks (unchanged from R1.2)

| Variable | Purpose |
|----------|---------|
| `DISCORD_WEBHOOK_SCANS` | Small Cap pre-market scan results |
| `DISCORD_WEBHOOK_RESEARCH` | Small Cap on-demand research |
| `DISCORD_WEBHOOK_SWING_SETUPS` | Swing Trader MDR candidates |
| `DISCORD_WEBHOOK_SWING_ALERTS` | Swing Trader real-time alerts |
| `DISCORD_WEBHOOK_SYSTEM` | Agent health, budget warnings, errors |

### API Key Split by Purpose (Recommended Practice)

| Key Slot | Which Env Vars to Set | Purpose |
|----------|-----------------------|---------|
| Dev/test | Both `INTERACTIVE_LLM_API_KEY` and `BACKGROUND_LLM_API_KEY` → same Groq free-tier key | One key, same model for both lanes. Zero cost during development. |
| Prod interactive | `INTERACTIVE_LLM_API_KEY` → NVIDIA or paid Groq key | Orchestrator chat. Speed-optimized. |
| Prod background | `BACKGROUND_LLM_API_KEY` → NVIDIA or DeepSeek key | Specialist scans. Quality/cost-optimized. |
| Eval/batch (optional) | Separate key for offline evaluation runs | Prevents eval cost from eating production budget. |

**Why split by purpose, not per agent:** Per the review feedback — one key per tiny workflow is overkill. Per-agent keys would mean 3 keys minimum, growing with each new agent. Splitting by purpose (interactive vs background) gives you budget isolation and rate-limit separation without complexity. Agents in the same lane share a key.

### Deprecated (read as fallback, log warning when used)

| Old Name | New Replacement | Notes |
|----------|----------------|-------|
| `JARVIS_API_KEY` | `INTERACTIVE_LLM_API_KEY` / `BACKGROUND_LLM_API_KEY` | Legacy fallback for both lanes during migration |
| `JARVIS_API_BASE_URL` | `INTERACTIVE_LLM_API_BASE_URL` / `BACKGROUND_LLM_API_BASE_URL` | Same |
| `JARVIS_MODEL` | `INTERACTIVE_LLM_MODEL` / `BACKGROUND_LLM_MODEL` | Same |
| `JARVIS_TIMEOUT_MS` | `INTERACTIVE_LLM_TIMEOUT_MS` / `BACKGROUND_LLM_TIMEOUT_MS` | Same |
| `JARVIS_ADMIN_KEY` | `AGENT_ADMIN_KEY` | Unchanged from R1 |
| `AGENT_API_KEY` | Split into lane-specific vars | R1/R2 single-lane var, now superseded |
| `AGENT_API_BASE_URL` | Split into lane-specific vars | Same |
| `AGENT_MODEL` | Split into lane-specific vars | Same |
| `NVIDIA_API_KEY` | No direct replacement | Was a fallback in R1; fully removed |
| `CRON_SECRET` | (removed) | Macro cron is now in-process |
```

---

## Change 13b — R1.3 Superseded Annotation (Lines 1466-1481)

### Add at the top of Section R1.3
```
> **SUPERSEDED** — R1.3's single-lane `AGENT_API_*` env vars are replaced by the dual-lane
> `INTERACTIVE_LLM_*` / `BACKGROUND_LLM_*` config in the R3 amendment. The provider analysis
> (Groq vs DeepSeek) remains valid context. See revised Section 8.5 and Section 18 for the
> current env var table.
```

---

## services/.env.example Template

This file should be written out in full as part of Phase 5 (Docker Infrastructure). Contents:

```bash
# Nexus Terminal — Agent Services Environment
# Copy to .env and fill in your values.

# ─── Database ───
DATABASE_URL=postgresql://user:pass@host/nexus?sslmode=require

# ─── LLM: Interactive Lane (Orchestrator chat — needs speed) ───
# Testing: use Groq free tier key for both lanes
# Production: use NVIDIA or paid Groq key
INTERACTIVE_LLM_API_KEY=gsk_your_groq_key_here
INTERACTIVE_LLM_API_BASE_URL=https://api.groq.com/openai/v1/chat/completions
INTERACTIVE_LLM_MODEL=llama-3.3-70b-versatile
INTERACTIVE_LLM_TIMEOUT_MS=30000

# ─── LLM: Background Lane (specialist scans — needs quality/cost) ───
# Testing: same Groq free key as interactive
# Production: NVIDIA, DeepSeek, or paid Groq key
BACKGROUND_LLM_API_KEY=gsk_your_groq_key_here
BACKGROUND_LLM_API_BASE_URL=https://api.groq.com/openai/v1/chat/completions
BACKGROUND_LLM_MODEL=llama-3.3-70b-versatile
BACKGROUND_LLM_TIMEOUT_MS=60000

# ─── Budget Limits (per-agent, hard enforcement) ───
AGENT_DAILY_BUDGET_CENTS=500           # $5/day per agent ($15/day total for 3 agents)
AGENT_MONTHLY_BUDGET_CENTS=10000       # $100/mo per agent ($300/mo total for 3 agents)
AGENT_MAX_CONTEXT_TOKENS=32000         # Truncate LLM input above this
AGENT_MAX_SCAN_CANDIDATES=20           # Max tickers per scan to LLM
AGENT_MAX_PATTERN_HISTORY=50           # Max pattern items loaded per LLM call
AGENT_MAX_RETRIES_PER_STEP=2           # Max repair retries per LLM step

# ─── Agent Infrastructure ───
AGENT_POLL_INTERVAL_MS=5000
AGENT_ADMIN_KEY=your_admin_key_here
MACRO_CRON_HOUR=6

# ─── External APIs ───
MASSIVE_API_KEY=your_massive_key
ASKEDGAR_API_KEY=your_askedgar_key

# ─── Discord Webhooks ───
DISCORD_WEBHOOK_SCANS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_RESEARCH=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_SWING_SETUPS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_SWING_ALERTS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_SYSTEM=https://discord.com/api/webhooks/...
```

---

## `callLlm()` Flow with Budget Check (Reference Implementation)

This is the updated flow inside `lib/agents/llm-client.ts`:

```
callLlm(request, lane, overrides?)
  │
  ├─ 1. Resolve lane config
  │     if lane === 'interactive' → getInteractiveLlmConfig()
  │     if lane === 'background'  → getBackgroundLlmConfig()
  │     Apply overrides if provided
  │
  ├─ 2. Budget check (BEFORE making the LLM call)
  │     budgetConfig = getLlmBudgetConfig()
  │     todaySpend = SUM(estimated_cost_cents) FROM agent_request_log
  │                  WHERE agent_id = current AND created_at > now() - 24h
  │     monthSpend = SUM(estimated_cost_cents) FROM agent_request_log
  │                  WHERE agent_id = current AND created_at > now() - 30d
  │     if todaySpend >= budgetConfig.dailyBudgetCents → throw BudgetExceededError('daily')
  │     if monthSpend >= budgetConfig.monthlyBudgetCents → throw BudgetExceededError('monthly')
  │
  ├─ 3. Context token check
  │     if estimateTokens(request.systemPrompt + request.userMessage) > budgetConfig.maxContextTokens
  │       → truncate input, log warning
  │
  ├─ 4. Make the LLM call
  │     fetch(laneConfig.baseUrl, { model, messages, temperature, ... })
  │     timeout: laneConfig.timeoutMs
  │
  ├─ 5. Log to agent_request_log
  │     { agent_id, lane, model_used, input_tokens, output_tokens, estimated_cost_cents, ... }
  │
  └─ 6. Return LlmResponse
```

---

## Summary: What This Revision Does NOT Change

These parts of the plan are unaffected:

- Database schema (except adding `lane` column to `agent_request_log`)
- Blueprint engine (steps, runner, validation, checkpoint/resume)
- Job queue (poll, SKIP LOCKED, retry, dead letter)
- Agent registry and heartbeat
- Three-layer prompt architecture
- Evidence and citation rules
- Code vs LLM boundary rules
- Anti-pattern ban list
- Discord-first report delivery
- Routing rules
- Build order phases (same 7 phases)
- File inventory (same files, just updated contents in llm-client.ts and types.ts)
- Frontend components
- Migration plan

---

## How to Apply This Revision

1. Read this document alongside AGENTIC_EXPANSION_V2.md
2. Apply each of the 13 changes in order (they don't depend on each other)
3. Add `> SUPERSEDED` to R1.3
4. Add the `.env.example` template to the Phase 5 file inventory
5. Verify: search the updated document for `NVIDIA`, `deepseek-v3.2`, `AGENT_API_KEY`, `AGENT_API_BASE_URL`, `AGENT_MODEL` — none should appear outside the Deprecated table or "future upgrade" context
