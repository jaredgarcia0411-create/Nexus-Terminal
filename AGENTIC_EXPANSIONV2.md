# Nexus Terminal — Autonomous Agent Framework Reference

> Generated: 2026-03-13 | Updated: 2026-04-12 | Status: V1 architecture reference; execution plan completed

---

## 1. Executive Summary

This document specifies a multi-agent system for Nexus Terminal consisting of three runtime components: an **Orchestrator** (with built-in research routing pipeline and macro cron), a **Small Cap Trader (Short-Selling Specialist)** agent, and a **Swing Trader** agent. In V1, all agent chat enters through `POST /api/agents/service/chat`, which always creates exactly one `orchestrator` `chat` job first. The Orchestrator then decides whether to handle the request directly or use specialist workflows according to deterministic routing rules. Multi-agent fanout for a single request is deferred to V2.

Agents run as Docker Compose services on a home server (16GB RAM laptop). They communicate via a Postgres-backed job queue (Neon Launch plan). The LLM provider is configurable via two deterministic lanes: INTERACTIVE_LLM (Orchestrator chat — optimized for speed) and BACKGROUND_LLM (specialist agent scans — optimized for cost/quality). Both use OpenAI-compatible endpoints. Testing uses Groq free tier with `llama-3.3-70b-versatile`. Production defaults to NVIDIA API during initial rollout, with the background lane allowed to switch to DeepSeek later without changing the lane contract. Market data comes from Massive API (Polygon-compatible, unlimited rate limit on stock starter kit). Ticker research comes from AskEdgar API.

All agent communication flows through Discord. Specialist reports publish to channel webhooks. Orchestrator chat happens in the `#orchestrator` Discord channel via the Discord bot. Reports are persisted in `agent_reports` for history. There is no in-app agent chat UI in V1.

> Document role:
> - The original AEV2 execution plan is complete and no longer lives as a maintained file. Use git history for archived sequencing and launch-gate detail.
> - This document captures the target V1 architecture, contracts, and runtime constraints.
> - Paths under `lib/agents/`, `app/api/agents/`, and `services/` now exist in the repo; sections that describe later enhancements call that out explicitly.

### Design Principles

- **Postgres is the backbone.** All inter-agent communication, state, memory, and job coordination flows through Postgres. No Redis, no message broker, no new infrastructure.
- **Agents are long-running Docker services.** They poll for work, execute, and write results back. They do not run on Vercel.
- **The Orchestrator owns routing.** The collapsed Research Analyst logic lives inside the Orchestrator as a deterministic rules engine — no LLM call for routing decisions.
In V1, this means API routes do not directly create specialist chat jobs for normal user chat; they create an Orchestrator job first, and routing happens inside the Orchestrator flow.
- **Each agent has strict scope boundaries.** An agent can only read its own memory and the shared job queue. Cross-agent data access goes through the Orchestrator.
- **Discord-first publish flow.** Specialist reports post to Discord webhooks and are persisted in `agent_reports` for history. V1 has no in-app approval gate; delivery status is tracked in the database and surfaced via admin observability.
- **Blueprint-driven handlers.** Every job handler is a blueprint — a sequence of typed steps where each step is either `code` (deterministic, no LLM) or `llm` (reasoning/analysis). Code steps fetch data, calculate indicators, format output. LLM steps analyze and synthesize. This keeps LLM calls minimal, costs low, and results reliable. Inspired by Stripe's blueprint engine pattern.
- **Provider-agnostic, dual-lane LLM.** The LLM wrapper uses two named config lanes — INTERACTIVE (Orchestrator chat) and BACKGROUND (specialist scans and macro jobs) — each with its own API key, base URL, model, and timeout. Lane assignment is deterministic per blueprint step, not URL-detected. Swapping providers per lane is a config-only change.
- **Three-layer prompt stack.** Every LLM call uses a layered prompt: (1) global orchestrator policy, (2) per-agent role prompt, (3) per-blueprint-step contract prompt. Policy is stable; each judgment step is narrow and testable.
- **Code owns truth, LLM owns judgment.** Routing, thresholds, ticker normalization, calculations, filtering, freshness checks, and persistence validation are deterministic code. LLM steps only synthesize, explain tradeoffs, or write summaries from validated evidence.
- **No vector RAG in V1.** Retrieval uses SQL queries, API tool calls (Massive, AskEdgar), and structured memory. Document RAG is deferred until a large unstructured corpus justifies it.

---

## 2. System Topology

```
┌──────────────────────────────────────────────────────────┐
│                    VERCEL (Next.js App)                    │
│                                                          │
│  Discord Bot ── POST /api/agents/service/chat ──┐        │
│  Discord Bot ── GET  /api/agents/service/chat ──┤        │
│  Admin ──────── GET  /api/agents/admin/stats ───┤        │
│                                                  ▼       │
│                                     ┌──────────────┐     │
│                                     │ Neon Postgres │     │
│                                     │ (Launch plan) │     │
│                                     └──────────────┘     │
└──────────────────────────────────────────────────────────┘
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
┌──────────────────────────────────────────────────────────┐
│          DOCKER COMPOSE (Home Server — 16GB RAM)          │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Orchestrator  │  │  Small Cap   │  │  Swing         │  │
│  │  (512M)      │  │  Trader      │  │  Trader        │  │
│  │              │  │  (512M)      │  │  (512M)        │  │
│  │ - Routes jobs│  │              │  │                │  │
│  │ - Macro cron │  │ - Pre-market │  │ - MDR pattern  │  │
│  │ - Memory     │  │   scans      │  │   recognition  │  │
│  │   oversight  │  │ - Short-sell │  │ - Momentum     │  │
│  │ - Cross-agent│  │   research   │  │   scans        │  │
│  │   synthesis  │  │ - Dilution   │  │ - Parabolic    │  │
│  │              │  │   risk eval  │  │   setup alerts │  │
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

9 objects total: 9 new tables. All live in `lib/db/schema.ts`.

### 3.1 `agent_registry` — Agent health tracking

```
agent_registry
├── id                  TEXT PRIMARY KEY              -- 'orchestrator' | 'small-cap-trader' | 'swing-trader'
├── display_name        TEXT NOT NULL
├── description         TEXT NOT NULL
├── status              TEXT NOT NULL DEFAULT 'offline'  -- 'online' | 'offline' | 'degraded'
├── capabilities        JSONB NOT NULL DEFAULT '[]'      -- ["chat", "research", "macro-summary", "pre-market-scan", "momentum-scan", "pattern-check"]
├── config              JSONB NOT NULL DEFAULT '{}'      -- agent-specific config (lane, model override, temperature, etc.)
├── last_heartbeat      TIMESTAMPTZ
├── created_at          TIMESTAMPTZ DEFAULT now()
└── updated_at          TIMESTAMPTZ DEFAULT now()

-- No indexes beyond PK — max 3 rows.
```

### 3.2 `agent_jobs` — Inter-agent job queue

```
agent_jobs
├── id                  TEXT PRIMARY KEY              -- uuid
├── agent_id            TEXT NOT NULL REFERENCES agent_registry(id)  -- target agent
├── user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
├── job_type            TEXT NOT NULL                 -- 'chat' | 'research' | 'macro-summary' | 'pre-market-scan' | 'momentum-scan' | 'pattern-check'
├── status              TEXT NOT NULL DEFAULT 'queued'  -- 'queued' | 'processing' | 'completed' | 'failed'
├── priority            INTEGER NOT NULL DEFAULT 0   -- higher = more urgent
├── input               JSONB NOT NULL               -- job-specific input payload
├── result              JSONB                        -- job output when completed
├── error_message       TEXT                         -- error detail when failed
├── progress_note       TEXT                         -- current step label for UI/Discord progress
├── step_log            JSONB DEFAULT '[]'           -- metadata only: { step, status, startedAt, completedAt, attempt, validatorResult, tokensUsed, errorClass }
├── attempt             INTEGER NOT NULL DEFAULT 0   -- current attempt number
├── max_attempts        INTEGER NOT NULL DEFAULT 3
├── next_retry_at       TIMESTAMPTZ                  -- null = ready now; set for backoff
├── locked_by           TEXT                         -- worker identity (hostname:pid or container name)
├── lock_expires_at     TIMESTAMPTZ                  -- lease expiry; null when not locked
├── last_heartbeat_at   TIMESTAMPTZ                  -- updated by worker during long steps
├── lease_version       INTEGER NOT NULL DEFAULT 0   -- increments on each successful lease acquisition
├── created_at          TIMESTAMPTZ DEFAULT now()
├── started_at          TIMESTAMPTZ
├── completed_at        TIMESTAMPTZ
└── INDEXES
    ├── idx_agent_jobs_poll ON (agent_id, priority DESC, created_at) WHERE status = 'queued'
    ├── idx_agent_jobs_user_status ON (user_id, status, created_at)
    └── idx_agent_jobs_stale ON (status, lock_expires_at) WHERE status = 'processing'
```

**Autonomous ownership rule:** `job_type IN ('macro-summary', 'pre-market-scan', 'momentum-scan', 'pattern-check')` always uses a single system-owned user row, `system-agent-user`, in `users.id`. V1 does not use `NULL` for autonomous jobs.

**Poll query (FOR UPDATE SKIP LOCKED):**

```sql
UPDATE agent_jobs
SET status = 'processing',
    started_at = now(),
    attempt = attempt + 1,
    locked_by = $2,
    lock_expires_at = now() + interval '5 minutes',
    last_heartbeat_at = now(),
    lease_version = lease_version + 1
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

**Lease fencing:** All lease renewal, completion, and failure writes must match `id`, `locked_by`, and `lease_version`. This prevents a stale worker from mutating a job after ownership has moved.

**`step_log` guidance:** `step_log` stores step-level metadata only: `{ step, status, startedAt, completedAt, attempt, validatorResult, tokensUsed, errorClass }`. Must NOT contain raw API payloads, filing docs, or full LLM responses. Raw artifacts go to container JSON log. Checkpoints (`agent_job_checkpoints`) store normalized accumulated output only.

### 3.3 `agent_reports` — Published research output history (Discord-first)

```
agent_reports
├── id                  TEXT PRIMARY KEY              -- uuid
├── agent_id            TEXT NOT NULL REFERENCES agent_registry(id)
├── user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
├── job_id              TEXT REFERENCES agent_jobs(id) ON DELETE SET NULL
├── report_type         TEXT NOT NULL                 -- 'research' | 'macro-summary' | 'pre-market-scan' | 'momentum-scan' | 'pattern-check'
├── title               TEXT NOT NULL
├── summary             TEXT
├── report_json         JSONB NOT NULL
├── status              TEXT NOT NULL DEFAULT 'published'       -- 'published' | 'delivery_failed' | 'archived'
├── delivery_channel    TEXT NOT NULL DEFAULT 'discord'         -- 'discord' | 'web'
├── delivered_at        TIMESTAMPTZ
├── delivery_error      TEXT
├── created_at          TIMESTAMPTZ DEFAULT now()
└── INDEXES
    ├── idx_agent_reports_user_status ON (user_id, status, created_at DESC)
    ├── idx_agent_reports_agent ON (agent_id, created_at DESC)
    └── idx_agent_reports_job ON (job_id) WHERE job_id IS NOT NULL
```

**Autonomous ownership rule:** Reports generated from autonomous jobs inherit the same `system-agent-user` value in `user_id`. User-triggered chat/research reports continue using the requesting user's ID.

### 3.4 `agent_conversations` — Chat history (replaces `jarvis_conversations`)

```
agent_conversations
├── id                  TEXT PRIMARY KEY
├── user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
├── agent_id            TEXT NOT NULL REFERENCES agent_registry(id)
├── session_id          TEXT NOT NULL
├── role                TEXT NOT NULL                 -- 'user' | 'assistant' | 'system'
├── content             TEXT NOT NULL
├── channel             TEXT NOT NULL DEFAULT 'web'  -- 'web' | 'discord' | 'api'
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
├── agent_id             TEXT NOT NULL REFERENCES agent_registry(id)
├── mode                 TEXT NOT NULL
├── lane                 TEXT NOT NULL DEFAULT 'background'  -- 'interactive' | 'background'
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

### 3.6 `agent_memory_v2` — Agent-scoped memory

```
agent_memory_v2
├── id                  TEXT PRIMARY KEY
├── user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
├── agent_id            TEXT NOT NULL REFERENCES agent_registry(id)
├── category            TEXT NOT NULL
├── key                 TEXT NOT NULL
├── value               TEXT NOT NULL
├── value_json          JSONB
├── source              TEXT
├── confidence          TEXT
├── created_at          TIMESTAMPTZ DEFAULT now()
├── updated_at          TIMESTAMPTZ DEFAULT now()
├── expires_at          TIMESTAMPTZ
└── CONSTRAINTS / INDEXES
    ├── UNIQUE(user_id, agent_id, category, key)
    └── INDEX agent_memory_v2_user_agent_category_idx ON (user_id, agent_id, category)
