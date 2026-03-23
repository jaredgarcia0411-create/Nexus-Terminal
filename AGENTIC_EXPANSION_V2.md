# Nexus Terminal — Autonomous Agent Framework Architecture

> Generated: 2026-03-13 | Status: DRAFT — Requires approval before implementation

---

## 1. Executive Summary

This document specifies a multi-agent system for Nexus Terminal consisting of three runtime components: an **Orchestrator** (with built-in research routing pipeline and macro cron), a **Dilutionary Small Cap Trader** agent, and a **Long Term Investor** agent.

Agents run as Docker Compose services on a home server (16GB RAM laptop). They communicate via a Postgres-backed job queue (Neon free tier). The LLM provider is NVIDIA API (OpenAI-compatible endpoint, currently running `deepseek-v3.2`) with support for local models via llama.cpp. Market data comes from Massive API (Polygon-compatible, unlimited rate limit on stock starter kit). Ticker research comes from AskEdgar API.

The web UI migrates from the current Jarvis chat to a polling-based agent chat with a supervised report review queue (Level 1 autonomy — all agent reports require user approval before action).

### Design Principles

- **Postgres is the backbone.** All inter-agent communication, state, memory, and job coordination flows through Postgres. No Redis, no message broker, no new infrastructure.
- **Agents are long-running Docker services.** They poll for work, execute, and write results back. They do not run on Vercel.
- **The Orchestrator owns routing.** The collapsed Research Analyst logic lives inside the Orchestrator as a deterministic rules engine — no LLM call for routing decisions.
- **Each agent has strict scope boundaries.** An agent can only read its own memory and the shared job queue. Cross-agent data access goes through the Orchestrator.
- **Supervised by default.** Agent reports start as `pending_review`. The user approves or rejects from a review queue in the web UI.
- **Blueprint-driven handlers.** Every job handler is a blueprint — a sequence of typed steps where each step is either `code` (deterministic, no LLM) or `llm` (reasoning/analysis). Code steps fetch data, calculate indicators, format output. LLM steps analyze and synthesize. This keeps LLM calls minimal, costs low, and results reliable. Inspired by Stripe's blueprint engine pattern.
- **Provider-agnostic LLM.** The LLM wrapper detects provider from URL. Swapping from NVIDIA API to a local llama.cpp server is a config change.

---

## 2. System Topology

```
┌──────────────────────────────────────────────────────────┐
│                    VERCEL (Next.js App)                    │
│                                                          │
│  Web UI ─── POST /api/agents/chat ──┐                    │
│  Web UI ─── GET  /api/agents/chat ──┤  (polls for result)│
│  Web UI ─── GET  /api/agents/reports ──┤                 │
│  Web UI ─── PATCH /api/agents/reports/[id] ──┤           │
│                                              ▼           │
│                                     ┌──────────────┐     │
│                                     │ Neon Postgres │     │
│                                     │  (free tier)  │     │
│                                     └──────────────┘     │
└──────────────────────────────────────────────────────────┘
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
┌──────────────────────────────────────────────────────────┐
│          DOCKER COMPOSE (Home Server — 16GB RAM)          │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Orchestrator  │  │  Small Cap   │  │  Long Term     │  │
│  │  (512M)      │  │  Trader      │  │  Investor      │  │
│  │              │  │  (512M)      │  │  (512M)        │  │
│  │ - Routes jobs│  │              │  │                │  │
│  │ - Macro cron │  │ - Pre-market │  │ - Macro        │  │
│  │ - Memory     │  │   scans      │  │   analysis     │  │
│  │   oversight  │  │ - Dilution   │  │ - Portfolio    │  │
│  │ - Cross-agent│  │   analysis   │  │   construction │  │
│  │   synthesis  │  │ - Technical  │  │ - Thesis       │  │
│  │              │  │   analysis   │  │   tracking     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬─────────┘  │
│         │                 │                 │             │
│         └────────┬────────┴─────────────────┘             │
│                  ▼                                         │
│          Neon Postgres (via WebSocket pool, max: 1 each)  │
│          Total: ~1.5GB RAM, 3-6 DB connections            │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema

6 objects total: 5 new tables + 1 modified table. All live in `lib/db/schema.ts`.

### 3.1 `agent_registry` — Agent health tracking

```
agent_registry
├── id                  TEXT PRIMARY KEY              -- 'orchestrator' | 'small-cap-trader' | 'long-term-investor'
├── display_name        TEXT NOT NULL
├── description         TEXT NOT NULL
├── status              TEXT NOT NULL DEFAULT 'offline'  -- 'online' | 'offline' | 'degraded'
├── capabilities        JSONB NOT NULL DEFAULT '[]'      -- ["chat", "research", "trade-analysis", "macro"]
├── config              JSONB NOT NULL DEFAULT '{}'      -- agent-specific config (model, temperature, etc.)
├── last_heartbeat      TIMESTAMPTZ
├── created_at          TIMESTAMPTZ DEFAULT now()
└── updated_at          TIMESTAMPTZ DEFAULT now()

-- No indexes beyond PK — max 3 rows.
```

### 3.2 `agent_jobs` — Inter-agent job queue

```
agent_jobs
├── id                  TEXT PRIMARY KEY              -- uuid
├── agent_id            TEXT NOT NULL                 -- target agent (soft FK to agent_registry.id)
├── user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
├── job_type            TEXT NOT NULL                 -- 'chat' | 'research' | 'trade-analysis' | 'macro-summary'
├── status              TEXT NOT NULL DEFAULT 'queued'  -- 'queued' | 'processing' | 'completed' | 'failed'
├── priority            INTEGER NOT NULL DEFAULT 0   -- higher = more urgent
├── input               JSONB NOT NULL               -- job-specific input payload
├── result              JSONB                        -- job output when completed
├── error_message       TEXT                         -- error detail when failed
├── attempt             INTEGER NOT NULL DEFAULT 0   -- current attempt number
├── max_attempts        INTEGER NOT NULL DEFAULT 3
├── next_retry_at       TIMESTAMPTZ                  -- null = ready now; set for backoff
├── created_at          TIMESTAMPTZ DEFAULT now()
├── started_at          TIMESTAMPTZ
├── completed_at        TIMESTAMPTZ
└── INDEXES
    ├── idx_agent_jobs_poll ON (agent_id, status, next_retry_at, priority DESC, created_at)
    └── idx_agent_jobs_user_status ON (user_id, status, created_at)