```

Legacy `agent_memory` remains in place during rollout. All new `/api/agents/*` code and Docker workers read/write `agent_memory_v2` only. The current repo no longer contains Jarvis code.

### 3.7 `agent_scheduled_runs` — Cron trigger tracking

```
agent_scheduled_runs
├── id                  TEXT PRIMARY KEY
├── agent_id            TEXT NOT NULL REFERENCES agent_registry(id)
├── trigger_type        TEXT NOT NULL              -- 'pre-market-scan' | 'momentum-scan' | 'pattern-check' | 'macro-summary'
├── trading_date        DATE NOT NULL              -- the market date this run covers
├── status              TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
├── job_id              TEXT REFERENCES agent_jobs(id)   -- links to the actual job, if one was created
├── started_at          TIMESTAMPTZ
├── completed_at        TIMESTAMPTZ
├── skip_reason         TEXT                       -- e.g., 'weekend', 'holiday', 'already_completed'
├── created_at          TIMESTAMPTZ DEFAULT now()
└── CONSTRAINTS
    ├── UNIQUE(agent_id, trigger_type, trading_date)
    └── INDEX idx_scheduled_runs_status ON (agent_id, status, trading_date)
```

**Claim semantics:** Scheduled runs are deduped by `UNIQUE(agent_id, trigger_type, trading_date)`. In V1, the Orchestrator scheduler is the only runtime allowed to claim `agent_scheduled_runs` rows and enqueue autonomous jobs. It must first attempt `INSERT ... ON CONFLICT DO NOTHING`. Only the insert winner is allowed to create the corresponding `agent_jobs` row. This table is both observability and the atomic dedupe/claim mechanism. Manual replay is supported by supplying a specific `trading_date` and repeating the same insert-first claim flow.

### 3.8 `agent_step_effects` — Durable idempotency for side effects

```
agent_step_effects
├── id                  TEXT PRIMARY KEY
├── job_id              TEXT NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE
├── step_name           TEXT NOT NULL
├── effect_type         TEXT NOT NULL              -- 'discord_post' | 'report_write' | 'memory_write'
├── idempotency_key     TEXT NOT NULL              -- e.g., 'scan-2026-03-28' or 'report-{job_id}'
├── completed_at        TIMESTAMPTZ DEFAULT now()
└── CONSTRAINTS
    └── UNIQUE(idempotency_key)
```

**Purpose:** `agent_step_effects` dedupes DB-side effects and delivery attempts, but does not make external webhook POSTs transactionally atomic. In V1, report persistence and Discord delivery must use separate idempotency keys (for example, `report-write-{job_id}-{step_name}` and `discord-post-{report_id}`) so retries cannot create duplicate `agent_reports` rows or duplicate successful webhook posts. Discord/webhook publishing uses the report delivery state model in Section 12.

### 3.9 `agent_job_checkpoints` — Resume payload store

```
agent_job_checkpoints
├── id                  TEXT PRIMARY KEY
├── job_id              TEXT NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE
├── step_index          INTEGER NOT NULL
├── step_name           TEXT NOT NULL
├── checkpoint_json     JSONB NOT NULL
├── created_at          TIMESTAMPTZ DEFAULT now()
├── updated_at          TIMESTAMPTZ DEFAULT now()
└── CONSTRAINTS / INDEXES
    ├── UNIQUE(job_id, step_index)
    └── INDEX idx_agent_job_checkpoints_job_step ON (job_id, step_index DESC)
```

Checkpoints store the accumulated normalized output needed for resume. Checkpoints do not store raw API payloads or large artifacts.

---

## 4. Migration Strategy

Current repo reality:

- The next available migration number is `0019`.
- Migrations `0017` and `0018` were already used during earlier Jarvis/Markets cleanup.
- `jarvis_conversations` and `jarvis_request_log` are already gone; there is no backfill path for AEV2.
- Agent tables start empty.
- Legacy `agent_memory` remains in place during rollout, but new agent runtime code reads and writes `agent_memory_v2`.

Implementation requirements:

- The reviewed AEV2 schema migration must create the new agent tables, constraints, indexes, and registry seed rows.
- Autonomous jobs and reports require a deterministic non-null owner row, `system-agent-user`, before scheduling goes live.
- Execution sequencing, rollout gates, and migration order should live in the active `HANDOFF.md` spec, not in this reference document.

---

## 5. Connection Pooling Strategy

Neon Launch plan: size connection usage for the always-on Docker workers plus the Vercel app, and keep steady-state usage well below the Launch connection ceiling.

| Consumer | Connection Type | Count | Notes |
|----------|----------------|-------|-------|
| Vercel app (reads) | HTTP (`neon()`) | 0 pooled | Stateless HTTP, no persistent connection |
| Vercel app (transactions) | WebSocket Pool | 1-3 | Existing `getPoolDb()`, bulk/import only |
| Orchestrator | WebSocket Pool | 1 | `max: 1` |
| Small Cap Trader | WebSocket Pool | 1 | `max: 1` |
| Swing Trader | WebSocket Pool | 1 | `max: 1` |
| Discord Bot | WebSocket Pool | 1 | `max: 1`, for job creation + polling |

**Steady state: 4-7 connections.** Well within the 20-connection Neon Launch limit.

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
**Macro cron:** `setInterval`-based, checks hourly if current hour = `MACRO_CRON_HOUR` (default 6) in `America/New_York`. Runs the macro pipeline if today's summary is missing and persists the result through `agent_reports` with `report_type = 'macro-summary'`.

**Responsibilities:**

1. **Request routing (Research Analyst logic).** Deterministic rules — no LLM call for routing:
   - All standard user chat enters the system as an `orchestrator` `chat` job first
   - Market cap < $200M AND pre-market gain >= 50% → route to `small-cap-trader` workflow
   - Momentum/trending/MDR/parabolic/swing topic → route to `swing-trader` workflow
   - Ambiguous or mixed-domain → keep with `orchestrator`
   - Multi-agent fanout for a single request is deferred to V2
   - Simple factual lookup → handle directly via Massive API/AskEdgar without specialist delegation
   - If a target specialist is `offline` or `degraded`, the Orchestrator does not delegate and instead handles the request in fallback mode while emitting an operational alert

For V1 sprint scope, “route to specialist workflow” means the Orchestrator chooses the specialist path after the Orchestrator job already exists; the API layer is not the source of truth for standard chat routing.

**Canonical Routing Decision Tree (evaluation order):**

1. **Slash command prefix** — if the message starts with `/research `, route to `small-cap-trader`. If `/swing` or `/momentum`, route to `swing-trader`. Slash commands always win.
2. **Explicit agent_id from command context** — if the Discord command or service caller specifies an explicit `agent_id` and no slash command prefix is present, route to that agent.
3. **Data-signal rules** — if the message contains a ticker: market cap < $200M AND pre-market gain >= 50% routes to `small-cap-trader`; momentum/trending/MDR/parabolic/swing topic routes to `swing-trader`.
4. **Simple factual lookup** — handle directly via Massive API/AskEdgar without specialist delegation.
5. **Fallback** — ambiguous or mixed-domain stays with `orchestrator`.

If the target specialist is `offline` or `degraded`, the Orchestrator does not delegate and handles in fallback mode (see Offline Agent Behavior in Section 13).

2. **Memory oversight.** Reads all agents' memory rows. Detects contradictions (e.g., Small Cap is bullish on a ticker that Swing Trader flagged as losing momentum) and injects context when routing.

3. **Cross-agent synthesis.** When specialists complete jobs, the Orchestrator can optionally read the results and inject cross-agent context into future routing decisions. Specialists publish their own reports directly (see Section 12). The Orchestrator only publishes its own outputs (chat responses, macro briefings, system alerts).

4. **Macro cron.** Runs the daily macro headline scraping pipeline that was previously a Vercel cron job. Uses `setInterval` inside the container and posts the final briefing to `#macro-daily`.

**LLM usage:** Only for synthesizing cross-agent summaries, answering user chat queries that require reasoning, and generating the daily briefing.

### 6.2 Small Cap Trader (Short-Selling Specialist)

**Runtime:** Long-running Node.js process in Docker Compose (512M memory limit).
**Poll interval:** 5 seconds on `agent_jobs` where `agent_id = 'small-cap-trader'`.
**Autonomous trigger:** The Orchestrator scheduler creates the `pre-market-scan` job at 7:00 AM ET. The Small Cap Trader does not self-schedule; it polls for the queued job and then checks Massive API for stocks matching: close >= $0.75, pre-market gain >= 50%, market cap < $200M.

**Core identity:** This agent is a professional short seller and research analyst specializing in small-cap dilution plays. Its primary job is to answer two questions about every stock it touches:

1. **Has this company issued shares frequently in the past?**
2. **Can they issue today?**

These two questions, answered with evidence from SEC filings, drive every analysis and recommendation. The agent does not evaluate long-side merit, does not opine on macro factors, and does not recommend specific execution prices. It analyzes the short side of small-cap stocks through the lens of dilution risk — period.

**Key pattern insight:** Companies with dilutionary agendas tend to raise capital on days when the stock is already "in play" — meaning unusual volume, a meaningful pre-market gap, or heightened retail attention creates an opportunity to offer new shares at elevated prices. The pre-market scan is specifically designed to catch stocks that are in play AND simultaneously have the SEC filing infrastructure to dilute today.

**Filing signal hierarchy (what to weigh):**

| Risk Level | Signal | Meaning |
|------------|--------|---------|
| **Highest** | Active ATM program + recent 424B prospectus supplements | Company is currently selling shares into the market |
| **Very High** | Active S-3 shelf with remaining capacity + stock at/above shelf price | Company has loaded gun and price is in range |
| **High** | Recent 8-K announcing new offering or private placement | Active capital raise in progress |
| **Medium** | Expired shelf (S-3 filed but no remaining capacity) | Must re-register before diluting — delay, not safety |
| **Lower** | No active registration | Needs S-1 or new S-3 (4–6 week delay) before a public offering |

**Volume spike + offering correlation:** When a small-cap has unusual pre-market volume AND has a history of filing 424B supplements on high-volume days, the probability of an offering attempt that session is substantially elevated. Flag this pattern explicitly when it matches.

**Voice and output style:** The agent writes research notes like a seasoned short seller, not a chatbot. Its output is direct, data-driven, and confident. It makes a call — either this stock is a short candidate because of dilution risk, or it is not — and it backs the call with evidence from filings. It does not hedge with phrases like "you might consider" or "it could potentially." It writes in the second person ("This company has filed three prospectus supplements in the past 90 days. ATM program active. Float is 12M shares. They will sell into this move."). It treats every report like a piece of research that a trader is going to act on in the next 30 minutes.

**Private state (in `agent_memory_v2`):**
- `scan_param` — threshold values (price floor, gain %, market cap ceiling)
- `watchlist` — tickers currently being tracked with short entry/exit levels
- `fact` — per-ticker dilution history, past offering patterns, historical behavior on high-volume days
- `performance` — accuracy of past dilution calls (predicted offering vs actual outcome)
- `trade_insight` — seeded trade examples from historical short plays (see Section 27)

**Blueprints:** `small-cap:pre-market-scan`, `small-cap:research` (see section 6.4 for full step-by-step breakdowns)

**LLM usage:** Only for dilution analysis and technical analysis steps. Data fetching (Massive API, AskEdgar), indicator calculation (`lib/indicators.ts`), and report assembly are all deterministic code steps — no LLM involved.

### 6.3 Swing Trader

**Runtime:** Long-running Node.js process in Docker Compose (512M memory limit).
**Poll interval:** 5 seconds on `agent_jobs` where `agent_id = 'swing-trader'`.
**Autonomous triggers:**
- The Orchestrator scheduler creates the daily `momentum-scan` job at 7:30 AM ET (30 min after Small Cap's pre-market scan)
- The Orchestrator scheduler creates the daily `pattern-check` job at 4:30 PM ET (after market close)
- The Swing Trader does not self-schedule; it polls for these queued jobs and executes them

**Primary focus:** Trending companies, multi-day runners (MDR), parabolic setups. Identifies stocks going parabolic over multiple days and extracts LONG entry strategies from momentum/parabolic patterns.

**Key insight:** MDR setups "can easily double R for the year." This agent does high-value pattern recognition on momentum moves that play out over 2-10 days, not intraday.

**Private state (in `agent_memory_v2`):**
- `pattern` — historical MDR setups with entry/exit data, chart characteristics, volume profiles (the "pattern database")
- `watchlist` — tickers currently showing MDR characteristics, with trigger levels
- `scan_param` — momentum thresholds (multi-day gain %, volume surge ratio, price range)
- `sentiment` — social/news sentiment snapshots per ticker (deferred data source, initially derived from AskEdgar market-strength narrative)
- `fact` — per-ticker notes, historical parabolic data points
- `performance` — accuracy of past MDR calls (predicted continuation vs actual outcome)

**Blueprints:** `swing:momentum-scan`, `swing:research`, `swing:pattern-check` (see section 6.4 for full step-by-step breakdowns)

**LLM usage:** Only for MDR pattern analysis, similarity scoring against historical patterns, and momentum thesis generation. Data fetching (Massive API, AskEdgar), indicator calculation, and report assembly are all deterministic code steps.

**Example MDR pattern:** UGRO went from $3 to $12 to $24 to $29 over several days. The Swing Trader would:
1. Detect the initial $3 to $12 move (200%+ multi-day gain) in the momentum scan
2. Compare the volume profile, float, and catalyst type against its pattern database
3. If it matches known MDR characteristics, alert via `#swing-setups` with long entry thesis
4. Continue monitoring for continuation or exhaustion signals, alerting on status changes via `#swing-alerts`

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
type LlmLane = 'interactive' | 'background';

// Failure classification for retry/escalation decisions
type FailureClass = 'transient' | 'input-quality' | 'contract' | 'dependency' | 'policy';

// Step-level execution status
type StepStatus = 'queued' | 'running' | 'validated' | 'retrying' | 'blocked' | 'failed' | 'escalated' | 'completed';

interface StepMetadata {
  canRetry: boolean;                    // can this step be retried on failure?
  timeoutMs: number;                    // max execution time for this step
  maxRepairAttempts: number;            // for 'llm' steps: how many repair retries (default 1)
  sideEffect: boolean;                 // does this step write to DB, call webhooks, etc.?
  idempotencyKey?: string;             // for side-effecting steps: prevents double-writes on retry
  lane?: LlmLane;                      // for 'llm' steps: override the agent default lane
}

interface StepProvenance {
  sourceIds: string[];                  // IDs of data sources used (filing IDs, snapshot timestamps, etc.)
  model?: string;                       // LLM model used (only for 'llm' steps)
  promptVersion?: string;              // hash or version of the prompt used
  upstreamStepIds: string[];           // which prior steps fed into this one
  timestamp: string;                   // ISO timestamp of completion
}

interface StepResult<T = unknown> {
  status: StepStatus;
  data: T;                             // normalized payload for next step
  artifacts?: Record<string, unknown>; // raw API responses, filing documents, etc. (for audit)
  metrics: {
    durationMs: number;
    tokensUsed?: number;                // only for 'llm' steps
    attempt: number;
  };
  provenance: StepProvenance;
  validator?: {
    passed: boolean;
    errors?: string[];
    failureClass?: FailureClass;
  };
}

interface BlueprintStep {
  name: string;                         // human-readable label, e.g. 'fetch-snapshot'
  type: StepType;                       // 'code' = deterministic, 'llm' = LLM reasoning
  metadata: StepMetadata;
  inputSchema?: ZodSchema;              // Zod schema for validating input before this step runs
  outputSchema?: ZodSchema;             // Zod schema for validating output after this step runs
  run: (input: StepInput) => Promise<StepResult>;
}

interface StepInput {
  jobInput: unknown;                    // original job input payload
  previousOutput: unknown;              // accumulated output from all prior steps (null for step 1)
  memory: AgentMemoryRow[];             // agent's scoped memory
  context: AgentContext;                // assembled context (trades, macro, etc.)
}

interface Blueprint {
  id: string;                           // e.g. 'small-cap:pre-market-scan'
  description: string;
  steps: BlueprintStep[];
}
```

### Blueprint Runner

The worker's `runBlueprint()` function replaces the old monolithic `JobHandler`. It:

1. Loads the agent's memory and context once (shared across all steps)
2. Iterates through steps sequentially
3. For `code` steps — calls `step.run()` directly, no LLM involved
4. For `llm` steps — calls `step.run()` which internally uses `callLlm()` with `step.metadata.lane ?? config.llmLane`, then tracks tokens
5. Validates input/output via Zod schemas if declared on the step
6. Persists step-level progress metadata to `step_log` JSONB after each step
7. Persists successful normalized accumulated output needed for resume to `agent_job_checkpoints`
8. Retries resume from the latest completed checkpoint
9. Side-effecting steps must call a shared publish helper that implements the Section 12 idempotency/delivery ordering; they must not inline ad hoc report-write + webhook logic.

```typescript
async function runBlueprint(
  blueprint: Blueprint,
  job: AgentJob,
  config: AgentConfig,
  db: DrizzleClient,
  resumeFromStep?: number              // for checkpoint/resume on retry
): Promise<{ result: unknown; totalTokens: number; stepLog: StepLogEntry[] }> {
  const memory = await readMemory(db, job.user_id, config.id);
  const context = await buildAgentContext(db, job.user_id, config.id);
  let previousOutput: unknown = null;
  let totalTokens = 0;
  const stepLog: StepLogEntry[] = [];
  const startStep = resumeFromStep ?? 0;

  if (startStep > 0) {
    const checkpoint = await loadCheckpoint(db, job.id, startStep - 1);
    if (checkpoint) {
      previousOutput = checkpoint.checkpointJson;
    }
  }

  for (let i = startStep; i < blueprint.steps.length; i++) {
    const step = blueprint.steps[i];

    // Update progress note
    await db.update(agentJobs)
      .set({ progressNote: `Step ${i + 1}/${blueprint.steps.length}: ${step.name}` })
      .where(eq(agentJobs.id, job.id));

    // Validate input if schema defined
    if (step.inputSchema) {
      const inputResult = step.inputSchema.safeParse(previousOutput);
      if (!inputResult.success) {
        const entry = { step: step.name, status: 'failed' as const, errorClass: 'input-quality' as const, errors: inputResult.error.issues.map(i => i.message) };
        stepLog.push(entry);
        await persistStepLog(db, job.id, stepLog);
        throw new BlueprintValidationError(step.name, 'input', inputResult.error);
      }
    }

    // Execute step
    const result = await step.run({ jobInput: job.input, previousOutput, memory, context });

    // Validate output if schema defined
    if (step.outputSchema) {
      const outputResult = step.outputSchema.safeParse(result.data);
      if (!outputResult.success) {
        // For LLM steps: attempt one repair retry
        if (step.type === 'llm' && result.metrics.attempt < step.metadata.maxRepairAttempts) {
          // Repair retry: feed validation errors back to LLM
          // 1. Append to the prompt: "Your previous output failed validation: {zodError.issues.map(i => i.message).join('; ')}. Fix these issues and respond with corrected JSON only."
          // 2. Call callLlm() again with the same step config + appended error context
          // 3. Re-validate the new output with the same Zod schema
          // 4. If repair also fails and attempt >= maxRepairAttempts, throw BlueprintValidationError
          // Note: repair attempts do NOT increment job.attempt (that tracks full-step retries, not intra-step repairs)
        }
        const entry = { step: step.name, status: 'failed' as const, errorClass: 'contract' as const, errors: outputResult.error.issues.map(i => i.message) };
        stepLog.push(entry);
        await persistStepLog(db, job.id, stepLog);
        throw new BlueprintValidationError(step.name, 'output', outputResult.error);
      }
    }

    previousOutput = result.data;
    totalTokens += result.metrics.tokensUsed ?? 0;
    stepLog.push({ step: step.name, status: 'completed', durationMs: result.metrics.durationMs, tokensUsed: result.metrics.tokensUsed, attempt: result.metrics.attempt });
    await persistStepLog(db, job.id, stepLog);
    await persistCheckpoint(db, {
      jobId: job.id,
      stepIndex: i,
      stepName: step.name,
      checkpointJson: previousOutput,
    });
  }

  return { result: previousOutput, totalTokens, stepLog };
}
```

`step_log` stores step metadata only. Checkpoints contain normalized accumulated output only — never raw API payloads or large artifacts.

For side-effecting steps, retry/resume must reuse the same idempotency keys so a retried blueprint cannot create duplicate `agent_reports` rows or duplicate successful Discord posts.

### Massive API Endpoints (Polygon-Compatible)

| Operation | Endpoint | Used By |
|-----------|----------|---------|
| Pre-market gainers snapshot | `GET /v2/snapshot/locale/us/markets/stocks/gainers` | `small-cap:pre-market-scan` step 1, `swing:momentum-scan` step 1 |
| Single ticker snapshot | `GET /v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` | `swing:pattern-check` step 2, on-demand research |
| OHLCV candles (daily) | `GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}` | All research blueprints, `swing:momentum-scan` step 2 |
| OHLCV candles (intraday) | `GET /v2/aggs/ticker/{ticker}/range/5/minute/{from}/{to}` | `swing:pattern-check` step 2 |
| Market status | `GET /v1/marketstatus/now` | `isTradingDay` checks in cron/scheduler |

Base URL: configured via `MASSIVE_API_BASE_URL` env var (default: `https://api.polygon.io`). Auth: `apiKey` query parameter using `MASSIVE_API_KEY`.

### Small Cap Trader Blueprints

**Blueprint: `small-cap:pre-market-scan`**

| # | Step | Type | Metadata | What it does |
|---|------|------|----------|-------------|
| 1 | `fetch-snapshot` | `code` | `canRetry: true, timeoutMs: 30000, sideEffect: false` | Calls Massive API snapshot endpoint. Filters: close >= $0.75, pre-market gain >= 50%, market cap < $200M. Returns candidate ticker list. |
| 2 | `fetch-filings` | `code` | `canRetry: true, timeoutMs: 30000, sideEffect: false` | For each candidate, calls AskEdgar API for S-3, prospectus supplements, 8-K filings. Returns structured filing data per ticker. |
| 3 | `analyze-dilution` | `llm` | `canRetry: false, timeoutMs: 60000, maxRepairAttempts: 1, sideEffect: false` | Receives structured filing data + agent's dilution history from memory. Returns dilution risk score and reasoning per ticker. Output must include `confidence`, `evidenceIds`, `insufficientEvidence`. |
| 4 | `fetch-ohlcv` | `code` | `canRetry: true, timeoutMs: 30000, sideEffect: false` | Fetches OHLCV candles from Massive API for each surviving candidate. Calculates SMA, RSI, VWAP, volume profile using `lib/indicators.ts`. Returns structured technical data. |
| 5 | `analyze-technicals` | `llm` | `canRetry: false, timeoutMs: 60000, maxRepairAttempts: 1, sideEffect: false` | Receives technical data + dilution scores. Returns entry/exit levels, support/resistance, confidence rating per ticker. Output must include `confidence`, `evidenceIds`, `insufficientEvidence`. Accumulated input shape: `{ candidates, filings, dilutionScores, technicalData }`. |
| 6 | `assemble-report` | `code` | `canRetry: true, timeoutMs: 15000, sideEffect: true, idempotencyKey: 'scan-{date}'` | Merges all outputs into a validated `agent_reports` row, POSTs the embed to `#small-cap-scans`, and stores `status = 'published'` on success or `status = 'delivery_failed'` if webhook delivery fails. No LLM call — just JSON assembly + delivery. |

**Blueprint: `small-cap:research`** (on-demand user request)

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `fetch-ticker-data` | `code` | Fetches snapshot + OHLCV from Massive API for the requested ticker. |
| 2 | `fetch-filings` | `code` | Fetches relevant SEC filings from AskEdgar: dilution-data, dilution-rating, offerings, offerings-advanced, ai-chart-analysis, news, registrations. If advanced endpoints (`offerings-advanced`, `dilution-data-advanced`) return HTTP 403, fall back to the non-advanced equivalents (`offerings`, `dilution-data`). Mark affected report sections with `insufficientEvidence: true` and `reason: 'advanced endpoint unavailable'`. Runtime availability must be checked per-call, not assumed at config time. |
| 3 | `calculate-indicators` | `code` | Runs SMA, RSI, VWAP, MACD, Bollinger from `lib/indicators.ts`. |
| 4 | `fetch-theme-context` | `code` | Fetches AskEdgar `/v1/market-strength?latest=true` for current themes narrative. Fetches AskEdgar `/v1/screener` with `min_gain_7_day=30&max_market_cap=500000000&limit=20` for recent top-performing small caps. Returns `{ marketThemes, topPerformers }`. |
| 5 | `load-trade-example-context` | `code` | Reads `agent_memory_v2` where `agent_id = 'small-cap-trader'` and `category IN ('pattern', 'trade_insight')`, filtered by similar tickers and/or pattern categories, and returns structured historical examples for the LLM step. |
| 6 | `analyze-and-report` | `llm` | Receives all structured data from steps 1-5. Uses the AskEdgar Research Prompt (Section 25) as output formatting template. Returns structured research report with all rated sections. |
| 7 | `assemble-report` | `code` | Validates report completeness (all required sections present, all ratings valid enum values). Writes report to `agent_reports`. POSTs Discord embed to `#small-cap-research` and stores `published` or `delivery_failed` based on webhook outcome. |

### Swing Trader Blueprints

**Blueprint: `swing:momentum-scan`** (daily autonomous, 7:30 AM EST)

| # | Step | Type | Metadata | What it does |
|---|------|------|----------|-------------|
| 1 | `fetch-momentum-candidates` | `code` | `canRetry: true, timeoutMs: 30000, sideEffect: false` | Calls Massive API snapshot. Filters: multi-day gain >= 50% over last 3-5 days, price >= $1.00, market cap > $500M, average volume >= 500K. Also fetches AskEdgar `/v1/screener` with `min_gain_3_day=50&min_market_cap=500000000`. Returns deduplicated candidate list with price history. |
| 2 | `fetch-context-data` | `code` | `canRetry: true, timeoutMs: 30000, sideEffect: false` | For each candidate: fetches OHLCV candles (last 30 days) from Massive API. Fetches AskEdgar `/v1/ai-chart-analysis` for chart history rating. Fetches AskEdgar `/v1/market-strength?latest=true` for current themes. Returns structured data per ticker. |
| 3 | `calculate-momentum-indicators` | `code` | `canRetry: false, timeoutMs: 5000, sideEffect: false` | Calculates from `lib/indicators.ts`: RSI, EMA(9), EMA(21), VWAP, volume surge ratio (today vs 20-day avg). Flags tickers with RSI > 70 and rising, volume surge > 3x, price above both EMAs. Returns structured technical data. |
| 4 | `load-pattern-history` | `code` | `canRetry: true, timeoutMs: 10000, sideEffect: false` | Reads `agent_memory_v2` entries with `category = 'pattern'` for this agent. Returns historical MDR setups for similarity comparison. |
| 5 | `analyze-mdr-patterns` | `llm` | `canRetry: false, timeoutMs: 60000, maxRepairAttempts: 1, sideEffect: false` | Receives all structured data + historical patterns. For each candidate, scores MDR similarity (0-100) against known patterns. Identifies: continuation probability, expected move magnitude, key levels to watch, catalyst strength. Returns ranked candidates with MDR scores and long entry theses. Output must include `confidence`, `evidenceIds`, `insufficientEvidence`. |
| 6 | `assemble-report` | `code` | `canRetry: true, timeoutMs: 15000, sideEffect: true, idempotencyKey: 'swing-scan-{date}'` | Validates: at least one candidate has MDR score >= 60, all required fields present. Writes report to `agent_reports`. POSTs Discord embed to `#swing-setups`, stores `published` or `delivery_failed`, and proposes memory write candidates for new pattern entries (validated and persisted by this step). |

**Blueprint: `swing:research`** (on-demand user request via `/swing TICKER`)

| # | Step | Type | Metadata | What it does |
|---|------|------|----------|-------------|
| 1 | `fetch-ticker-data` | `code` | `canRetry: true, timeoutMs: 30000, sideEffect: false` | Fetches snapshot + OHLCV (90 days) from Massive API for the requested ticker. |
| 2 | `fetch-filings-and-context` | `code` | `canRetry: true, timeoutMs: 30000, sideEffect: false` | Fetches AskEdgar: `/v1/news`, `/v1/ai-chart-analysis`, `/v1/dilution-rating`, `/v1/market-strength?latest=true`. Fetches recent top performers from screener for theme context. |
| 3 | `calculate-indicators` | `code` | `canRetry: false, timeoutMs: 5000, sideEffect: false` | Runs EMA(9), EMA(21), RSI, VWAP, volume surge ratio from `lib/indicators.ts`. Identifies key support/resistance levels. |
| 4 | `load-pattern-history` | `code` | `canRetry: true, timeoutMs: 10000, sideEffect: false` | Reads historical MDR patterns from `agent_memory_v2`. Filters to patterns with similar float/price/catalyst characteristics. |
| 5 | `analyze-momentum-thesis` | `llm` | `canRetry: false, timeoutMs: 60000, maxRepairAttempts: 1, sideEffect: false` | Receives all data. Produces: MDR similarity score, momentum thesis (bull case for long entry), key levels (entry, stop, targets), risk factors, historical pattern comparisons, continuation probability. Output schema includes `confidence`, `evidenceIds`, `insufficientEvidence`. |
| 6 | `assemble-report` | `code` | `canRetry: true, timeoutMs: 15000, sideEffect: true` | Validates report completeness. Writes to `agent_reports`. POSTs Discord embed to `#swing-setups` and stores `published` or `delivery_failed` based on webhook outcome. |

**Blueprint: `swing:pattern-check`** (daily autonomous, 4:30 PM EST)

| # | Step | Type | Metadata | What it does |
|---|------|------|----------|-------------|
| 1 | `load-watchlist` | `code` | `canRetry: true, timeoutMs: 10000, sideEffect: false` | Reads `agent_memory_v2` entries with `category = 'watchlist'` for this agent. Returns active watchlist tickers with trigger levels and original thesis. If watchlist is empty, short-circuits the blueprint (skips remaining steps). |
| 2 | `fetch-eod-data` | `code` | `canRetry: true, timeoutMs: 30000, sideEffect: false` | For each watchlist ticker: fetches end-of-day snapshot + intraday candles from Massive API. Returns price, volume, high/low, close relative to trigger levels. |
| 3 | `calculate-status-indicators` | `code` | `canRetry: false, timeoutMs: 5000, sideEffect: false` | Calculates RSI, EMA(9), EMA(21), volume surge ratio from `lib/indicators.ts`. Compares close vs entry/stop/target levels from watchlist. Flags each ticker: BREAKOUT (closed above target), EXHAUSTION (RSI > 80 + volume declining + closed below EMA9), CONTINUATION (held above key levels on rising volume), STOPPED (closed below stop level). Returns status per ticker. |
| 4 | `evaluate-patterns` | `llm` | `canRetry: false, timeoutMs: 60000, maxRepairAttempts: 1, sideEffect: false` | Receives watchlist context + EOD data + indicators + original entry theses. For each flagged ticker, evaluates signal quality: confirms breakout strength, exhaustion severity, or continuation momentum. Recommends action per ticker: HOLD, ADD, TRIM, EXIT, or WATCH. Output must include `confidence`, `evidenceIds`, `insufficientEvidence`. |
| 5 | `assemble-alerts` | `code` | `canRetry: true, timeoutMs: 15000, sideEffect: true, idempotencyKey: 'swing-check-{date}'` | For each ticker with actionable status: writes alert to `agent_reports` with `report_type = 'pattern-check'`. POSTs Discord embed to `#swing-alerts` with alert type (BREAKOUT/EXHAUSTION/CONTINUATION/STOPPED), trigger description, current price vs thesis levels, and recommended action. Updates watchlist memory entries (removes EXIT tickers, updates trigger levels for CONTINUATION). Stores `published` or `delivery_failed`. |

### Orchestrator Blueprints

The Orchestrator uses a narrow V1 chat blueprint: every standard chat request starts as an Orchestrator job, then the Orchestrator decides whether to answer directly, invoke a specialist workflow path, or stay in fallback mode if a specialist is unavailable.

**Blueprint: `orchestrator:chat`**

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `classify-and-route` | `code` | Parses the user message, applies the canonical routing decision tree (Section 6.1), checks specialist availability via `agent_registry`. Chooses one of three paths: **(A) Direct Orchestrator handling** — proceeds to step 2. **(B) Specialist handoff** — creates a new `agent_jobs` row for the target specialist with the appropriate `job_type`, and the Orchestrator job completes immediately with `{ routed: true, specialistJobId }`. The API response returns the specialist's `job_id` for the Discord bot to poll via `GET /api/agents/service/chat?job_id=...`. **(C) Orchestrator fallback** — when the specialist is unavailable (`offline`/`degraded`), emits warning/log/alert metadata and proceeds to step 2. The Orchestrator routes but does not aggregate specialist results in V1. |
| 2 | `synthesize-response` | `llm` | Reached when the Orchestrator itself needs to answer the request. Receives the user message + context and returns the final chat response. |

**Step Data Accumulation Convention:** Every blueprint step receives `previousOutput` from the prior step. Convention: each step must spread previous output into its return value (accumulator pattern). Example: step 1 returns `{ candidates: [...] }`, step 2 returns `{ ...previousOutput, filings: [...] }`, and so on. The final step receives the complete accumulated payload. This pattern is enforced by `runBlueprint()` in `blueprint-runner.ts`.

**Blueprint: `orchestrator:macro-summary`** (daily cron)

| # | Step | Type | What it does |
|---|------|------|-------------|
| 1 | `scrape-headlines` | `code` | Fetches macro headlines using existing scrape-lite module. |
| 2 | `fetch-market-snapshot` | `code` | Fetches index/sector/commodity prices from Massive API. |
| 3 | `generate-briefing` | `llm` | Receives headlines + market data. Returns structured daily briefing. Uses `lane: 'background'` instead of the Orchestrator's default interactive lane. |
| 4 | `save-summary` | `code` | Writes a `report_type = 'macro-summary'` row to `agent_reports`. `GET /api/agents/macro-summary/latest` reads the latest published macro report from that table. |

---

## 7. Agent Registration & Lifecycle

### 7.1 Agent Interface

```typescript
interface AgentConfig {
  id: AgentId;
  displayName: string;
  llmLane: LlmLane;          // 'interactive' for Orchestrator chat, 'background' for specialist scans
  modelOverride?: string;    // optional override within the lane
  temperature: number;
  capabilities: JobType[];
  rolePromptPath: string;               // path to per-agent role prompt markdown
  blueprints: Record<string, Blueprint>;  // keyed by 'agent:job-type', e.g. 'small-cap:pre-market-scan'
}

interface WorkerConfig {
  agentId: AgentId;
  pollIntervalMs: number;     // default 5000
  blueprintResolver: (job: AgentJob) => Blueprint;  // picks the right blueprint for a given job
}
```

(Note: `systemPrompt` is removed from per-agent config. The global orchestrator policy prompt is loaded separately by the blueprint runner and prepended to all LLM calls. The `rolePromptPath` points to the per-agent role prompt file, which is the second layer of the three-layer stack. Default lane assignments: Orchestrator = `interactive`, Small Cap = `background`, Swing Trader = `background`. The Orchestrator's macro blueprint overrides its LLM step to `background`.)

The old `JobHandler` is replaced by blueprints. The `blueprintResolver` function maps an incoming job to the correct blueprint based on `job_type` and any input flags (e.g., a `research` job for small-cap resolves to `small-cap:research`).

### 7.2 Explicit Registration

At startup, each agent service:
1. Writes/updates its row in `agent_registry` (status → `'online'`, heartbeat → `now()`)
2. Begins its poll loop (`worker.ts`)
3. Starts a 30-second heartbeat interval (`heartbeat.ts`)
4. If Orchestrator, also starts the scheduler/cron loop (`macro-cron.ts`) that claims `agent_scheduled_runs` rows and enqueues all autonomous jobs in V1

The Orchestrator checks `agent_registry` heartbeats before routing jobs. If an agent has not heartbeated in 3× its heartbeat interval (90 seconds), the Orchestrator marks it `status = 'degraded'` and stops routing new work to it.

### 7.3 Graceful Shutdown

On `SIGTERM` / `SIGINT`:
1. Stop accepting new jobs
2. Finish current job (or mark it back to `queued` if taking too long)
3. Update `agent_registry` status to `'offline'`
4. Close database pool
5. Exit

**`worker.ts` specifics:** On SIGTERM, the worker completes the current blueprint step (does not abort mid-step), does not dequeue or start a new step, then runs steps 3-5 above. If the worker is killed before completing the current step, the job remains `status = 'processing'` with `locked_by` set. The stale-job reaper (Section 10) will detect the expired lease and stale heartbeat after `lock_expires_at` passes and re-queue the job. The worker must also touch `/tmp/healthy` on each heartbeat tick; on shutdown, the file is not refreshed, causing the Docker healthcheck to fail and signal the container as unhealthy.

---

## 8. LLM Integration

### 8.1 Dual-Lane Wrapper

All LLM calls go through `lib/agents/llm-client.ts`. No agent calls any API directly.

`INTERACTIVE_LLM_API_BASE_URL` and `BACKGROUND_LLM_API_BASE_URL` store the provider root ending at `/v1`. `callLlm()` appends `/chat/completions` internally.

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

interface LlmLaneConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

type LlmLane = 'interactive' | 'background';

interface LlmBudgetConfig {
  dailyBudgetCents: number;        // AGENT_DAILY_BUDGET_CENTS, default 500
  monthlyBudgetCents: number;      // AGENT_MONTHLY_BUDGET_CENTS, default 10000
  maxContextTokens: number;        // AGENT_MAX_CONTEXT_TOKENS, default 32000
  maxScanCandidates: number;       // AGENT_MAX_SCAN_CANDIDATES, default 20
  maxPatternHistoryItems: number;  // AGENT_MAX_PATTERN_HISTORY, default 50
  maxRetriesPerStep: number;       // AGENT_MAX_RETRIES_PER_STEP, default 2
}

function getInteractiveLlmConfig(): LlmLaneConfig;
function getBackgroundLlmConfig(): LlmLaneConfig;
function getLlmBudgetConfig(): LlmBudgetConfig;
async function callLlm(
  request: LlmRequest,
  lane: LlmLane,
  overrides?: Partial<LlmLaneConfig>
): Promise<LlmResponse>;
```

### 8.2 Provider Detection (for cost estimation only)

Provider detection is used only for cost estimation — it does **not** control lane assignment. Lane assignment is deterministic and set by the caller passing `lane: 'interactive' | 'background'` to `callLlm()`.

The wrapper detects provider from the base URL for pricing lookups:
- `https://api.groq.com/*` → Groq
- `https://integrate.api.nvidia.com/*` → NVIDIA
- `https://api.deepseek.com/*` → DeepSeek direct
- `http://localhost:*` or `http://127.0.0.1:*` → local model (cost = 0)
- Any other URL → generic OpenAI-compatible API (use model name for pricing lookup, fallback to 0)

All providers use the `/v1/chat/completions` format. Swapping providers per lane is a config change (env vars only).

### 8.3 Local Model Support

For running on the home server without API costs:
- llama.cpp with a 7B quantized model fits in 16GB RAM alongside the Docker agents
- To use a local model for the background lane: set `BACKGROUND_LLM_API_BASE_URL=http://host.docker.internal:8080/v1` and `BACKGROUND_LLM_API_KEY=not-needed`
- To use a local model for everything: set both `INTERACTIVE_LLM_API_BASE_URL` and `BACKGROUND_LLM_API_BASE_URL` to the local endpoint
- Cost tracking records `estimated_cost_cents = 0` for local models

### 8.4 System Prompts

```
lib/agents/prompts/
├── global-policy.md          -- Layer 1: authority, safety, evidence, citation, handoff rules (shared by all agents)
├── orchestrator.md           -- Layer 2: routing context, cross-agent synthesis rules
├── small-cap.md              -- Layer 2: short-selling analyst identity, filing signal hierarchy, dilution risk framework, volume-offering correlation, output tone rules
└── swing-trader.md           -- Layer 2: MDR pattern recognition, momentum analysis, parabolic setup identification
```

### 8.5 Env Var Unification

Full variable names and defaults are in Section 19 "Agent LLM Config — Two-Lane."

Current repo reality: existing Vercel-side LLM code already uses `LLM_*` names. The planned agent runtime uses `INTERACTIVE_LLM_*` and `BACKGROUND_LLM_*`. Do not reintroduce `JARVIS_*` names into new code or docs.

---

## 9. Planned Shared Library: `lib/agents/` (V1 addition)

This library does not exist yet in the current repo. The table below defines the planned V1 structure.

| # | File | Purpose | Key Exports |
|---|------|---------|-------------|
| 1 | `types.ts` | Type definitions | `AgentId`, `JobType`, `JobStatus`, `ReportStatus`, `MemoryCategory`, `StepType`, `FailureClass`, `StepStatus`, `StepMetadata`, `StepProvenance`, `StepResult`, `BlueprintStep`, `Blueprint`, `StepInput`, `AgentJob`, `AgentReport`, `AgentConfig`, `LlmRequest`, `LlmResponse`, `WorkerConfig`, `LlmLaneConfig`, `LlmLane`, `LlmBudgetConfig`, `TokenTrackingEntry` |
| 2 | `db.ts` | DB connection factory for Docker services | `getAgentDb(): DrizzleClient` (single pooled WebSocket connection) |
| 3 | `llm-client.ts` | Dual-lane LLM wrapper with budget enforcement | `getInteractiveLlmConfig()`, `getBackgroundLlmConfig()`, `getLlmBudgetConfig()`, `callLlm(request, lane, overrides?)` |
| 4 | `circuit-breaker.ts` | Per-agent circuit breaker with DB-backed state | `CircuitBreaker` class — 5 failures = open, 60s reset. State persisted to `agent_registry.config` JSONB (not in-memory). |
| 5 | `rate-limit.ts` | Per-user rate limiting | 30 req/hr, DB-backed (queries `agent_request_log`) |
| 6 | `retry.ts` | Backoff calculation | `calculateBackoffMs(attempt)`, `shouldRetry(attempt, maxAttempts)` |
| 7 | `token-tracking.ts` | Cost estimation + request logging | `estimateCostCents(model, inputTokens, outputTokens)`, `logAgentRequest(db, entry)` — includes `lane` |
| 8 | `job-queue.ts` | Job CRUD with FOR UPDATE SKIP LOCKED + lease fencing | `createJob()`, `pollForJob()`, `completeJob()`, `failJob()`, `getJobStatus()`, `renewLease()` |
| 9 | `heartbeat.ts` | Agent heartbeat updater | `startHeartbeat(db, agentId, intervalMs)` |
| 10 | `memory.ts` | Scoped memory CRUD | `readMemory()`, `writeMemory()`, `upsertMemory()` — all read/write `agent_memory_v2`, filtered by `agent_id` |
| 11 | `context.ts` | Context assembly for LLM calls | `buildAgentContext(db, userId, agentId)` — trades, macro, memory |
| 12 | `prompts.ts` | System prompts per agent — loads from three-layer stack | `getSystemPrompt(agentId, mode)`, loads from `prompts/*.md` |
| 13 | `config.ts` | Agent config registry | `AGENT_CONFIGS: Record<AgentId, AgentConfig>` using the `AgentConfig` interface defined below, plus blueprint wiring and resolver |
| 14 | `blueprint-runner.ts` | Blueprint execution engine with validation hooks, checkpoint/resume, step-log persistence | `runBlueprint(blueprint, job, config, db)` — iterates steps, tracks tokens, stores resume payloads in `agent_job_checkpoints`, handles step failures |
| 15 | `worker.ts` | Poll loop runtime | `startWorker(config: WorkerConfig): Promise<void>` — resolves blueprint, calls `runBlueprint()`, graceful shutdown. Also runs the stale-job reaper (every 5 minutes, Orchestrator process only) |
| 16 | `macro-cron.ts` | Macro headline cron | `startMacroCron(): void` — setInterval, checks hour in `America/New_York` |
| 17 | `scrape-lite.ts` | Macro headline scraper reused from Jarvis | Existing scrape-lite helpers copied into `lib/agents/` for the Orchestrator macro blueprint |
| 18 | `admin.ts` | Admin utilities | `requireAgentAdmin()`, `requireServiceAuth()` — validates `x-agent-admin-key` and service-key auth |
| 19 | `discord-embed.ts` | Embed builders per report type | `buildScanEmbed()`, `buildResearchEmbed()`, `buildSwingSetupEmbed()`, `buildSwingAlertEmbed()`, `buildSystemEmbed()` |
| 20 | `discord-delivery.ts` | Webhook POST utility | `postToDiscord(webhookUrl, embed)` |

**AskEdgar caching strategy:** Agent code caches AskEdgar responses per ticker+endpoint with a 1-hour TTL, stored in `agent_memory_v2` with `category = 'fact'` and a composite key like `askedgar:{endpoint}:{ticker}`. The `fetch-filings` code step checks memory first and only calls AskEdgar if the cached value is absent or expired. This makes the cache DB-backed and cross-restart-safe.

### Key Type Definitions

```typescript
export type AgentId = 'orchestrator' | 'small-cap-trader' | 'swing-trader';
export type JobType = 'chat' | 'research' | 'macro-summary' | 'pre-market-scan' | 'momentum-scan' | 'pattern-check';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type ReportStatus = 'published' | 'delivery_failed' | 'archived';
export type StepType = 'code' | 'llm';
export type LlmLane = 'interactive' | 'background';
export type FailureClass = 'transient' | 'input-quality' | 'contract' | 'dependency' | 'policy';
export type StepStatus = 'queued' | 'running' | 'validated' | 'retrying' | 'blocked' | 'failed' | 'escalated' | 'completed';
export type MemoryCategory = 'fact' | 'thesis' | 'watchlist' | 'scan_param' | 'performance'
  | 'trade_insight' | 'user_preference' | 'strategy_note' | 'macro_fact'
  | 'pattern' | 'sentiment';

export interface StepLogEntry { step: string; status: 'pending' | 'running' | 'completed' | 'failed'; startedAt: string; completedAt?: string; attempt: number; validatorResult?: 'pass' | 'fail'; tokensUsed?: number; errorClass?: string; }
export interface AgentMemoryRow { id: string; agent_id: AgentId; user_id: string; category: MemoryCategory; key: string; value: unknown; confidence?: number; source_job_id?: string; created_at: string; updated_at: string; expires_at?: string; }
export interface AgentContext { recentTrades: unknown[]; macroSummary: unknown | null; memory: AgentMemoryRow[]; conversationHistory: unknown[]; }
export type DrizzleClient = ReturnType<typeof import('drizzle-orm/neon-serverless').drizzle>;
export class BlueprintValidationError extends Error { constructor(public stepName: string, public location: 'input' | 'output', public zodError: unknown) { super(`Validation failed at ${stepName} (${location})`); } }
export class BudgetExceededError extends Error { constructor(public agentId: AgentId, public limitType: 'daily' | 'monthly') { super(`${limitType} budget exceeded for ${agentId}`); } }

export interface AgentConfig {
  id: AgentId;
  displayName: string;
  llmLane: 'interactive' | 'background';
  modelOverride?: string;
  temperature?: number;
  capabilities: string[];
  rolePromptPath: string;
  blueprints: Record<string, Blueprint>;
  blueprintResolver: (job: AgentJob) => Blueprint;  // derives from blueprints, e.g. (job) => blueprints[job.job_type]
}

// Registration example:
// AGENT_CONFIGS['orchestrator'] = {
//   id: 'orchestrator',
//   displayName: 'Orchestrator',
//   llmLane: 'interactive',
//   temperature: 0.3,
//   capabilities: ['chat', 'macro-summary'],
//   rolePromptPath: 'lib/agents/prompts/orchestrator.md',
//   blueprints: {
//     'orchestrator:chat': orchestratorChatBlueprint,
//     'orchestrator:macro-summary': macroSummaryBlueprint,
//   },
// };
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

The stale-job reaper only requeues jobs whose lease is expired **and** whose heartbeat is stale. `completeJob()`, `failJob()`, and `renewLease()` must match `locked_by` and `lease_version` in addition to `id`.

### Failure Classification

Every step failure must be classified before the retry decision:

| Class | Description | Retry? | Example |
|-------|-------------|--------|---------|
| `transient` | Temporary external failure | Yes (auto) | API timeout, 429 rate limit, DB lock contention |
| `input-quality` | Upstream data is missing or stale | No | Empty candidate list, stale filing data |
| `contract` | LLM output does not match schema | Once (repair) | Missing required field, invalid enum value |
| `dependency` | External service is down | Yes (with backoff) | AskEdgar API returning 500, Massive API unreachable |
| `policy` | Output violates safety or evidence rules | No (escalate) | Unsupported market claim without citation |

### Circuit Breaker

Per-agent, DB-backed state (stored in `agent_registry.config -> 'circuitBreaker'` JSONB):
- **Threshold:** 5 consecutive failures → circuit opens
- **Reset:** 60 seconds after opening
- **When open:** Jobs are immediately failed without attempting LLM call

Workers read/write circuit breaker state to `agent_registry.config` on each LLM call result. This allows the admin stats endpoint on Vercel to observe actual breaker state since it queries `agent_registry` directly — no worker memory introspection needed.

### Blueprint Resume

When a job fails and is retried, the blueprint runner loads the latest normalized accumulated output from `agent_job_checkpoints` and resumes from the failed step rather than replaying the entire blueprint. `step_log` remains metadata-only. This saves API calls and LLM tokens and prevents a stale worker from completing a job after ownership has already moved.

### Stale Job Reaper

The reaper runs every 5 minutes in the Orchestrator process. It only touches jobs with BOTH an expired lease AND a stale heartbeat older than 2 minutes. Workers renew their lease every 60 seconds during long-running steps.

```sql
UPDATE agent_jobs
SET status = 'queued',
    started_at = NULL,
    locked_by = NULL,
    lock_expires_at = NULL,
    last_heartbeat_at = NULL
WHERE status = 'processing'
  AND lock_expires_at < now()
  AND last_heartbeat_at < now() - interval '2 minutes';
```

```sql
UPDATE agent_jobs
SET lock_expires_at = now() + interval '5 minutes',
    last_heartbeat_at = now()
WHERE id = $1 AND locked_by = $2 AND lease_version = $3;
```

### Market Session Gate

Autonomous triggers use session-aware logic, not a simple “is market open?” check.

```typescript
interface MarketSessionCheck {
  isTradingDay: boolean;     // false on weekends + market holidays
  isPreMarket: boolean;      // 4:00 AM – 9:30 AM ET
  isPostMarket: boolean;     // 4:00 PM – 8:00 PM ET
  isMarketOpen: boolean;     // 9:30 AM – 4:00 PM ET
}
```

Trigger gates:
- Pre-market scans (Small Cap 7:00 AM, Swing 7:30 AM): require `isTradingDay && isPreMarket`
- Post-market checks (Swing 4:30 PM): require `isTradingDay && isPostMarket`
- Macro cron (6:00 AM): require `isTradingDay`
- `isTradingDay` via Massive API `/v1/marketstatus/now`. Session windows in Eastern Time.

---

## 11. Token Observability & Budget

### Per-Request Logging

Every LLM call writes to `agent_request_log` with:
- `agent_id` — which agent made the call
- `model_used` — actual model string (e.g., `llama-3.3-70b-versatile`)
- `lane` — which config lane was used: `'interactive'` or `'background'`
- `estimated_cost_cents` — calculated from pricing table

### Cost Estimation

```typescript
const MODEL_PRICING: Record<string, { inputPer1kCents: number; outputPer1kCents: number }> = {
  'llama-3.3-70b-versatile': { inputPer1kCents: 0.059, outputPer1kCents: 0.079 },
  'nvidia/llama-3.3-70b-instruct': { inputPer1kCents: 0.040, outputPer1kCents: 0.040 },
  'deepseek-chat': { inputPer1kCents: 0.027, outputPer1kCents: 0.110 },
  'local/*': { inputPer1kCents: 0, outputPer1kCents: 0 },
};
```

### Budget Enforcement

Hard limits are checked by `callLlm()` before every LLM call. Budget is per-agent — each agent checks its own spend against `agent_request_log`.

Full variable names and defaults are in Section 19 "Agent Budget Limits." Below are the enforcement rules:

- **Daily spend cap (`AGENT_DAILY_BUDGET_CENTS`, default `500`):** `BudgetExceededError` thrown, step fails with `failureClass: 'policy'`, no retry. Warning posted to `#agent-system`.
- **Monthly spend cap (`AGENT_MONTHLY_BUDGET_CENTS`, default `10000`):** Same as daily — hard stop + Discord alert.
- **Max context tokens (`AGENT_MAX_CONTEXT_TOKENS`, default `32000`):** Input is truncated to fit. Warning logged.
- **Max scan candidates (`AGENT_MAX_SCAN_CANDIDATES`, default `20`):** Code step slices candidate list before the LLM step.
- **Max AskEdgar calls per scan (`AGENT_MAX_ASKEDGAR_CALLS_PER_SCAN`, default `60`):** If a scan generates more than 60 AskEdgar calls, truncate the candidate list. Enforced in the `fetch-filings` code step.
- **Max pattern history items (`AGENT_MAX_PATTERN_HISTORY`, default `50`):** Code step slices pattern history before the LLM step.
- **Max retries per LLM step (`AGENT_MAX_RETRIES_PER_STEP`, default `2`):** After N repair attempts, step fails with `failureClass: 'contract'`.

**Observability on top of enforcement:** dashboard/admin warning at 80% of daily/monthly cap, critical at 100%, plus Discord alerts to `#agent-system`.

### Admin Stats Endpoint

`GET /api/agents/admin/stats` returns:

```json
{
  "circuitBreakers": { "orchestrator": { "status": "closed", "consecutiveFailures": 0, "lastFailureAt": null }, ... },
  "today": {
    "totalRequests": 42,
    "totalTokens": 128000,
    "estimatedCostCents": 180,
    "successRate": 0.95,
    "avgDurationMs": 2300,
    "validationFailureRate": 0.03,
    "retryRate": 0.07,
    "byLane": { "interactive": { ... }, "background": { ... } },
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
  "delivery": { "publishedToday": 8, "deliveryFailures": 1 },
  "memory": { "total": 156, "byCategory": { "fact": 89, "thesis": 12, ... } },
  "macroSummaries": { "latestGeneratedAt": "..." }
}
```

Circuit breaker state is read from `agent_registry.config -> 'circuitBreaker'` — DB-backed, observable from any Vercel route. No worker memory introspection required.

V1 does **not** ship an `AgentStats.tsx` UI. Cost/performance tracking comes from this admin endpoint, `agent_request_log`, `agent_jobs.step_log`, `agent_job_checkpoints`, `agent_registry`, and Discord `#agent-system` alerts.

---

## 12. Discord-First Publish Mode (V1)

### Flow

1. Check for the report-write idempotency marker for the current job/step.
2. If the marker does not exist, write or upsert the validated payload into `agent_reports`.
3. Commit the DB transaction for the report write before any external webhook call.
4. Check for the delivery-attempt idempotency marker for that report.
5. If a successful delivery marker does not already exist, attempt webhook delivery to the target channel (`#small-cap-scans`, `#small-cap-research`, `#swing-setups`, `#swing-alerts`, or `#macro-daily`).
6. On success, set `status = 'published'`, set `delivered_at = now()`, and persist the successful delivery marker.
7. On failure, set `status = 'delivery_failed'`, store `delivery_error`, and trigger a system alert in `#agent-system`.
8. Manual redelivery reads stored `report_json` by `report_id` and retries only the delivery portion of the publish path.

`agent_step_effects` supports separate dedupe markers for report writes and delivery attempts, but it cannot make external Discord posting atomic. The required V1 ordering is: persist report first, then attempt delivery, then persist final delivery state.

### Status Transitions

```
published       → archived
delivery_failed → archived
```

### Channel Layout

| Channel | Method | Posts from | Content |
|---------|--------|-----------|---------|
| `#orchestrator` | Bot (listener) + Webhook (responses) | Orchestrator | Two-way chat |
| `#small-cap-scans` | Webhook | Small Cap Trader | Pre-market scan results |
| `#small-cap-research` | Webhook | Small Cap Trader | On-demand research reports |
| `#swing-setups` | Webhook | Swing Trader | Daily momentum scan results, MDR candidates |
| `#swing-alerts` | Webhook | Swing Trader | Real-time parabolic setup alerts |
| `#macro-daily` | Webhook | Orchestrator | Daily macro briefing |
| `#agent-system` | Webhook | Orchestrator | Health alerts, budget warnings, errors |

### Discord Embed Schemas

All embeds use emerald-500 (`0x10B981`) as base color.

- **Small Cap Scan embed:** Ticker, pre-market gain %, price, market cap, dilution risk rating (color-coded), filing summary, technical levels, confidence, timestamp.
- **Small Cap Research embed:** All fields from `ResearchReportSchema` (Section 25). Ticker, news/theme ratings, catalyst list, chart history, dilution, offering frequency/ability, cash need, overall offering risk, confidence, evidence count.
- **Swing Setup embed:** Ticker, multi-day gain %, current price, MDR similarity score (color-coded), volume surge ratio, key levels (entry/stop/targets), catalyst summary, pattern comparisons, confidence.
- **Swing Alert embed:** Ticker, alert type (BREAKOUT/EXHAUSTION/CONTINUATION), trigger description, current price vs thesis levels, recommended action context.
- **System Alert embed:** Type, severity color, details, suggested action.

### Delivery Recovery (V1)

1. Detection: `#agent-system` webhook receives an alert when delivery fails.
2. Diagnosis: Check `agent_reports.delivery_error` for the failure reason.
3. Manual retry: `POST /api/agents/admin/redeliver` with `{ report_id }`. Reads stored `report_json`, re-POSTs to webhook, updates status.
4. Automated retry: Deferred to V2.

### UI Integration

- V1 has no in-app agent UI. All agent communication is Discord-only.
- Report history is persisted in `agent_reports` and queryable via `/api/agents/reports` if a web UI is added later.
- Cost/performance tracking lives in `/api/agents/admin/stats` and `#agent-system` Discord alerts.

---

## 13. API Surface

Current repo reality: `/api/jarvis/*` routes and the Jarvis UI are already gone. V1 adds `/api/agents/*` routes; there is no transition-period SSE migration.

### New Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/agents/service/chat` | POST | Canonical V1 Discord-bot/service chat entrypoint. Creates one `orchestrator` `chat` job. |
| `/api/agents/service/chat` | GET | Discord-bot/service polling endpoint for chat jobs. |
| `/api/agents/reports` | GET | List report history `?status=published|delivery_failed|archived` |
| `/api/agents/reports/[id]` | GET | Get single report |
| `/api/agents/research` | POST | Create direct specialist research job |
| `/api/agents/research` | GET | List past research reports |
| `/api/agents/admin/stats` | GET | Admin ops data: cost, latency, retries, validation failures, health |
| `/api/agents/admin/memory` | GET/DELETE | Admin memory management |
| `/api/agents/admin/redeliver` | POST | Manual report redelivery |
| `/api/agents/macro-summary/latest` | GET | Latest macro summary |

### Contracts

#### `POST /api/agents/chat` / `GET /api/agents/chat`

V1 does not ship user-facing `/api/agents/chat` routes. All agent chat flows through Discord via `POST /api/agents/service/chat`.

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
  "discord_user_id": "discord-user-id-1",
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

This route is the canonical V1 chat entrypoint. It creates one Orchestrator chat job using service auth; there is no user-facing `/api/agents/chat` route in V1.

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
- `{ status: 'completed', job_id, agent_id, result: { routed: true, specialistJobId: 'job_456' } }`
- `{ status: 'failed', job_id, agent_id, error: { message, failureClass? } }`

#### `GET /api/agents/reports`

**Query params**

- `status?`: `published | delivery_failed | archived`
- `agent_id?`: `orchestrator | small-cap-trader | swing-trader`
- `limit?`: integer

**Success response**

```json
{
  "reports": [
    {
      "id": "report_123",
      "agent_id": "small-cap-trader",
      "report_type": "research",
      "status": "published",
      "title": "BMNR research",
      "created_at": "2026-03-28T12:00:00.000Z"
    }
  ]
}
```

#### `GET /api/agents/reports/[id]`

**Success response**

```json
{
  "report": {
    "id": "report_123",
    "agent_id": "small-cap-trader",
    "report_type": "research",
    "status": "published",
    "report_json": {}
  }
}
```

#### `POST /api/agents/research`

Programmatic convenience wrapper for ticker-triggered analysis from UI surfaces.

**Request body**

```json
{
  "ticker": "BMNR",
  "agent_id": "small-cap-trader"
}
```

**Success response**

```json
{
  "job_id": "job_123",
  "agent_id": "small-cap-trader",
  "job_type": "research"
}
```

#### `GET /api/agents/research`

**Success response**

```json
{
  "reports": [
    {
      "id": "report_123",
      "agent_id": "small-cap-trader",
      "report_type": "research",
      "ticker": "BMNR"
    }
  ]
}
```

#### `GET /api/agents/admin/memory`

**Query params**

- `user_id?`
- `agent_id?`
- `category?`

**Success response**

```json
{
  "memory": [
    {
      "id": "mem_123",
      "user_id": "user_123",
      "agent_id": "swing-trader",
      "category": "pattern",
      "key": "ugro_pattern"
    }
  ]
}
```

#### `DELETE /api/agents/admin/memory`

**Request body**

```json
{
  "id": "mem_123"
}
```

**Success response**

```json
{
  "deleted": true
}
```

#### `POST /api/agents/admin/redeliver`

**Request body**

```json
{
  "report_id": "report_123"
}
```

**Success response**

```json
{
  "report_id": "report_123",
  "status": "published"
}
```

`status` is always one of `'published' | 'delivery_failed'`.

#### `GET /api/agents/macro-summary/latest`

**Success response**

```json
{
  "summary": {
    "generated_at": "2026-03-28T10:00:00.000Z",
    "content": {}
  }
}
```

### Orchestrator Routing Logic

The following routing logic runs inside the Orchestrator after the `orchestrator` `chat` job has already been created.

```typescript
function routeToAgent(
  message: string,
  explicitAgentId?: AgentId
): AgentId {
  // 1. Slash command prefix — always wins
  if (message.startsWith('/research ')) return 'small-cap-trader';
  if (message.startsWith('/swing') || message.startsWith('/momentum')) return 'swing-trader';

  // 2. Explicit agent_id (from Discord command context, not UI)
  if (explicitAgentId) return explicitAgentId;

  // 3. Data-signal rules (requires async ticker lookup — simplified here)
  // Full implementation: extract ticker from message, fetch snapshot from Massive API,
  // if market cap < $200M AND pre-market gain >= 50% → 'small-cap-trader'
  // if momentum/trending/MDR/parabolic topic detected → 'swing-trader'

  // 4. Simple factual lookup → Orchestrator handles directly
  // 5. Fallback → Orchestrator
  return 'orchestrator';
}
```

This function does not change the API-layer job-creation rule: standard chat still enters as one Orchestrator job first.

Ambiguous or mixed-domain requests stay with `orchestrator`. V1 never splits one request into multiple sub-jobs.

### Routing Precedence

**Routing logic:** See Section 6.1 "Canonical Routing Decision Tree" for the authoritative 5-tier routing precedence. The Orchestrator executes this logic inside the `classify-and-route` blueprint step.

### Mandatory Ownership Checks

All user-facing read routes must scope queries by the authenticated `user_id`:

- `GET /api/agents/reports` — filter by `user_id`
- `GET /api/agents/reports/[id]` — verify `agent_reports.user_id = authenticated user`

System-owned autonomous reports (`user_id = 'system-agent-user'`) are excluded from user-facing report history routes in V1 unless a future UI explicitly adds a separate system-report view.

Admin routes (`/api/agents/admin/*`) use `requireAgentAdmin()` instead.

### Canonical V1 Job Taxonomy

The canonical V1 `job_type` set is:

- `chat`
- `research`
- `macro-summary`
- `pre-market-scan`
- `momentum-scan`
- `pattern-check`

Swing on-demand analysis uses `job_type = 'research'` with `agent_id = 'swing-trader'`.

### Route Implementation Conventions

- `requireUser()` for user-facing routes (returns 401 on failure)
- `requireServiceAuth()` for `/api/agents/service/*` routes used by the Discord bot
- `requireAgentAdmin()` for admin routes (validates `x-agent-admin-key` header)
- `getDb()` / `dbUnavailable()` for database access
- Input validation via Zod schemas with `parseAndValidate()` where applicable
- Standard error responses: `{ error: string }` with appropriate HTTP status codes

**`requireServiceAuth()` return type:** Returns `{ user: { id: string, email: string, name: string, picture: string | null } }` — the same shape as `requireUser()`. It validates `x-agent-service-key`, reads `discord_user_id` from the service request body, resolves the Nexus user from the hardcoded Discord-to-Nexus mapping in `lib/agents/admin.ts`, and returns the mapped Nexus user. If the service key is invalid, returns 401. If `discord_user_id` is missing, returns 400 with `{ error: 'discord_user_id is required' }`. If the Discord user ID cannot be mapped to a Nexus user, returns 403 with `{ error: 'Unknown Discord user' }`.

Service auth is limited to `/api/agents/service/*` routes only. Admin routes remain admin-key protected. The Discord bot must not use admin routes.

### Endpoint Role Clarification

| Route | Role | Relationship to Chat |
|-------|------|---------------------|
| `POST /api/agents/service/chat` | Primary chat entrypoint for Discord bot | Creates one Orchestrator chat job using service auth |
| `POST /api/agents/research` | Convenience wrapper | Creates a direct specialist `research` job for `small-cap-trader` or `swing-trader`, skipping standard chat |

These endpoints exist for the Discord bot and programmatic callers. They do not change the rule that normal chat begins as an Orchestrator job.

### Offline Agent Behavior

If the Orchestrator selects `small-cap-trader` or `swing-trader` but that specialist has `status = 'degraded'` or `status = 'offline'` in `agent_registry`:

- the Orchestrator does **not** delegate work to that specialist
- the Orchestrator handles the request in fallback mode
- the system writes a server log entry describing the fallback
- the system posts an operational alert to `#agent-system`
- the completed response may include a non-fatal warning such as:
  - `warning: 'Swing Trader offline; Orchestrator handled this request in fallback mode.'`

This keeps V1 responsive without queueing specialist work for a worker that is known to be unavailable.

For direct specialist research created through `POST /api/agents/research`, the route should reject unavailable agents explicitly rather than silently queueing the job.

**V1 scope decision:** All routes create exactly one job targeting exactly one agent. Multi-agent fanout is deferred to V2. The routing function returns a single `AgentId`, not an array.

---

## 14. Current Repo Reality

The current repo is already past the old Jarvis/Markets cleanup phase:

- The app is already a 6-tab shell with no Jarvis or Markets tab.
- `/api/jarvis/*` routes are already removed.
- `lib/jarvis/*` is already removed.
- Shared AskEdgar and research logic already lives in `lib/askedgar.ts`, `lib/research.ts`, and `lib/llm-client.ts`.
- `services/docker-compose.yml` is still a minimal placeholder and the agent runtime remains planned work.

AEV2 should not reintroduce Jarvis cleanup tasks into the sprint plan. New work starts from the current repo state above.

---

## 15. Docker Infrastructure

### Single Shared Dockerfile

```dockerfile
# services/agent.Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --production && npm install tsx
COPY lib/ ./lib/
COPY services/agent-entrypoint.ts ./services/
CMD ["npx", "tsx", "services/agent-entrypoint.ts"]
```

Only copies `lib/` and the entrypoint — NOT the Next.js app or components. `tsx` is installed explicitly in the Dockerfile rather than added to `package.json` production dependencies, since it is only needed by the Docker agent runtime, not the Next.js app on Vercel.

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
  # --- Existing service (keep from current compose) ---

  discord-bot:
    build:
      context: ./discord-bot
    environment:
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID}
      - DISCORD_GUILD_ID=${DISCORD_GUILD_ID}
      - DATABASE_URL=${DATABASE_URL}
      - AGENT_SERVICE_KEY=${AGENT_SERVICE_KEY}
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"

  # --- Agent services ---

  orchestrator:
    build:
      context: ..
      dockerfile: services/agent.Dockerfile
    environment:
      - AGENT_ID=orchestrator
      - DATABASE_URL=${DATABASE_URL}
      - INTERACTIVE_LLM_API_KEY=${INTERACTIVE_LLM_API_KEY}
      - INTERACTIVE_LLM_API_BASE_URL=${INTERACTIVE_LLM_API_BASE_URL}
      - INTERACTIVE_LLM_MODEL=${INTERACTIVE_LLM_MODEL:-llama-3.3-70b-versatile}
      - INTERACTIVE_LLM_TIMEOUT_MS=${INTERACTIVE_LLM_TIMEOUT_MS:-30000}
      - BACKGROUND_LLM_API_KEY=${BACKGROUND_LLM_API_KEY}
      - BACKGROUND_LLM_API_BASE_URL=${BACKGROUND_LLM_API_BASE_URL}
      - BACKGROUND_LLM_MODEL=${BACKGROUND_LLM_MODEL:-llama-3.3-70b-versatile}
      - BACKGROUND_LLM_TIMEOUT_MS=${BACKGROUND_LLM_TIMEOUT_MS:-60000}
      - AGENT_DAILY_BUDGET_CENTS=${AGENT_DAILY_BUDGET_CENTS:-500}
      - AGENT_MONTHLY_BUDGET_CENTS=${AGENT_MONTHLY_BUDGET_CENTS:-10000}
      - AGENT_MAX_CONTEXT_TOKENS=${AGENT_MAX_CONTEXT_TOKENS:-32000}
      - AGENT_MAX_SCAN_CANDIDATES=${AGENT_MAX_SCAN_CANDIDATES:-20}
      - AGENT_MAX_PATTERN_HISTORY=${AGENT_MAX_PATTERN_HISTORY:-50}
      - AGENT_MAX_RETRIES_PER_STEP=${AGENT_MAX_RETRIES_PER_STEP:-2}
      - AGENT_POLL_INTERVAL_MS=${AGENT_POLL_INTERVAL_MS:-5000}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
      - MASSIVE_API_KEY=${MASSIVE_API_KEY}
      - DISCORD_WEBHOOK_MACRO_DAILY=${DISCORD_WEBHOOK_MACRO_DAILY}
      - DISCORD_WEBHOOK_SYSTEM=${DISCORD_WEBHOOK_SYSTEM}
      - MACRO_CRON_HOUR=6
      - TZ=America/New_York
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"
    healthcheck:
      test: ["CMD-SHELL", "test -f /tmp/healthy && find /tmp/healthy -mmin -2 >/dev/null 2>&1"]
      interval: 30s
      timeout: 10s
      retries: 3

  small-cap-trader:
    build:
      context: ..
      dockerfile: services/agent.Dockerfile
    environment:
      - AGENT_ID=small-cap-trader
      - DATABASE_URL=${DATABASE_URL}
      - INTERACTIVE_LLM_API_KEY=${INTERACTIVE_LLM_API_KEY}
      - INTERACTIVE_LLM_API_BASE_URL=${INTERACTIVE_LLM_API_BASE_URL}
      - INTERACTIVE_LLM_MODEL=${INTERACTIVE_LLM_MODEL:-llama-3.3-70b-versatile}
      - INTERACTIVE_LLM_TIMEOUT_MS=${INTERACTIVE_LLM_TIMEOUT_MS:-30000}
      - BACKGROUND_LLM_API_KEY=${BACKGROUND_LLM_API_KEY}
      - BACKGROUND_LLM_API_BASE_URL=${BACKGROUND_LLM_API_BASE_URL}
      - BACKGROUND_LLM_MODEL=${BACKGROUND_LLM_MODEL:-llama-3.3-70b-versatile}
      - BACKGROUND_LLM_TIMEOUT_MS=${BACKGROUND_LLM_TIMEOUT_MS:-60000}
      - AGENT_DAILY_BUDGET_CENTS=${AGENT_DAILY_BUDGET_CENTS:-500}
      - AGENT_MONTHLY_BUDGET_CENTS=${AGENT_MONTHLY_BUDGET_CENTS:-10000}
      - AGENT_MAX_CONTEXT_TOKENS=${AGENT_MAX_CONTEXT_TOKENS:-32000}
      - AGENT_MAX_SCAN_CANDIDATES=${AGENT_MAX_SCAN_CANDIDATES:-20}
      - AGENT_MAX_PATTERN_HISTORY=${AGENT_MAX_PATTERN_HISTORY:-50}
      - AGENT_MAX_RETRIES_PER_STEP=${AGENT_MAX_RETRIES_PER_STEP:-2}
      - AGENT_POLL_INTERVAL_MS=${AGENT_POLL_INTERVAL_MS:-5000}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
      - MASSIVE_API_KEY=${MASSIVE_API_KEY}
      - DISCORD_WEBHOOK_SCANS=${DISCORD_WEBHOOK_SCANS}
      - DISCORD_WEBHOOK_RESEARCH=${DISCORD_WEBHOOK_RESEARCH}
      - TZ=America/New_York
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"
    healthcheck:
      test: ["CMD-SHELL", "test -f /tmp/healthy && find /tmp/healthy -mmin -2 >/dev/null 2>&1"]
      interval: 30s
      timeout: 10s
      retries: 3

  swing-trader:
    build:
      context: ..
      dockerfile: services/agent.Dockerfile
    environment:
      - AGENT_ID=swing-trader
      - DATABASE_URL=${DATABASE_URL}
      - INTERACTIVE_LLM_API_KEY=${INTERACTIVE_LLM_API_KEY}
      - INTERACTIVE_LLM_API_BASE_URL=${INTERACTIVE_LLM_API_BASE_URL}
      - INTERACTIVE_LLM_MODEL=${INTERACTIVE_LLM_MODEL:-llama-3.3-70b-versatile}
      - INTERACTIVE_LLM_TIMEOUT_MS=${INTERACTIVE_LLM_TIMEOUT_MS:-30000}
      - BACKGROUND_LLM_API_KEY=${BACKGROUND_LLM_API_KEY}
      - BACKGROUND_LLM_API_BASE_URL=${BACKGROUND_LLM_API_BASE_URL}
      - BACKGROUND_LLM_MODEL=${BACKGROUND_LLM_MODEL:-llama-3.3-70b-versatile}
      - BACKGROUND_LLM_TIMEOUT_MS=${BACKGROUND_LLM_TIMEOUT_MS:-60000}
      - AGENT_DAILY_BUDGET_CENTS=${AGENT_DAILY_BUDGET_CENTS:-500}
      - AGENT_MONTHLY_BUDGET_CENTS=${AGENT_MONTHLY_BUDGET_CENTS:-10000}
      - AGENT_MAX_CONTEXT_TOKENS=${AGENT_MAX_CONTEXT_TOKENS:-32000}
      - AGENT_MAX_SCAN_CANDIDATES=${AGENT_MAX_SCAN_CANDIDATES:-20}
      - AGENT_MAX_PATTERN_HISTORY=${AGENT_MAX_PATTERN_HISTORY:-50}
      - AGENT_MAX_RETRIES_PER_STEP=${AGENT_MAX_RETRIES_PER_STEP:-2}
      - AGENT_POLL_INTERVAL_MS=${AGENT_POLL_INTERVAL_MS:-5000}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
      - MASSIVE_API_KEY=${MASSIVE_API_KEY}
      - DISCORD_WEBHOOK_SWING_SETUPS=${DISCORD_WEBHOOK_SWING_SETUPS}
      - DISCORD_WEBHOOK_SWING_ALERTS=${DISCORD_WEBHOOK_SWING_ALERTS}
      - TZ=America/New_York
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "3"
    healthcheck:
      test: ["CMD-SHELL", "test -f /tmp/healthy && find /tmp/healthy -mmin -2 >/dev/null 2>&1"]
      interval: 30s
      timeout: 10s
      retries: 3
```

**Total resource usage:** ~1.5GB RAM for 3 agents + Discord bot. Fits comfortably on a 16GB laptop.

**Note:** `deploy.resources.limits` in Docker Compose is only enforced in Swarm mode. In standalone `docker compose` mode, memory limits are advisory only. The actual memory guard is the Node.js `--max-old-space-size` flag, set via `NODE_OPTIONS` env var if needed. For V1, the 512M limits serve as documentation of expected usage rather than hard enforcement.

Agent containers do not expose an HTTP server, so healthchecks use a heartbeat-touched `/tmp/healthy` file instead of `/api/health`. The heartbeat loop is responsible for touching `/tmp/healthy` on every successful tick. The existing `discord-bot` service is preserved for bidirectional `#orchestrator` chat. The `redis` service from the old compose is removed — it is not used by the agent system.

### Home Server Notes

- Laptop must have sleep disabled (`systemd-inhibit` or power settings)
- Use ethernet for reliability
- `TZ=America/New_York` ensures cron schedules align with market hours
- Future option: migrate to a VPS (Hetzner $4/mo, Oracle Cloud free tier with 4 ARM cores / 24GB RAM)

## 16. Operational Readiness / Runbooks

These items are launch blockers for EPIC-5, not blockers for the initial implementation worktree.

### Backup and Restore Before Migration 0019

- Deliverable: `docs/ops/agents-backup-restore.md`
- Owner: EPIC-2 pre-flight work
- Pass condition: document the exact Neon backup/export step, the exact restore step, and record one tested restore verification before migration 0019 is treated as launch-ready

### Rollback Procedure

- Deliverable: `docs/ops/agents-rollback.md`
- Owner: EPIC-5 launch-hardening work
- Pass condition: includes step-by-step app rollback, Docker service rollback, and migration 0019 partial-failure recovery

### Home-Server Recovery Checklist

- Deliverable: `docs/ops/home-server-recovery.md`
- Owner: EPIC-5 launch-hardening work
- Pass condition: documents reboot recovery, WSL startup, Docker daemon startup, `docker compose` restart behavior, and the exact recovery sequence after ISP outage or power loss

### Minimum Observability

- Deliverable: `scripts/ops/agent-observability.sql` plus any required admin endpoint fields in `/api/agents/admin/stats`
- Owner: EPIC-5 launch-hardening work
- Pass condition: reviewer can query or inspect queue depth, oldest queued job age, jobs stuck in `processing`, missed scheduled runs, delivery failure count, agent heartbeat freshness, and container restart loops without ad hoc investigation

### Deploy Smoke Checklist

- Discord `#orchestrator` chat end-to-end
- Discord bot service → `/api/agents/service/chat` → poll → reply end-to-end
- report delivery webhook path
- macro-summary latest route
- admin stats route
- one forced offline-specialist fallback path

### Config and Secret Validation

- Review Vercel env vars and `services/.env` together before launch.
- Verify `AGENT_ADMIN_KEY` and `AGENT_SERVICE_KEY` separately.
- Validate Discord webhook URLs.
- Validate lane keys, base URLs, and models before launch.

### Epic Assignment

| Item | Epic / Timing | Artifact / Gate |
|------|---------------|-----------------|
| Neon backup before migration 0019 | EPIC-2 pre-flight | `docs/ops/agents-backup-restore.md` completed before `npm run db:migrate` |
| Rollback procedure documentation | EPIC-5 | `docs/ops/agents-rollback.md` completed before Docker deploy |
| Home-server recovery checklist | EPIC-5 | `docs/ops/home-server-recovery.md` verified after first `docker compose up` |
| Minimum observability | EPIC-5 | `scripts/ops/agent-observability.sql` + admin stats coverage |
| Deploy smoke checklist | EPIC-5 gate | All smoke items pass before launch readiness is claimed |
| Config and secret validation | Initial setup + EPIC-5 | Re-verified before launch |

---

## 17. How To Use This Doc

Use this document for:

- target architecture
- schema shape and runtime constraints
- API contracts and routing rules
- prompt, evidence, and blueprint design rules

Use `HANDOFF.md` for active execution specs and git history for archived rollout sequencing.

---

## 18. File Inventory

This reference doc intentionally does not duplicate a phase-by-phase file inventory. The repo has already completed the old Jarvis and Markets deletion work, and new file ownership should be tracked in active handoff specs instead of hard-coded here.

---

## 19. Environment Variables

### Agent LLM Config — Two-Lane

| Variable | Default | Used By | Purpose |
|----------|---------|---------|---------|
| `INTERACTIVE_LLM_API_KEY` | (required) | Orchestrator (chat) | API key for user-facing chat lane |
| `INTERACTIVE_LLM_API_BASE_URL` | `https://api.groq.com/openai/v1` | Orchestrator (chat) | LLM provider root for interactive lane |
| `INTERACTIVE_LLM_MODEL` | `llama-3.3-70b-versatile` | Orchestrator (chat) | Model for interactive lane |
| `INTERACTIVE_LLM_TIMEOUT_MS` | `30000` | Orchestrator (chat) | Timeout for interactive lane (30s) |
| `BACKGROUND_LLM_API_KEY` | (required) | Small Cap, Swing, Orchestrator (cron) | API key for background lane |
| `BACKGROUND_LLM_API_BASE_URL` | `https://api.groq.com/openai/v1` | Small Cap, Swing, Orchestrator (cron) | LLM provider root for background lane |
| `BACKGROUND_LLM_MODEL` | `llama-3.3-70b-versatile` | Small Cap, Swing, Orchestrator (cron) | Model for background lane |
| `BACKGROUND_LLM_TIMEOUT_MS` | `60000` | Small Cap, Swing, Orchestrator (cron) | Timeout for background lane (60s) |

Groq and NVIDIA are the default testing/provider roots in this spec. The background lane may later switch to DeepSeek (`https://api.deepseek.com/v1`) without changing the lane contract.

### Agent Budget Limits — Hard Enforcement

| Variable | Default | Used By | Purpose |
|----------|---------|---------|---------|
| `AGENT_DAILY_BUDGET_CENTS` | `500` | All agents (per-agent) | Hard daily spend cap ($5/day). Enforced in `callLlm()`. |
| `AGENT_MONTHLY_BUDGET_CENTS` | `10000` | All agents (per-agent) | Hard monthly spend cap ($100/mo). Enforced in `callLlm()`. |
| `AGENT_MAX_CONTEXT_TOKENS` | `32000` | All agents | Max tokens per LLM call input. Truncates if exceeded. |
| `AGENT_MAX_SCAN_CANDIDATES` | `20` | Small Cap, Swing Trader | Max tickers per scan passed to LLM step. |
| `AGENT_MAX_ASKEDGAR_CALLS_PER_SCAN` | `60` | Small Cap Trader | Max AskEdgar API calls per pre-market scan. Hard stop — excess tickers skipped. |
| `AGENT_MAX_PATTERN_HISTORY` | `50` | Swing Trader | Max pattern history items loaded per LLM call. |
| `AGENT_MAX_RETRIES_PER_STEP` | `2` | All agents | Max repair retries per LLM step. |

### Agent Infrastructure

| Variable | Default | Used By | Purpose |
|----------|---------|---------|---------|
| `DATABASE_URL` | (existing, required) | All agents + Next.js | Neon Postgres connection string |
| `AGENT_POLL_INTERVAL_MS` | `5000` | All agents | Job queue poll interval |
| `AGENT_ID` | (required per service) | Each Docker service | Agent identity |
| `AGENT_ADMIN_KEY` | (required) | Next.js app | Admin API auth |
| `AGENT_SERVICE_KEY` | (required) | Discord bot + Next.js app | Bot-to-app service auth (see Section 13) |
| `MACRO_CRON_HOUR` | `6` | Orchestrator | Hour (ET) to run macro summary |
| `MASSIVE_API_KEY` | (existing) | All agents | Market data API |
| `MASSIVE_API_BASE_URL` | `https://api.polygon.io` | All agents | Polygon-compatible base URL for Massive API |
| `ASKEDGAR_API_KEY` | (existing) | All agents | SEC filings API |
| `TZ` | `America/New_York` | All agents | Timezone for cron/schedule alignment |

`AGENT_SERVICE_KEY` is for Discord bot service calls only. `AGENT_ADMIN_KEY` is for admin routes only.

`services/.env.example` must include, at minimum: `DATABASE_URL`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, every `DISCORD_WEBHOOK_*` variable, `INTERACTIVE_LLM_API_KEY`, `INTERACTIVE_LLM_API_BASE_URL`, `INTERACTIVE_LLM_MODEL`, `BACKGROUND_LLM_API_KEY`, `BACKGROUND_LLM_API_BASE_URL`, `BACKGROUND_LLM_MODEL`, `MASSIVE_API_KEY`, `ASKEDGAR_API_KEY`, `AGENT_ADMIN_KEY`, `AGENT_SERVICE_KEY`, `AGENT_POLL_INTERVAL_MS`, `MACRO_CRON_HOUR`, and `TZ`.

### Discord Bot

| Variable | Purpose |
|----------|---------|
| `DISCORD_BOT_TOKEN` | Bot authentication token for bidirectional `#orchestrator` chat |
| `DISCORD_CLIENT_ID` | Bot application (client) ID |
| `DISCORD_GUILD_ID` | Server (guild) ID for the Nexus Terminal Discord server |

### Discord Webhooks

| Variable | Purpose |
|----------|---------|
| `DISCORD_WEBHOOK_SCANS` | Small Cap pre-market scan results |
| `DISCORD_WEBHOOK_RESEARCH` | Small Cap on-demand research |
| `DISCORD_WEBHOOK_SWING_SETUPS` | Swing Trader MDR candidates |
| `DISCORD_WEBHOOK_SWING_ALERTS` | Swing Trader real-time alerts |
| `DISCORD_WEBHOOK_MACRO_DAILY` | Orchestrator daily macro briefing |
| `DISCORD_WEBHOOK_SYSTEM` | Agent health, budget warnings, errors |

### API Key Split by Purpose (Recommended Practice)

| Key Slot | Which Env Vars to Set | Purpose |
|----------|-----------------------|---------|
| Dev/test | Both `INTERACTIVE_LLM_API_KEY` and `BACKGROUND_LLM_API_KEY` → same Groq free-tier key | One key, same model for both lanes during testing. |
| Prod interactive | `INTERACTIVE_LLM_API_KEY` → NVIDIA or paid Groq key | Orchestrator chat. Speed-optimized. |
| Prod background | `BACKGROUND_LLM_API_KEY` → NVIDIA or DeepSeek key | Specialist scans. Quality/cost-optimized. |
| Eval/batch (optional) | Separate key for offline evaluation runs | Prevents eval cost from eating production budget. |

**Why split by purpose, not per agent:** Interactive vs background gives budget isolation and rate-limit separation without creating one key per tiny workflow. Agents in the same lane share a key.

Historical note: the current repo already standardized on `LLM_*` names for its existing Vercel-side LLM client. New AEV2 code should use the lane-specific vars above plus `AGENT_ADMIN_KEY` and `AGENT_SERVICE_KEY` only.

---

## 20. V1 Discord Orchestrator Adapter

Discord is promoted into V1 for the `#orchestrator` channel.

**Implementation intent:** build a minimal V1 Discord bot runtime in `services/discord-bot/`.

1. The bot listens in `#orchestrator`
2. The bot sends the Discord author ID as `discord_user_id` to `/api/agents/service/chat`
3. `requireServiceAuth()` validates the service key, resolves Discord user → Nexus user via the hardcoded V1 mapping in `lib/agents/admin.ts`, and creates the corresponding Orchestrator chat job with `channel = 'discord'`
4. It polls for completion and formats the response as a Discord embed
5. Specialist reports remain one-way via webhooks; only Orchestrator chat is bidirectional in V1

**Schema note:** `agent_conversations.channel` supports `'discord'` in the new schema. In V1, the hardcoded Discord-to-Nexus mapping lives in `lib/agents/admin.ts` and is used only on the server side by `requireServiceAuth()`. The bot does not resolve Nexus users itself; it only sends `discord_user_id`. A `discord_user_links` table is deferred to V2 when more users join.

**Prerequisites:** Discord bot service must be running, hardcoded user mapping configured.

**Runtime details:**
- Library: `discord.js` v14
- Runtime: Node 20 (matches agent Dockerfile base image)
- Polling interval: 2 seconds, with 120-second timeout (60 attempts). If the job is not complete after 120s, reply with a timeout message.
- Package dependencies: `discord.js`, `tsx` (TypeScript execution)
- `services/discord-bot/package.json` must include `discord.js` and `tsx` as production dependencies

The Discord bot does not call user-facing chat routes or `/api/agents/admin/*`; it only uses `/api/agents/service/*`.

**Acceptance criteria:**
- receives a message in `#orchestrator`
- sends `discord_user_id` to `/api/agents/service/chat`
- relies on `requireServiceAuth()` to resolve the Nexus user server-side
- polls for completion
- posts the final response back into Discord

---

## 21. Open Questions

1. **Historical research import format.** Trade examples are DAS Trader screenshots (PNG/JPG) processed via manual annotation into structured JSON (see Section 27). Remaining question: are there additional research reports in other formats (PDF, markdown, spreadsheet) that need separate import scripts?

2. **Social sentiment data source.** The Swing Trader may benefit from social sentiment API data (Twitter/X trending tickers, StockTwits, Reddit). Defer specific API choice to V2. For V1, the Swing Trader relies on Massive API price/volume momentum data and AskEdgar market-strength narrative.

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

### Historical Module Reference

| Historical Implementation | Planned AEV2 Equivalent | Notes |
|---------------------------|-------------------------|-------|
| `client.ts` | `llm-client.ts` | Rewrite with dual-lane config + budget enforcement |
| `circuit-breaker.ts` | `circuit-breaker.ts` | Same pattern, per-agent state |
| `rate-limit.ts` | `rate-limit.ts` | Same 30 req/hr |
| `token-tracking.ts` | `token-tracking.ts` | Extend with `agent_id`, `lane`, and cost |
| `memory.ts` | `memory.ts` | Rewrite with `agent_id` scope |
| `context.ts` | `context.ts` | Extend with agent-specific context |
| `askedgar.ts` | `lib/askedgar.ts` | Already landed in the current repo; AEV2 should reuse it |
| `prompts.ts` | `prompts.ts` | Split into per-agent files |
| `scrape-lite.ts` | `lib/agents/scrape-lite.ts` | Historical reference only; implement the minimal helper the agent runtime actually needs |
| `legacy trade-analysis.ts` | Small Cap blueprint steps | Logic split across `code` and `llm` steps in `small-cap:research` blueprint |
| `research.ts` | Small Cap blueprint steps | Logic split across `code` and `llm` steps in `small-cap:pre-market-scan` blueprint |
| (new) | `blueprint-runner.ts` | New file — executes blueprint step sequences, tracks tokens per step |

---

## 22. Three-Layer Prompt Architecture

### 22.1 Layer 1: Global Policy

Shared by all agents on all LLM calls. It defines:

- authority order and routing ownership
- evidence and citation rules
- output-format rules
- memory-write restrictions
- safety boundaries

### 22.2 Layer 2: Per-Agent Role Prompt

Loaded from the agent's role prompt file. It contains domain heuristics only:

- `orchestrator.md` — routing, fallback behavior, macro framing
- `small-cap.md` — short-selling research heuristics, dilution framework, offering-risk interpretation
- `swing-trader.md` — MDR/pattern recognition heuristics, momentum context, pattern-comparison behavior

### 22.3 Layer 3: Per-Step Contract Prompt

Embedded in each `llm` blueprint step. It defines:

- one job only
- allowed evidence sources for the step
- exact output schema
- how uncertainty is represented
- step-specific forbidden behaviors

Implementation note: this reference doc defines layer responsibilities, not verbatim prompt text. Exact prompt wording should live in the prompt files and step implementations.

---

## 23. Evidence and Citation Rules

### 23.1 Claim Classes Requiring Citations

| Claim Class | Example | Required Citation Source |
|-------------|---------|------------------------|
| `market_data` | "UGRO is up 300% this week" | Massive API snapshot timestamp |
| `filing_fact` | "Company filed S-3 on March 20" | AskEdgar filing ID + document URL |
| `macro_fact` | "Fed held rates at 5.25%" | Macro summary source ID |
| `thesis_change` | "Invalidating bullish thesis on XYZ" | Evidence IDs from prior thesis + new contradicting data |

### 23.2 LLM Output Evidence Fields

Every `llm` step output schema must include:

```typescript
{
  confidence: 'high' | 'medium' | 'low';
  evidenceIds: string[];                    // IDs from tool/filing/data sources used
  insufficientEvidence: boolean;            // true if the step couldn't reach a supported conclusion
}
```

### 23.3 Code-Gated Memory Writes

LLM steps may propose memory write candidates in their output:

```typescript
{
  memoryWriteCandidates: Array<{
    category: MemoryCategory;
    key: string;
    value: string;
    source: string;
    confidence: 'high' | 'medium' | 'low';
    expiresAt?: string;                     // ISO date
  }>;
}
```

The subsequent `code` step validates these candidates (checks for duplicates, checks required fields, checks confidence threshold) before persisting to `agent_memory_v2`. LLM steps never write directly to memory.

---

## 24. Anti-Pattern Ban List

These patterns are explicitly banned in the implementation:

| Anti-Pattern | Why it's Banned | What to Do Instead |
|--------------|-----------------|-------------------|
| Giant all-purpose prompts | Impossible to test, debug, or version | Three-layer prompt stack (Section 22) |
| Free-form report generation from user input | Uncontrolled output, no evidence linking | Blueprint steps with typed schemas |
| Shared global memory without scope/expiry | Cross-agent contamination, stale data | Memory scoped by `agent_id`, with `source`, `confidence`, `expires_at` |
| Specialist agents inventing routes | Breaks orchestrator ownership | Only Orchestrator routes; specialists process |
| "Cite if possible" language | Makes citations optional | Mandatory citation for specified claim classes |
| Persisting raw LLM prose as memory | Bloats memory, low signal-to-noise | Code-gated memory writes with structured fields |
| LLM router where deterministic rules work | Expensive, unreliable | Code-based routing in Orchestrator |
| LLM doing calculations, filtering, or threshold checks | Hallucination risk on exact operations | Deterministic code steps |

---

## 25. AskEdgar Research Contract

The `small-cap:research` LLM step is a structured AskEdgar-driven research synthesis step.

Stable contract rules:

- code steps provide validated evidence for news, catalyst, dilution, offering history, offering ability, cash need, and theme context
- the LLM step returns structured JSON, not free-form Discord prose
- the response must include section-level ratings/explanations plus `confidence`, `evidenceIds`, and `insufficientEvidence`
- the follow-on code step validates the payload and formats the Discord output

Exact prompt wording and the concrete schema should live with the implementation, not in this reference document.

---

## 26. Code vs LLM Boundary Rules

| Task | Owner | Rationale |
|------|-------|-----------|
| Routing requests to agents | **Code** | Business rules, not model knowledge |
| Threshold checks (price floor, gain %, market cap ceiling) | **Code** | Exact comparison |
| Ticker normalization and validation | **Code** | Regex, no judgment |
| Deduplication of scan candidates | **Code** | Set operations |
| Sorting and filtering scan results | **Code** | Deterministic ordering |
| Freshness checks (is this data stale?) | **Code** | Timestamp comparison |
| SMA, RSI, VWAP, MACD, Bollinger calculation | **Code** | Math formulas |
| Permissions and auth checks | **Code** | Security-critical |
| Budget enforcement | **Code** | Exact arithmetic |
| Report schema validation before persistence | **Code** | Must not persist malformed data |
| Memory write validation | **Code** | Gate LLM proposals |
| Citation validation | **Code** | Check source IDs exist |
| Synthesizing thesis from validated evidence | **LLM** | Judgment required |
| Explaining tradeoffs between conflicting signals | **LLM** | Narrative synthesis |
| Scoring dilution risk from filing data | **LLM** | Contextual interpretation |
| Writing user-facing summaries | **LLM** | Natural language |
| MDR pattern similarity scoring | **LLM** | Pattern recognition beyond simple metrics |

---

## 27. Trade Example Seed Strategy

Trade example seeding is optional parallel data work, not a core architecture dependency.

Stable rules only:

- reviewed screenshot-derived examples seed `agent_memory_v2`
- seeded rows are agent-scoped to `small-cap-trader`, `swing-trader`, or both
- the main categories are `pattern` and `trade_insight`
- the seed script must be idempotent and safe to re-run
- execution timing and operator workflow should live in the active `HANDOFF.md` spec when this seed work is revisited

---

## Revision History

- 2026-03-22 to 2026-03-28: initial AEV2 architecture drafting and revision passes.
- 2026-04-06: synced to current repo reality and removed stale migration/Jarvis/build-order detail from this reference doc.
- 2026-04-12: removed references to the completed standalone AEV2 execution-plan file and pointed future implementation work back to `HANDOFF.md` plus git history.