```

**Poll query (FOR UPDATE SKIP LOCKED):**

```sql
UPDATE agent_jobs
SET status = 'processing', started_at = now(), attempt = attempt + 1
WHERE id = (
  SELECT id FROM agent_jobs
  WHERE agent_id = $1
    AND status = 'queued'
    AND (next_retry_at IS NULL OR next_retry_at <= now())
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

### 3.3 `agent_reports` — Published research output (supervised)

```
agent_reports
├── id                  TEXT PRIMARY KEY              -- uuid
├── agent_id            TEXT NOT NULL
├── user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
├── job_id              TEXT                          -- optional FK to agent_jobs.id
├── report_type         TEXT NOT NULL                 -- 'trade-analysis' | 'research' | 'macro-summary' | 'scan'
├── title               TEXT NOT NULL
├── summary             TEXT
├── report_json         JSONB NOT NULL
├── status              TEXT NOT NULL DEFAULT 'pending_review'  -- 'pending_review' | 'approved' | 'rejected' | 'archived'
├── reviewed_at         TIMESTAMPTZ
├── review_notes        TEXT
├── created_at          TIMESTAMPTZ DEFAULT now()
└── INDEXES
    ├── idx_agent_reports_user_status ON (user_id, status, created_at DESC)
    └── idx_agent_reports_agent ON (agent_id, created_at DESC)
```

### 3.4 `agent_conversations` — Chat history (replaces `jarvis_conversations`)

```
agent_conversations
├── id                  TEXT PRIMARY KEY
├── user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
├── agent_id            TEXT NOT NULL
├── session_id          TEXT NOT NULL
├── role                TEXT NOT NULL                 -- 'user' | 'assistant' | 'system'
├── content             TEXT NOT NULL
├── channel             TEXT NOT NULL DEFAULT 'web'  -- 'web' (future: 'discord', 'api')
├── context_snapshot    JSONB
├── created_at          TIMESTAMPTZ DEFAULT now()
└── INDEXES
    ├── idx_agent_conversations_user_session ON (user_id, session_id, created_at)
    └── idx_agent_conversations_agent ON (agent_id, created_at)
```

### 3.5 `agent_request_log` — Token/cost tracking (replaces `jarvis_request_log`)

```
agent_request_log
├── id                   TEXT PRIMARY KEY
├── user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
├── agent_id             TEXT NOT NULL
├── mode                 TEXT NOT NULL
├── model_used           TEXT                         -- tracks which model was used
├── input_tokens         INTEGER NOT NULL DEFAULT 0
├── output_tokens        INTEGER NOT NULL DEFAULT 0
├── total_tokens         INTEGER NOT NULL DEFAULT 0
├── estimated_cost_cents INTEGER DEFAULT 0           -- estimated cost in cents
├── duration_ms          INTEGER NOT NULL DEFAULT 0
├── success              INTEGER NOT NULL DEFAULT 1
├── source_count         INTEGER NOT NULL DEFAULT 0
├── chunk_count          INTEGER NOT NULL DEFAULT 0
├── created_at           TIMESTAMPTZ DEFAULT now()
└── INDEXES
    ├── idx_agent_request_log_user_created ON (user_id, created_at)
    ├── idx_agent_request_log_agent_created ON (agent_id, created_at)
    └── idx_agent_request_log_created ON (created_at)
```

### 3.6 `agent_memory` — Modified (add `agent_id` column)

```
agent_memory (MODIFIED)
├── id                  TEXT PRIMARY KEY
├── user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
├── agent_id            TEXT NOT NULL DEFAULT 'orchestrator'   -- NEW COLUMN
├── category            TEXT NOT NULL   -- expanded: 'fact' | 'thesis' | 'watchlist' | 'scan_param' | 'performance' | 'trade_insight' | 'user_preference' | 'strategy_note' | 'macro_fact'
├── key                 TEXT NOT NULL
├── value               TEXT NOT NULL
├── value_json          JSONB
├── created_at          TIMESTAMPTZ DEFAULT now()
├── updated_at          TIMESTAMPTZ DEFAULT now()
├── expires_at          TIMESTAMPTZ
└── CONSTRAINTS
    ├── UNIQUE(user_id, agent_id, category, key)  -- replaces old UNIQUE(user_id, category, key)
    └── INDEX agent_memory_user_agent_category_idx ON (user_id, agent_id, category)
```

**Migration strategy:** Add column `agent_id` with default `'jarvis'`. Drop old unique constraint. Add new unique constraint. Update all existing rows to `agent_id = 'orchestrator'`.

---

## 4. Data Migration Plan

Two separate migrations to allow rollback between them.

### Migration 0011 — Add new tables, alter agent_memory

1. CREATE TABLE `agent_registry`
2. CREATE TABLE `agent_jobs`
3. CREATE TABLE `agent_reports`
4. CREATE TABLE `agent_conversations`
5. CREATE TABLE `agent_request_log`
6. ALTER TABLE `agent_memory` — add `agent_id` column (default `'jarvis'`)
7. DROP old unique constraint on `agent_memory`
8. ADD new unique constraint `UNIQUE(user_id, agent_id, category, key)`
9. UPDATE `agent_memory` SET `agent_id = 'orchestrator'` WHERE `agent_id = 'jarvis'`
10. INSERT seed rows into `agent_registry` for 3 agents
11. Copy data from `jarvis_conversations` → `agent_conversations` (map columns)
12. Copy data from `jarvis_request_log` → `agent_request_log` (map columns, set `estimated_cost_cents = 0` for historical rows)

### Migration 0012 — Drop legacy tables (after confirming 0011 works)

1. DROP TABLE `jarvis_conversations`
2. DROP TABLE `jarvis_request_log`

---

## 5. Connection Pooling Strategy

Neon free tier: 20 connections max, 750 compute-hours/month.

| Consumer | Connection Type | Count | Notes |
|----------|----------------|-------|-------|
| Vercel app (reads) | HTTP (`neon()`) | 0 pooled | Stateless HTTP, no persistent connection |
| Vercel app (transactions) | WebSocket Pool | 1-3 | Existing `getPoolDb()`, bulk/import only |
| Orchestrator | WebSocket Pool | 1 | `max: 1` |
| Small Cap Trader | WebSocket Pool | 1 | `max: 1` |
| Long Term Investor | WebSocket Pool | 1 | `max: 1` |

**Steady state: 3-6 connections.** Well within the 20-connection limit.

Pool config per agent:

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
```

Agent heartbeats every 30 seconds keep Neon warm. Cold starts take 1-3 seconds, handled by the 10s connection timeout.

---

## 6. Agent Specifications

### 6.1 Orchestrator

**Runtime:** Long-running Node.js process in Docker Compose (512M memory limit).
**Poll interval:** 5 seconds on `agent_jobs` where `agent_id = 'orchestrator'`.
**Macro cron:** `setInterval`-based, checks hourly if current hour = `MACRO_CRON_HOUR` (default 6) in `America/New_York`. Runs macro pipeline if today's summary is missing. Replaces the Vercel cron at `/api/jarvis/cron/macro-summary`.

**Responsibilities:**

1. **Request routing (Research Analyst logic).** Deterministic rules — no LLM call for routing:
   - Market cap < $200M AND pre-market gain >= 50% → route to `small-cap-trader`
   - Macro/sector/commodity/interest rate topic → route to `long-term-investor`
   - Ambiguous or multi-domain → split into sub-jobs, one per agent
   - Simple factual lookup → handle directly via Massive API/AskEdgar without agent delegation

2. **Memory oversight.** Reads all agents' memory rows. Detects contradictions (e.g., Small Cap is bullish on a ticker that Long Term flagged as fundamentally deteriorating) and injects context when routing.

3. **Report aggregation.** Receives completion events, optionally adds cross-agent context, writes final report to `agent_reports` with `status = 'pending_review'`.

4. **Macro cron.** Runs the daily macro headline scraping pipeline that was previously a Vercel cron job. Uses `setInterval` inside the container.

**LLM usage:** Only for synthesizing cross-agent summaries, answering user chat queries that require reasoning, and generating the daily briefing.

### 6.2 Dilutionary Small Cap Trader

**Runtime:** Long-running Node.js process in Docker Compose (512M memory limit).
**Poll interval:** 5 seconds on `agent_jobs` where `agent_id = 'small-cap-trader'`.
**Autonomous trigger:** Pre-market scan at 7:00 AM EST. Checks Massive API for stocks matching: close >= $0.75, pre-market gain >= 50%, market cap < $200M.

**Private state (in `agent_memory`):**
- `scan_param` — threshold values (price floor, gain %, market cap ceiling)
- `watchlist` — tickers currently being tracked with entry/exit levels
- `fact` — per-ticker dilution history, historical performance notes
- `performance` — accuracy of past calls (predicted vs actual outcome)

**Blueprints:** `small-cap:pre-market-scan`, `small-cap:research` (see section 6.4 for full step-by-step breakdowns)

**LLM usage:** Only for dilution analysis and technical analysis steps. Data fetching (Massive API, AskEdgar), indicator calculation (`lib/indicators.ts`), and report assembly are all deterministic code steps — no LLM involved.

### 6.3 Long Term Investor

**Runtime:** Long-running Node.js process in Docker Compose (512M memory limit).
**Poll interval:** 5 seconds on `agent_jobs` where `agent_id = 'long-term-investor'`.
**Autonomous trigger:** Weekly macro scan on Sunday evening. Daily sector rotation check at 5:00 PM EST.

**Private state (in `agent_memory`):**
- `thesis` — active investment theses with entry conditions, invalidation criteria, target exit signals
- `watchlist` — sectors and names under observation
- `fact` / `macro_fact` — macro indicators (Fed funds rate, CPI, PMI, yield curve)
- `scan_param` — sector allocation targets, risk tolerance parameters
- `performance` — thesis outcome tracking (validated, invalidated, in-progress)

**Blueprints:** `long-term:macro-scan`, `long-term:thesis-check` (see section 6.4 for full step-by-step breakdowns)

**LLM usage:** Only for macro regime analysis and thesis generation/evaluation steps. Data fetching (Massive API, AskEdgar), memory reads/writes, and report assembly are all deterministic code steps — no LLM involved.

---

## 6.4 Blueprint Engine

A blueprint is a named sequence of steps that defines exactly how an agent handles a job. Each step has a `type` — either `code` (deterministic, no LLM call) or `llm` (sends structured data to the LLM for reasoning). The worker executes steps in order, passing each step's output as input to the next.

**Why blueprints?**
- **Cheaper** — LLM only fires for analysis/synthesis, not data fetching or formatting
- **More reliable** — code steps can't hallucinate ticker data or invent filing numbers
- **More secure** — LLM never directly calls external APIs; code fetches data, hands structured results to LLM
- **Testable** — each step can be tested independently; code steps run without an LLM, LLM steps run with mock data
- **Debuggable** — when something fails, you know exactly which step broke and whether it was code or LLM

### Blueprint Type Definitions

```typescript
type StepType = 'code' | 'llm';

interface BlueprintStep {
  name: string;                    // human-readable label, e.g. 'fetch-snapshot'
  type: StepType;                  // 'code' = deterministic, 'llm' = LLM reasoning
  run: (input: StepInput) => Promise<StepOutput>;
}

interface StepInput {
  jobInput: unknown;               // original job input payload
  previousOutput: unknown;         // output from the previous step (null for step 1)
  memory: AgentMemoryRow[];        // agent's scoped memory
  context: AgentContext;           // assembled context (trades, macro, etc.)
}

interface StepOutput {
  data: unknown;                   // passed as `previousOutput` to next step
  tokensUsed?: number;             // only set by 'llm' steps, for cost tracking
}

interface Blueprint {
  id: string;                      // e.g. 'small-cap:pre-market-scan'
  description: string;
  steps: BlueprintStep[];
}
```

### Blueprint Runner

The worker's `runBlueprint()` function replaces the old monolithic `JobHandler`. It:

1. Loads the agent's memory and context once (shared across all steps)
2. Iterates through steps sequentially
3. For `code` steps — calls `step.run()` directly, no LLM involved
4. For `llm` steps — calls `step.run()` which internally uses `callLlm()`, tracks tokens
5. If any step throws, the job fails with the step name in the error message
6. Final step's output becomes the job result

```typescript
async function runBlueprint(
  blueprint: Blueprint,
  job: AgentJob,
  config: AgentConfig,
  db: DrizzleClient
): Promise<{ result: unknown; totalTokens: number }> {
  const memory = await readMemory(db, job.user_id, config.id);
  const context = await buildAgentContext(db, job.user_id, config.id);
  let previousOutput: unknown = null;
  let totalTokens = 0;

  for (const step of blueprint.steps) {
    const output = await step.run({
      jobInput: job.input,
      previousOutput,
      memory,
      context,
    });
    previousOutput = output.data;
    totalTokens += output.tokensUsed ?? 0;
  }

  return { result: previousOutput, totalTokens };
}
```

### Small Cap Trader Blueprints

**Blueprint: `small-cap:pre-market-scan`**

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `fetch-snapshot` | `code` | Calls Massive API snapshot endpoint. Filters: close >= $0.75, pre-market gain >= 50%, market cap < $200M. Returns candidate ticker list. |
| 2 | `fetch-filings` | `code` | For each candidate, calls AskEdgar API for S-3, prospectus supplements, 8-K filings. Returns structured filing data per ticker. |
| 3 | `analyze-dilution` | `llm` | Receives structured filing data + agent's dilution history from memory. Returns dilution risk score and reasoning per ticker. |
| 4 | `fetch-ohlcv` | `code` | Fetches OHLCV candles from Massive API for each surviving candidate. Calculates SMA, RSI, VWAP, volume profile using `lib/indicators.ts`. Returns structured technical data. |
| 5 | `analyze-technicals` | `llm` | Receives technical data + dilution scores. Returns entry/exit levels, support/resistance, confidence rating per ticker. |
| 6 | `assemble-report` | `code` | Merges all outputs into `agent_reports` row with `status = 'pending_review'`. No LLM call — just JSON assembly. |

**Blueprint: `small-cap:research`** (on-demand user request)

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `fetch-ticker-data` | `code` | Fetches snapshot + OHLCV from Massive API for the requested ticker. |
| 2 | `fetch-filings` | `code` | Fetches relevant SEC filings from AskEdgar for the ticker. |
| 3 | `calculate-indicators` | `code` | Runs SMA, RSI, VWAP, MACD, Bollinger from `lib/indicators.ts`. |
| 4 | `analyze-and-report` | `llm` | Receives all structured data. Returns complete research report with dilution risk, technical setup, and trade thesis. |
| 5 | `assemble-report` | `code` | Writes report to `agent_reports`. |

### Long Term Investor Blueprints

**Blueprint: `long-term:macro-scan`** (weekly Sunday evening)

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `fetch-macro-data` | `code` | Fetches macro indicators via Massive API (sector ETFs, indices, commodities). Reads existing `macro_fact` memory entries. |
| 2 | `analyze-macro-regime` | `llm` | Receives structured macro data. Identifies regime (expansion/contraction/transition), sector rotation signals, key risks. |
| 3 | `fetch-sector-data` | `code` | Based on LLM's sector picks, fetches sector-specific data from Massive API and AskEdgar (10-K/10-Q for top holdings). |
| 4 | `generate-theses` | `llm` | Receives sector data + existing theses from memory. Creates/updates investment theses with entry conditions, invalidation criteria, targets. |
| 5 | `update-memory` | `code` | Writes updated theses and macro facts to `agent_memory`. Writes report to `agent_reports`. |

**Blueprint: `long-term:thesis-check`** (daily 5:00 PM EST)

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `load-active-theses` | `code` | Reads all `thesis` memory entries for this agent. Fetches current prices for thesis tickers from Massive API. |
| 2 | `evaluate-theses` | `llm` | Compares current data against thesis entry/invalidation conditions. Returns status update per thesis (on-track, triggered, invalidated). |
| 3 | `update-memory-and-alert` | `code` | Updates thesis memory entries. If any thesis triggered or invalidated, writes alert report to `agent_reports` with `pending_review`. |

### Orchestrator Blueprints

The Orchestrator uses simpler blueprints since its primary job is routing:

**Blueprint: `orchestrator:chat`**

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `route-or-handle` | `code` | Applies deterministic routing rules. If routable to a specialist agent, creates a sub-job and returns early. If simple factual lookup, fetches data directly. |
| 2 | `synthesize-response` | `llm` | Only reached for questions that need reasoning. Receives user message + context. Returns chat response. |

**Blueprint: `orchestrator:macro-summary`** (daily cron)

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `scrape-headlines` | `code` | Fetches macro headlines using existing scrape-lite module. |
| 2 | `fetch-market-snapshot` | `code` | Fetches index/sector/commodity prices from Massive API. |
| 3 | `generate-briefing` | `llm` | Receives headlines + market data. Returns structured daily briefing. |
| 4 | `save-summary` | `code` | Writes to `daily_ticker_summaries` / `macro_summaries` table. |

---

## 7. Agent Registration & Lifecycle

### 7.1 Agent Interface

```typescript
interface AgentConfig {
  id: AgentId;
  displayName: string;
  model: string;              // e.g. 'deepseek-v3.2' or 'local/mistral-7b'
  temperature: number;
  capabilities: JobType[];
  systemPrompt: string;
  blueprints: Record<string, Blueprint>;  // keyed by 'agent:job-type', e.g. 'small-cap:pre-market-scan'
}

interface WorkerConfig {
  agentId: AgentId;
  pollIntervalMs: number;     // default 5000
  blueprintResolver: (job: AgentJob) => Blueprint;  // picks the right blueprint for a given job
}
```

The old `JobHandler` is replaced by blueprints. The `blueprintResolver` function maps an incoming job to the correct blueprint based on `job_type` and any input flags (e.g., a `research` job for small-cap resolves to `small-cap:research`).

### 7.2 Explicit Registration

At startup, each agent service:
1. Writes/updates its row in `agent_registry` (status → `'online'`, heartbeat → `now()`)
2. Begins its poll loop (`worker.ts`)
3. Starts a 30-second heartbeat interval (`heartbeat.ts`)
4. If Orchestrator, also starts the macro cron (`macro-cron.ts`)

The Orchestrator checks `agent_registry` heartbeats before routing jobs. If an agent has not heartbeated in 3× its poll interval, the Orchestrator marks it `status = 'degraded'` and stops routing new work to it.

### 7.3 Graceful Shutdown

On `SIGTERM` / `SIGINT`:
1. Stop accepting new jobs
2. Finish current job (or mark it back to `queued` if taking too long)
3. Update `agent_registry` status to `'offline'`
4. Close database pool
5. Exit

---

## 8. LLM Integration

### 8.1 Provider-Agnostic Wrapper

All LLM calls go through `lib/agents/llm-client.ts`. No agent calls any API directly.

```typescript
interface LlmRequest {
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  model?: string;
}

interface LlmResponse {
  content: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

interface LlmProviderConfig {
  apiKey: string;              // AGENT_API_KEY env var
  baseUrl: string;             // AGENT_API_BASE_URL env var
  model: string;               // AGENT_MODEL, can be overridden per-agent
  timeoutMs: number;           // AGENT_LLM_TIMEOUT_MS, default 30000
}

function getLlmConfig(): LlmProviderConfig;
async function callLlm(request: LlmRequest, config?: Partial<LlmProviderConfig>): Promise<LlmResponse>;
```

### 8.2 Provider Detection

The wrapper detects provider from the base URL:
- `https://integrate.api.nvidia.com/*` → NVIDIA API (current provider)
- `http://localhost:*` or `http://127.0.0.1:*` → local llama.cpp server (OpenAI-compatible)
- Any other URL → treated as generic OpenAI-compatible API

All providers use the `/v1/chat/completions` format. Swapping providers is a config change (env vars only).

### 8.3 Local Model Support

For running on the home server without API costs:
- llama.cpp with a 7B quantized model fits in 16GB RAM alongside the Docker agents
- Set `AGENT_API_BASE_URL=http://host.docker.internal:8080/v1/chat/completions` and `AGENT_API_KEY=not-needed`
- Cost tracking records `estimated_cost_cents = 0` for local models

### 8.4 System Prompts

```
lib/agents/prompts/
├── orchestrator.md       -- routing context, cross-agent synthesis rules
├── small-cap.md          -- dilution analysis framework, technical patterns
└── long-term.md          -- macro analysis framework, portfolio theory, suitability rules
```

### 8.5 Env Var Unification

All LLM config uses `AGENT_*` prefix with fallback to legacy names:

| New Name | Fallback | Default |
|----------|----------|---------|
| `AGENT_API_KEY` | `NVIDIA_API_KEY` | (required) |
| `AGENT_API_BASE_URL` | `JARVIS_API_BASE_URL` | `https://integrate.api.nvidia.com/v1/chat/completions` |
| `AGENT_MODEL` | `JARVIS_MODEL` | `deepseek-v3.2` |
| `AGENT_LLM_TIMEOUT_MS` | `JARVIS_TIMEOUT_MS` | `30000` |

---

## 9. Shared Library: `lib/agents/` (17 files)

| # | File | Purpose | Key Exports |
|---|------|---------|-------------|
| 1 | `types.ts` | Type definitions | `AgentId`, `JobType`, `JobStatus`, `ReportStatus`, `MemoryCategory`, `StepType`, `BlueprintStep`, `Blueprint`, `StepInput`, `StepOutput`, `AgentJob`, `AgentReport`, `AgentConfig`, `LlmRequest`, `LlmResponse`, `WorkerConfig`, `LlmProviderConfig`, `TokenTrackingEntry` |
| 2 | `db.ts` | DB connection factory for Docker services | `getAgentDb(): DrizzleClient` (single pooled WebSocket connection) |
| 3 | `llm-client.ts` | Provider-agnostic LLM wrapper | `getLlmConfig()`, `callLlm(request, config?)` |
| 4 | `circuit-breaker.ts` | Per-agent circuit breaker (same pattern as existing) | `CircuitBreaker` class — 5 failures = open, 60s reset |
| 5 | `rate-limit.ts` | Per-user rate limiting | 30 req/hr, in-memory |
| 6 | `retry.ts` | Backoff calculation | `calculateBackoffMs(attempt)`, `shouldRetry(attempt, maxAttempts)` |
| 7 | `token-tracking.ts` | Cost estimation + request logging | `estimateCostCents(model, inputTokens, outputTokens)`, `logAgentRequest(db, entry)` |
| 8 | `job-queue.ts` | Job CRUD with FOR UPDATE SKIP LOCKED | `createJob()`, `pollForJob()`, `completeJob()`, `failJob()`, `getJobStatus()` |
| 9 | `heartbeat.ts` | Agent heartbeat updater | `startHeartbeat(db, agentId, intervalMs)` |
| 10 | `memory.ts` | Scoped memory CRUD | `readMemory()`, `writeMemory()`, `upsertMemory()` — all filtered by `agent_id` |
| 11 | `context.ts` | Context assembly for LLM calls | `buildAgentContext(db, userId, agentId)` — trades, macro, memory |
| 12 | `prompts.ts` | System prompts per agent | `getSystemPrompt(agentId, mode)`, loads from `prompts/*.md` |
| 13 | `config.ts` | Agent config registry | `AGENT_CONFIGS: Record<AgentId, AgentConfig>` with blueprints and resolver |
| 14 | `blueprint-runner.ts` | Blueprint execution engine | `runBlueprint(blueprint, job, config, db)` — iterates steps, tracks tokens, handles step failures |
| 15 | `worker.ts` | Poll loop runtime | `startWorker(config: WorkerConfig): Promise<void>` — resolves blueprint, calls `runBlueprint()`, graceful shutdown |
| 16 | `macro-cron.ts` | Macro headline cron | `startMacroCron(): void` — setInterval, checks hour in `America/New_York` |
| 17 | `admin.ts` | Admin utilities | `requireAgentAdmin()` — validates `x-agent-admin-key` header |

### Key Type Definitions

```typescript
export type AgentId = 'orchestrator' | 'small-cap-trader' | 'long-term-investor';
export type JobType = 'chat' | 'research' | 'trade-analysis' | 'macro-summary';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type ReportStatus = 'pending_review' | 'approved' | 'rejected' | 'archived';
export type StepType = 'code' | 'llm';
export type MemoryCategory = 'fact' | 'thesis' | 'watchlist' | 'scan_param' | 'performance'
  | 'trade_insight' | 'user_preference' | 'strategy_note' | 'macro_fact';
```

---

## 10. Error Handling & Retry

### Exponential Backoff

```typescript
function calculateBackoffMs(attempt: number): number {
  return Math.pow(2, attempt) * 2000;  // attempt 1 = 2s, attempt 2 = 8s, attempt 3 = 32s
}
```

### Retry Flow

1. Job fails during processing
2. If `attempt < max_attempts`: set `status = 'queued'`, `next_retry_at = now() + backoff`
3. Job becomes eligible for polling again after `next_retry_at`
4. **Dead letter:** When `attempt >= max_attempts` (default 3), set `status = 'failed'` permanently. Error preserved in `error_message`.

### Circuit Breaker

Per-agent, in-memory state:
- **Threshold:** 5 consecutive failures → circuit opens
- **Reset:** 60 seconds after opening
- **When open:** Jobs are immediately failed without attempting LLM call

---

## 11. Token Observability & Budget

### Per-Request Logging

Every LLM call writes to `agent_request_log` with:
- `agent_id` — which agent made the call
- `model_used` — actual model string (e.g., `deepseek-v3.2`)
- `estimated_cost_cents` — calculated from pricing table

### Cost Estimation

```typescript
const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  'deepseek-v3.2': { inputPer1k: 0.014, outputPer1k: 0.014 },
  'local/*': { inputPer1k: 0, outputPer1k: 0 },
};
```

### Monthly Budget

- Default: `AGENT_MONTHLY_BUDGET_CENTS=10000` ($100/month)
- **Observability only in v1** — no hard enforcement, just dashboard tracking
- UI warning at >80% used, critical alert at >100%

### Admin Stats Endpoint

`GET /api/agents/admin/stats` returns:

```json
{
  "circuitBreakers": { "orchestrator": "closed", ... },
  "today": {
    "totalRequests": 42,
    "totalTokens": 128000,
    "estimatedCostCents": 180,
    "successRate": 0.95,
    "avgDurationMs": 2300,
    "byAgent": { "orchestrator": { ... }, "small-cap-trader": { ... } }
  },
  "thisMonth": {
    "totalTokens": 3200000,
    "estimatedCostCents": 4480,
    "budgetCents": 10000,
    "budgetUsedPercent": 44.8
  },
  "agents": [
    { "id": "orchestrator", "displayName": "Orchestrator", "status": "online", "lastHeartbeat": "..." }
  ],
  "pendingReports": 3,
  "memory": { "total": 156, "byCategory": { "fact": 89, "thesis": 12, ... } },
  "macroSummaries": { "latestGeneratedAt": "..." }
}
```

---

## 12. Supervised Mode (Level 1 Autonomy)

### Flow

1. Agent produces report → writes to `agent_reports` with `status = 'pending_review'`
2. `AgentReportQueue.tsx` displays pending reports as cards
3. Each card shows: agent name, report type, title, summary, timestamp
4. User clicks **Approve** or **Reject**
5. `PATCH /api/agents/reports/[id]` updates `status`, `reviewed_at`, `review_notes`

### Status Transitions

```
pending_review → approved    (user approves)
pending_review → rejected    (user rejects with notes)
approved       → archived    (user archives old report)
rejected       → archived    (user archives old report)
```

### UI Integration

- Badge count on sidebar "Agents" tab shows number of `pending_review` reports
- Report queue is a sub-tab within the Agents tab

---

## 13. API Route Migration

All routes under `/api/jarvis/*` are replaced by `/api/agents/*`.

### New Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/agents/chat` | POST | Create chat job → returns `{ job_id }` |
| `/api/agents/chat` | GET | Poll for result `?job_id=X` → returns `{ status, result?, error? }` |
| `/api/agents/reports` | GET | List reports `?status=pending_review` |
| `/api/agents/reports/[id]` | GET | Get single report |
| `/api/agents/reports/[id]` | PATCH | Approve/reject: `{ status, review_notes? }` |
| `/api/agents/research` | POST | Create research job |
| `/api/agents/research` | GET | List past research reports |
| `/api/agents/trade-analysis` | POST | Create trade analysis job |
| `/api/agents/admin/stats` | GET | Admin dashboard data |
| `/api/agents/admin/memory` | GET/DELETE | Admin memory management |
| `/api/agents/macro-summary/latest` | GET | Latest macro summary |

### Chat Polling Flow

1. Client POSTs `{ message, session_id?, agent_id? }` to `/api/agents/chat`
2. Server saves user message to `agent_conversations`, routes to agent via deterministic rules, creates `agent_jobs` row, returns `{ job_id }`
3. Client polls `GET /api/agents/chat?job_id=X` every **2 seconds**
4. Returns `{ status: 'completed', result: { message, session_id } }` or `{ status: 'failed', error }` or `{ status: 'queued' | 'processing' }`

**Pros of polling vs SSE:** Simpler to implement, works through all proxies/CDNs, stateless server.
**Cons:** 2s latency floor, unnecessary requests while waiting. SSE can be added later as an optimization.

### Agent Routing Logic

```typescript
function routeToAgent(message: string, explicitAgentId?: string): AgentId {
  if (explicitAgentId && isValidAgentId(explicitAgentId)) return explicitAgentId;
  if (message.startsWith('/research ')) return 'small-cap-trader';
  if (message.startsWith('/analyze')) return 'small-cap-trader';
  return 'orchestrator';  // default
}
```

---

## 14. Frontend Migration

### New Components

| Component | Replaces | Purpose |
|-----------|----------|---------|
| `AgentChat.tsx` | `JarvisChat.tsx` | Polling-based chat with "Thinking..." indicator, agent selector dropdown |
| `AgentTab.tsx` | `JarvisTab.tsx` | Wraps AgentChat, adds sub-tabs: Chat, Reports, Stats |
| `AgentReportQueue.tsx` | (new) | Lists `pending_review` reports as cards with Approve/Reject buttons |
| `AgentStats.tsx` | (new) | Per-agent token usage, cost, latency charts. Budget tracking display. |

### Sidebar Change

- Tab key `'jarvis'` → `'agents'`
- Label "Jarvis" → "Agents"
- Badge count shows pending report count

### Kept Renderers (no functional changes)

- `JarvisStructuredResponse.tsx` — rename to `AgentStructuredResponse.tsx`
- `JarvisDilutionReport.tsx` — rename to `AgentDilutionReport.tsx`
- `JarvisMacroSummary.tsx` — rename to `AgentMacroSummary.tsx`

---

## 15. Docker Infrastructure

### Single Shared Dockerfile

```dockerfile
# services/agent.Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY lib/ ./lib/
COPY services/agent-entrypoint.ts ./
# Option A: compile
RUN npx tsc services/agent-entrypoint.ts --outDir dist/ --esModuleInterop --resolveJsonModule --module commonjs --target es2022 --skipLibCheck
CMD ["node", "dist/services/agent-entrypoint.js"]
# Option B (alternative): use tsx runtime
# CMD ["npx", "tsx", "services/agent-entrypoint.ts"]
```

Only copies `lib/` and the entrypoint — NOT the Next.js app or components.

### Entrypoint

```typescript
// services/agent-entrypoint.ts
import { startWorker } from '../lib/agents/worker';
import { startMacroCron } from '../lib/agents/macro-cron';
import { AGENT_CONFIGS } from '../lib/agents/config';
import type { AgentId } from '../lib/agents/types';

const agentId = process.env.AGENT_ID as AgentId;
if (!agentId || !AGENT_CONFIGS[agentId]) {
  console.error(`Unknown AGENT_ID: ${agentId}`);
  process.exit(1);
}

if (agentId === 'orchestrator') {
  startMacroCron();
}

startWorker({
  agentId,
  pollIntervalMs: Number(process.env.AGENT_POLL_INTERVAL_MS) || 5000,
  blueprintResolver: AGENT_CONFIGS[agentId].blueprintResolver,
});
```

### Docker Compose

```yaml
# services/docker-compose.yml
version: '3.8'

services:
  orchestrator:
    build:
      context: ..
      dockerfile: services/agent.Dockerfile
    environment:
      - AGENT_ID=orchestrator
      - DATABASE_URL=${DATABASE_URL}
      - AGENT_API_KEY=${AGENT_API_KEY}
      - AGENT_API_BASE_URL=${AGENT_API_BASE_URL}
      - AGENT_MODEL=${AGENT_MODEL}
      - AGENT_POLL_INTERVAL_MS=${AGENT_POLL_INTERVAL_MS:-5000}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
      - MASSIVE_API_KEY=${MASSIVE_API_KEY}
      - MACRO_CRON_HOUR=6
      - TZ=America/New_York
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
    restart: unless-stopped

  small-cap-trader:
    build:
      context: ..
      dockerfile: services/agent.Dockerfile
    environment:
      - AGENT_ID=small-cap-trader
      - DATABASE_URL=${DATABASE_URL}
      - AGENT_API_KEY=${AGENT_API_KEY}
      - AGENT_API_BASE_URL=${AGENT_API_BASE_URL}
      - AGENT_MODEL=${AGENT_MODEL}
      - AGENT_POLL_INTERVAL_MS=${AGENT_POLL_INTERVAL_MS:-5000}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
      - MASSIVE_API_KEY=${MASSIVE_API_KEY}
      - TZ=America/New_York
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
    restart: unless-stopped

  long-term-investor:
    build:
      context: ..
      dockerfile: services/agent.Dockerfile
    environment:
      - AGENT_ID=long-term-investor
      - DATABASE_URL=${DATABASE_URL}
      - AGENT_API_KEY=${AGENT_API_KEY}
      - AGENT_API_BASE_URL=${AGENT_API_BASE_URL}
      - AGENT_MODEL=${AGENT_MODEL}
      - AGENT_POLL_INTERVAL_MS=${AGENT_POLL_INTERVAL_MS:-5000}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
      - MASSIVE_API_KEY=${MASSIVE_API_KEY}
      - TZ=America/New_York
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
    restart: unless-stopped
```

**Total resource usage:** ~1.5GB RAM for 3 agents. Fits comfortably on a 16GB laptop.

### Home Server Notes

- Laptop must have sleep disabled (`systemd-inhibit` or power settings)
- Use ethernet for reliability
- `TZ=America/New_York` ensures cron schedules align with market hours
- Future option: migrate to a VPS (Hetzner $4/mo, Oracle Cloud free tier with 4 ARM cores / 24GB RAM)

---

## 16. Build Order (7 Phases)

Sequential phases. Each phase must pass `npm run lint && npx tsc --noEmit` before proceeding.

### Phase 1: Foundation (no breaking changes)

| Step | File | Depends On |
|------|------|------------|
| 1 | `lib/agents/types.ts` | — |
| 2 | `lib/agents/retry.ts` | — |
| 3 | `lib/agents/llm-client.ts` | types.ts |
| 4 | `lib/agents/circuit-breaker.ts` | types.ts |
| 5 | `lib/agents/rate-limit.ts` | types.ts |
| 6 | `lib/agents/admin.ts` | — |

### Phase 2: Schema & Migration

| Step | Task | Depends On |
|------|------|------------|
| 7 | Update `lib/db/schema.ts` — add 5 new tables, modify `agent_memory` | Phase 1 |
| 8 | `npm run db:generate` — generate migration 0011 | Step 7 |
| 9 | `npm run db:migrate` — run migration 0011 | Step 8 |

### Phase 3: Shared Agent Logic

| Step | File | Depends On |
|------|------|------------|
| 10 | `lib/agents/db.ts` | Phase 2 |
| 11 | `lib/agents/job-queue.ts` | db.ts, types.ts |
| 12 | `lib/agents/token-tracking.ts` | db.ts, types.ts |
| 13 | `lib/agents/memory.ts` | db.ts, types.ts |
| 14 | `lib/agents/context.ts` | memory.ts |
| 15 | `lib/agents/prompts.ts` | types.ts |
| 16 | `lib/agents/blueprint-runner.ts` | types.ts, llm-client.ts, memory.ts, context.ts |
| 17 | `lib/agents/config.ts` | types.ts, prompts.ts, blueprint-runner.ts |
| 18 | `lib/agents/heartbeat.ts` | db.ts |
| 19 | `lib/agents/worker.ts` | job-queue.ts, heartbeat.ts, config.ts, blueprint-runner.ts |
| 20 | `lib/agents/macro-cron.ts` | db.ts, context.ts, llm-client.ts |

### Phase 4: API Routes

| Step | Route | Depends On |
|------|-------|------------|
| 21 | `app/api/agents/chat/route.ts` | Phase 3 |
| 22 | `app/api/agents/reports/route.ts` | Phase 3 |
| 23 | `app/api/agents/reports/[id]/route.ts` | Phase 3 |
| 24 | `app/api/agents/research/route.ts` | Phase 3 |
| 25 | `app/api/agents/trade-analysis/route.ts` | Phase 3 |
| 26 | `app/api/agents/admin/stats/route.ts` | Phase 3 |
| 27 | `app/api/agents/admin/memory/route.ts` | Phase 3 |
| 28 | `app/api/agents/macro-summary/latest/route.ts` | Phase 3 |

### Phase 5: Docker Infrastructure

| Step | File | Depends On |
|------|------|------------|
| 29 | `services/agent.Dockerfile` | Phase 3 |
| 30 | `services/agent-entrypoint.ts` | Phase 3 |
| 31 | `services/docker-compose.yml` (rewrite) | Steps 29-30 |
| 32 | `services/.env.example` | — |

### Phase 6: Frontend

| Step | File | Depends On |
|------|------|------------|
| 33 | `components/trading/AgentChat.tsx` | Phase 4 |
| 34 | `components/trading/AgentTab.tsx` | Step 33 |
| 35 | `components/trading/AgentReportQueue.tsx` | Phase 4 |
| 36 | `components/trading/AgentStats.tsx` | Phase 4 |
| 37 | Modify `Sidebar.tsx` — `'jarvis'` → `'agents'` | Steps 33-36 |

### Phase 7: Cleanup (after full validation)

| Step | Task | Depends On |
|------|------|------------|
| 38 | Delete `app/api/jarvis/` directory | Phase 4 verified |
| 39 | Delete `lib/jarvis/` directory | Phase 3 verified |
| 40 | Delete `JarvisChat.tsx`, `JarvisTab.tsx` | Phase 6 verified |
| 41 | Remove Vercel cron config for macro-summary | Phase 5 verified |
| 42 | Generate migration 0012 (drop `jarvis_conversations`, `jarvis_request_log`) | Phase 2 verified |
| 43 | Run migration 0012 | Step 42 |

---

## 17. Complete File Inventory

### Files to CREATE (35)

```
lib/agents/types.ts
lib/agents/db.ts
lib/agents/llm-client.ts
lib/agents/circuit-breaker.ts
lib/agents/rate-limit.ts
lib/agents/retry.ts
lib/agents/token-tracking.ts
lib/agents/job-queue.ts
lib/agents/heartbeat.ts
lib/agents/memory.ts
lib/agents/context.ts
lib/agents/prompts.ts
lib/agents/blueprint-runner.ts
lib/agents/config.ts
lib/agents/worker.ts
lib/agents/macro-cron.ts
lib/agents/admin.ts
lib/agents/prompts/orchestrator.md
lib/agents/prompts/small-cap.md
lib/agents/prompts/long-term.md
app/api/agents/chat/route.ts
app/api/agents/reports/route.ts
app/api/agents/reports/[id]/route.ts
app/api/agents/research/route.ts
app/api/agents/trade-analysis/route.ts
app/api/agents/admin/stats/route.ts
app/api/agents/admin/memory/route.ts
app/api/agents/macro-summary/latest/route.ts
components/trading/AgentChat.tsx
components/trading/AgentTab.tsx
components/trading/AgentReportQueue.tsx
components/trading/AgentStats.tsx
services/agent.Dockerfile
services/agent-entrypoint.ts
services/.env.example
```

### Files to MODIFY (4)

```
lib/db/schema.ts                  -- add 5 tables, alter agent_memory
services/docker-compose.yml       -- rewrite (3 agent services, no Redis)
components/trading/Sidebar.tsx    -- 'jarvis' → 'agents' tab
package.json                      -- (if any new deps needed)
```

### Files to DELETE (Phase 7) (~22)

```
app/api/jarvis/chat/route.ts
app/api/jarvis/research/route.ts
app/api/jarvis/trade-analysis/route.ts
app/api/jarvis/admin/memory/route.ts
app/api/jarvis/admin/stats/route.ts
app/api/jarvis/macro-summary/latest/route.ts
app/api/jarvis/cron/macro-summary/route.ts
lib/jarvis/client.ts
lib/jarvis/types.ts
lib/jarvis/prompts.ts
lib/jarvis/context.ts
lib/jarvis/memory.ts
lib/jarvis/research.ts
lib/jarvis/trade-analysis.ts
lib/jarvis/askedgar.ts
lib/jarvis/scrape-lite.ts
lib/jarvis/rate-limit.ts
lib/jarvis/circuit-breaker.ts
lib/jarvis/token-tracking.ts
lib/jarvis/admin.ts
components/trading/JarvisChat.tsx
components/trading/JarvisTab.tsx
```

---

## 18. Environment Variables

### New Variables

| Variable | Default | Used By | Purpose |
|----------|---------|---------|---------|
| `DATABASE_URL` | (existing, required) | All agents + Next.js | Neon Postgres connection string |
| `AGENT_API_KEY` | (falls back to `NVIDIA_API_KEY`) | All agents | LLM API authentication |
| `AGENT_API_BASE_URL` | `https://integrate.api.nvidia.com/v1/chat/completions` | All agents | LLM endpoint |
| `AGENT_MODEL` | `deepseek-v3.2` | All agents | Default model |
| `AGENT_LLM_TIMEOUT_MS` | `30000` | All agents | LLM request timeout |
| `AGENT_POLL_INTERVAL_MS` | `5000` | All agents | Job queue poll interval |
| `AGENT_ID` | (required per service) | Each Docker service | Agent identity |
| `AGENT_ADMIN_KEY` | (falls back to `JARVIS_ADMIN_KEY`) | Next.js app | Admin API auth |
| `AGENT_MONTHLY_BUDGET_CENTS` | `10000` | Next.js app | $100 budget tracking |
| `MACRO_CRON_HOUR` | `6` | Orchestrator | Hour (ET) to run macro summary |
| `MASSIVE_API_KEY` | (existing) | All agents | Market data API |
| `ASKEDGAR_API_KEY` | (existing) | All agents | SEC filings API |
| `TZ` | `America/New_York` | All agents | Timezone for cron/schedule alignment |

### Deprecated (still read as fallback)

| Old Name | Replaced By |
|----------|-------------|
| `NVIDIA_API_KEY` | `AGENT_API_KEY` |
| `JARVIS_API_BASE_URL` | `AGENT_API_BASE_URL` |
| `JARVIS_MODEL` | `AGENT_MODEL` |
| `JARVIS_TIMEOUT_MS` | `AGENT_LLM_TIMEOUT_MS` |
| `JARVIS_ADMIN_KEY` | `AGENT_ADMIN_KEY` |
| `CRON_SECRET` | (removed — macro cron is now in-process) |

---

## 19. Deferred: Discord Channel Adapter

Discord integration is deferred to a future sprint. When implemented:

1. The existing Discord bot gets a `/ask <query>` slash command
2. The command resolves Discord user → Nexus user via `discord_user_links`
3. Writes an `agent_job` with `channel = 'discord'`
4. Polls for completion, formats result as Discord embed
5. Outbound: Orchestrator writes reports → `notification_jobs` (existing pattern) → Discord delivery

**No schema changes required.** The `agent_conversations.channel` column already supports `'discord'`. The `agent_reports` table is channel-agnostic.

**Prerequisites:** Discord bot service must be running, `discord_user_links` table populated.

---

## 20. Deferred: Swing Trader Agent

A swing trader agent (trending companies, sentiment from social media, news commentary) is architecturally supported but not in the current build. To add later:

1. Add `'swing-trader'` to the `AgentId` type union
2. Add config entry in `lib/agents/config.ts`
3. Add routing rules in the Orchestrator
4. Add `lib/agents/prompts/swing-trader.md`
5. Add service to `docker-compose.yml`
6. Seed `agent_registry` row

No schema changes required — tables are agent-agnostic by design.

---

## 21. Open Questions

1. **Historical research import format.** What format are existing research reports in? (PDF, markdown, spreadsheet, plain text?) This determines the import script format.

2. **User profile storage.** The Long Term Investor needs age, time horizon, and goals. Should this live in `agent_memory` under the Orchestrator (key: `user_preference`), or a dedicated column/table?

---

## Appendix: Data Source Notes

### Massive API (Polygon-compatible)

- **Stock starter kit** has unlimited rate limit — no rate limiter needed
- Used for: snapshots, OHLCV, market status, pre-market gainers
- Same API shape as Polygon.io, existing `MASSIVE_API_KEY` env var

### AskEdgar API

- **Endpoint:** `https://eapi.askedgar.io`
- **Auth:** `ASKEDGAR_API_KEY`
- **Rate limit:** Generous, supports parallel `Promise.allSettled` fetches
- Used for: SEC filings (S-3, 8-K, prospectus), 10-K/10-Q financials, filing search

### Existing Jarvis Module Reuse

| Jarvis Module | Agent Equivalent | Notes |
|---------------|-----------------|-------|
| `client.ts` | `llm-client.ts` | Rewrite with provider detection |
| `circuit-breaker.ts` | `circuit-breaker.ts` | Same pattern, per-agent state |
| `rate-limit.ts` | `rate-limit.ts` | Same 30 req/hr |
| `token-tracking.ts` | `token-tracking.ts` | Extend with agent_id + cost |
| `memory.ts` | `memory.ts` | Rewrite with agent_id scope |
| `context.ts` | `context.ts` | Extend with agent-specific context |
| `askedgar.ts` | (standalone) | Move to `lib/askedgar.ts` |
| `prompts.ts` | `prompts.ts` | Split into per-agent files |
| `scrape-lite.ts` | (reuse as-is) | No changes needed |
| `trade-analysis.ts` | Small Cap blueprint steps | Logic split across `code` and `llm` steps in `small-cap:research` blueprint |
| `research.ts` | Small Cap blueprint steps | Logic split across `code` and `llm` steps in `small-cap:pre-market-scan` blueprint |
| (new) | `blueprint-runner.ts` | New file — executes blueprint step sequences, tracks tokens per step |

---

## REVISION 1 — Decisions & Fixes (2026-03-22)

> Review session identified gaps in triggers, communication, permissions, blueprint engine, and deployment. Several architecture decisions were made that change the spec.

### R1.1 Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| OS / Server | Keep Windows + WSL2, install Docker Engine natively in WSL2 | Laptop IS the server. 16GB RAM is plenty for 3x512MB containers. WSL2 with systemd=true auto-starts Docker. No wipe needed. |
| Local LLM | No — API only | API costs ~$10-15/mo. Local 7B model saves nothing meaningful, takes 4-5GB RAM, worse quality. |
| LLM Provider | Compare Groq (Llama 3.3 70B) vs DeepSeek direct, then commit | Already running Groq for Jarvis. Both OpenAI-compatible. Possible hybrid: Groq for Orchestrator chat (speed), DeepSeek for background agents (quality + cost). |
| Report delivery | Discord-first via per-channel webhooks | Specialist agents post to Discord channels. Only Orchestrator has web chat. Eliminates AgentReportQueue.tsx, AgentStats.tsx, in-app approval flow. |
| Orchestrator Discord | Bidirectional via bot in #orchestrator | Promoted from Section 19 "deferred" to V1. Bot listens in #orchestrator, creates jobs, polls, posts response. |
| Opening bell trigger | Deferred to V2 | 7 AM pre-market scan is enough for V1. |
| Supervised mode | Level 1.5 — reports posted as FYI, no approval gate | Reports go to Discord. User reads and acts (or doesn't). Approval via Discord reactions deferred to V2+. |

---

### R1.2 Discord-First Architecture (replaces Section 12 supervised mode + Section 14 frontend)

#### Channel Layout

| Channel | Method | Posts from | Content |
|---------|--------|-----------|---------|
| `#orchestrator` | Bot (listener) + Webhook (responses) | Orchestrator | Two-way chat: user types, Orchestrator responds |
| `#small-cap-scans` | Webhook | Small Cap Trader | Pre-market scan results, dilution analysis |
| `#small-cap-research` | Webhook | Small Cap Trader | On-demand ticker research reports |
| `#macro-updates` | Webhook | Long Term Investor | Daily macro briefings, weekly macro scans |
| `#thesis-tracking` | Webhook | Long Term Investor | Thesis status updates, triggered/invalidated alerts |
| `#agent-system` | Webhook | Orchestrator | Agent health alerts, budget warnings, errors |

#### Bidirectional Orchestrator (replaces deferred Section 19)

Bot listens for messages in `#orchestrator`:
1. Maps Discord user → Nexus user (via `discord_user_links` or hardcoded)
2. Creates `agent_jobs` row (same as web chat POST)
3. Polls for completion
4. Posts response as Discord embed

Same routing rules as web chat:
- `/research TICKER` → Small Cap (report to #small-cap-research)
- `/analyze TICKER` → Small Cap
- `/macro` → Long Term (report to #macro-updates)
- `/thesis` → Long Term
- Anything else → Orchestrator (response in #orchestrator)

#### Webhook Delivery

Each agent's final blueprint step (`assemble-report`) does two things:
1. Writes report to `agent_reports` table (DB history)
2. POSTs formatted Discord embed to channel webhook URL

New env vars:
```
DISCORD_WEBHOOK_SCANS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_RESEARCH=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_MACRO=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_THESIS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_SYSTEM=https://discord.com/api/webhooks/...
```

New files:
- `lib/agents/discord-embed.ts` — Embed builder functions per report type
- `lib/agents/discord-delivery.ts` — Webhook POST utility

#### Discord Embed Format (TODO: finalize visual design)

**Small Cap Scan:** Ticker, pre-market gain %, price, market cap, dilution risk (color-coded), filing summary, technical levels, confidence, timestamp.

**Long Term Macro:** Regime assessment, key indicators with direction, sector rotation signals, top 3 risks, timestamp.

**Thesis Update:** Title, ticker(s), status (ON-TRACK/TRIGGERED/INVALIDATED), what changed, recommended action, color by status.

**System Alert:** Type, severity color, details, suggested action.

All embeds use emerald-500 (`0x10B981`) as base color to match Nexus theme.

#### Frontend Simplification

**Remove from build plan (Section 16):**
- `AgentReportQueue.tsx` (was step 35)
- `AgentStats.tsx` (was step 36)
- Report badge count on sidebar
- Report approve/reject flow

**Simplify:**
- `AgentTab.tsx` — just Chat, no Reports/Stats sub-tabs in V1
- `AgentChat.tsx` — add agent name display, progress notes

---

### R1.3 LLM Provider Update (replaces Section 8)

Replace NVIDIA API references with provider-agnostic config. Current candidate providers:

**Groq (Llama 3.3 70B):** ~$0.59/M input, $0.79/M output. Blazing fast (~500 tok/s). Free tier: 30 req/min, 6k tokens/min. Already working for Jarvis.

**DeepSeek direct (v3):** ~$0.27/M input, $1.10/M output. Input caching at $0.07/M. Slightly better reasoning. Slower inference.

**Possible hybrid:** Groq for Orchestrator (chat speed matters), DeepSeek for background agents (async, quality + cost matter). Per-agent config already supports different models.

Updated env vars (Section 18):
```
AGENT_API_KEY          — Groq or DeepSeek API key (falls back to JARVIS_API_KEY)
AGENT_API_BASE_URL     — https://api.groq.com/openai/v1 or https://api.deepseek.com/v1
AGENT_MODEL            — llama-3.3-70b-versatile (Groq) or deepseek-chat (DeepSeek)
```

---

### R1.4 Trigger Fixes (amends Section 6)

#### Catch-up Logic (CRITICAL)

All cron triggers must check "has today's output been generated?" instead of "is it the right hour?" If the laptop was off during the scheduled time, agents should catch up when they come online.

```
ORCHESTRATOR:
  macro_cron: "if today's macro summary missing AND hour < 14 → run"
  stale_job_reaper: every 5 min, reset jobs in 'processing' > 5 min to 'queued'

SMALL CAP:
  pre_market_scan: 7 AM EST target
    catch-up: if today's scan missing AND hour < 9:30 → run
    gate: check Massive API /v1/marketstatus/now (no-op on weekends/holidays)

LONG TERM:
  macro_scan: Sunday evening target
    catch-up: if this week's scan missing → run on next boot (up to Monday)
  thesis_check: 5 PM EST target
    catch-up: if today's check missing AND hour < 20 → run
    gate: same market status check
```

#### Stale Job Reaper (NEW — Orchestrator responsibility)

Every 5 minutes, the Orchestrator runs:
```sql
UPDATE agent_jobs
SET status = 'queued', started_at = NULL
WHERE status = 'processing'
  AND started_at < now() - interval '5 minutes';
```

Prevents orphaned jobs from container crashes.

#### Market Holiday Gate

All autonomous triggers check `GET /v1/marketstatus/now` from Massive API before running. No-op on weekends and market holidays. Simple boolean: if market is closed, skip.

---

### R1.5 Blueprint Engine Fixes (amends Section 6.4)

#### Step Data Accumulation

Each step receives `previousOutput` from step N-1. Convention: **every step must spread previous output into its return value.**

```typescript
// Step 1 returns: { candidates: [...] }
// Step 2 returns: { ...previousOutput, filings: [...] }
// Step 3 returns: { ...previousOutput, dilutionScores: [...] }
// ...
// Step 6 receives: { candidates, filings, dilutionScores, technicalData, analysis }
```

This is the accumulator pattern. Document as a required convention for all blueprint steps.

#### Dockerfile Fix

**Replace tsc compilation (Option A) with tsx runtime (Option B):**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --production
COPY lib/ ./lib/
COPY services/agent-entrypoint.ts ./services/
CMD ["npx", "tsx", "services/agent-entrypoint.ts"]
```

Why: `@/lib/...` path aliases require tsconfig. `tsx` reads it automatically. No compilation step needed.

#### Internal Parallelism

Blueprint steps run sequentially, but code steps can use `Promise.all` internally. The existing `askedgar.ts` already does parallel `Promise.allSettled` for multi-ticker fetches. Document: "code steps manage their own parallelism within a single step."

#### Job Progress Notes

Add `progress_note TEXT` column to `agent_jobs` schema (Section 3.2). The blueprint runner updates this before each step:

```typescript
await db.update(agentJobs)
  .set({ progressNote: `Step ${i+1}/${total}: ${step.name}` })
  .where(eq(agentJobs.id, job.id));
```

Polling endpoint returns `progress_note` so the web UI and Discord bot can show progress.

---

### R1.6 Migration Window Fix (amends Section 4)

**Problem:** Migration 0011 changes `agent_memory` unique constraint. Old `lib/jarvis/memory.ts` targets the old constraint via `onConflictDoUpdate`. Between Phase 2 and Phase 7, old code breaks.

**Fix:** Clean cutover — do these in the same deploy:
1. Run Migration 0011 (new tables + altered constraint)
2. Deploy new agent API routes (Phase 4)
3. Update sidebar tab `jarvis` → `agents`
4. Delete old Jarvis routes and modules
5. Run Migration 0012 (drop old tables)

No window where old code runs against new schema.

---

### R1.7 Docker Compose Fixes (amends Section 15)

Add to every service in `docker-compose.yml`:

```yaml
logging:
  driver: json-file
  options:
    max-size: "50m"
    max-file: "3"
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
  interval: 30s
  timeout: 10s
  retries: 3
```

Note: Agent containers don't run a web server, so healthcheck should instead check heartbeat freshness by querying the DB. Simpler alternative: write a `/tmp/healthy` file on each heartbeat, check with `test -f /tmp/healthy && find /tmp/healthy -mmin -2`.

---

### R1.8 Routing Rules Update (amends Section 13)

```typescript
function routeToAgent(message: string, explicitAgentId?: string): AgentId {
  if (explicitAgentId && isValidAgentId(explicitAgentId)) return explicitAgentId;
  if (message.startsWith('/research ')) return 'small-cap-trader';
  if (message.startsWith('/analyze')) return 'small-cap-trader';
  if (message.startsWith('/macro')) return 'long-term-investor';    // NEW
  if (message.startsWith('/thesis')) return 'long-term-investor';   // NEW
  return 'orchestrator';
}
```

---

### R1.9 Deployment Procedure (NEW section)

#### Initial Setup
1. Install Docker Engine in WSL2 (`curl -fsSL https://get.docker.com | sh`)
2. `sudo systemctl enable docker`
3. Create `services/.env` from `services/.env.example`
4. Set up Discord channels + webhooks, copy URLs to `.env`
5. Run database migrations
6. `docker compose build && docker compose up -d`
7. Verify: `docker compose ps`, check Discord #agent-system for startup message

#### Updating Agents
```bash
cd ~/Nexus-Terminal && git pull
cd services && docker compose build && docker compose up -d
```
Graceful shutdown handles in-progress jobs. ~30 sec downtime.

#### Keeping Laptop Running
- Disable Windows sleep: Settings → System → Power → Never
- Use ethernet, not Wi-Fi
- `restart: unless-stopped` in compose auto-recovers from Docker/WSL restarts

---

### R1.10 Updated File Inventory

**New files to CREATE (add to Section 17):**
```
lib/agents/discord-embed.ts        — Embed builders per report type
lib/agents/discord-delivery.ts     — Webhook POST utility
```

**Files to REMOVE from Section 17 (deferred/eliminated):**
```
components/trading/AgentReportQueue.tsx    — REMOVED (Discord replaces)
components/trading/AgentStats.tsx          — DEFERRED to V2
```

**Updated build phase count:** 35 files to create (was 35, -2 removed, +2 Discord added).

---

### R1.11 Open Items (resolve before implementation)

1. **Discord embed visual design** — Build test webhooks and iterate on format in real Discord channels.
2. **Groq vs DeepSeek comparison** — Run identical prompts through both, compare quality/latency/cost.
3. **Discord bot for #orchestrator** — Reuse existing `services/discord-bot/` or build new?
4. **Deployment automation** — Manual `docker compose build && up` or auto-deploy script?
5. **AskEdgar call counter** — Per-process counter wrong with 3 containers. Rely on DB cache or move counter to DB row.
