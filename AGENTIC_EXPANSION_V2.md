# Nexus Terminal — Autonomous Agent Framework Architecture
> Generated: 2026-03-13 | Status: DRAFT — Requires approval before implementation

---

## 1. Executive Summary

This document specifies a multi-agent system for Nexus Terminal consisting of three runtime components: an **Orchestrator** (with built-in research routing pipeline), a **Dilutionary Small Cap Trader** agent, and a **Long Term Investor** agent. Discord serves as both an input and output channel alongside the existing web UI.

The system runs in the existing Docker Compose stack. Agents communicate via the Postgres-backed job queue pattern already proven in `notification_jobs`. The LLM provider is Llama 3.1 70B Instruct via NVIDIA API (OpenAI-compatible endpoint). Market data comes from Polygon.io (configured, starter tier). Ticker research comes from AskEdgar API.

### Design Principles

- **Postgres is the backbone.** All inter-agent communication, state, memory, and job coordination flows through Postgres. No new infrastructure dependencies beyond what already exists.
- **Agents are long-running Docker services.** They poll for work, execute, and write results back. They do not run on Vercel.
- **The Orchestrator owns routing.** The collapsed Research Analyst logic lives inside the Orchestrator as a deterministic rules engine — no LLM call for routing decisions.
- **Each agent has strict scope boundaries.** An agent can only read its own memory and the shared job queue. Cross-agent data access goes through the Orchestrator.
- **Discord is a channel adapter, not an agent.** The existing Discord bot translates user commands into job queue entries and formats agent outputs into Discord embeds.

---

## 2. System Topology

```
┌─────────────────────────────────────────────────────────────┐
│                        VERCEL (Next.js)                     │
│                                                             │
│  Web UI ─── /api/agents/chat ──┐                            │
│  Web UI ─── /api/agents/reports ──┤  (writes to agent_jobs) │
│                                   ▼                         │
│                            ┌──────────┐                     │
│                            │ Postgres │                     │
│                            └──────────┘                     │
└─────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────┐
│                    DOCKER COMPOSE STACK                      │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Orchestrator  │  │  Small Cap   │  │  Long Term       │  │
│  │              │  │  Trader      │  │  Investor        │  │
│  │ - Routes jobs│  │              │  │                  │  │
│  │ - Manages    │  │ - Pre-market │  │ - Macro analysis │  │
│  │   memory     │  │   scans      │  │ - Portfolio      │  │
│  │ - Schedules  │  │ - Dilution   │  │   construction   │  │
│  │   cron work  │  │   analysis   │  │ - Thesis         │  │
│  │ - Research   │  │ - Technical  │  │   tracking       │  │
│  │   routing    │  │   analysis   │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘  │
│         │                 │                 │               │
│         └────────┬────────┴─────────────────┘               │
│                  ▼                                           │
│  ┌──────────────────────┐  ┌────────────────────────────┐   │
│  │   Discord Bot        │  │  Backtest Worker (existing) │  │
│  │   (existing service) │  │  Redis + BullMQ (existing)  │  │
│  └──────────────────────┘  └────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema Additions

All new tables live alongside existing schema in `lib/db/schema.ts`. Migration will be a single Drizzle migration file.

### 3.1 `agent_jobs` — Inter-agent job queue

Reuses the proven `notification_jobs` pattern with agent-specific fields.

```
agent_jobs
├── id                  SERIAL PRIMARY KEY
├── source_agent        TEXT NOT NULL          -- 'orchestrator' | 'small_cap' | 'long_term' | 'user'
├── target_agent        TEXT NOT NULL          -- 'orchestrator' | 'small_cap' | 'long_term'
├── job_type            TEXT NOT NULL          -- 'research_request' | 'scan_result' | 'report' | 'chat_query' | 'scheduled_scan'
├── payload             JSONB NOT NULL         -- job-specific structured data
├── priority            INTEGER DEFAULT 0      -- higher = more urgent
├── status              TEXT DEFAULT 'pending' -- 'pending' | 'claimed' | 'completed' | 'failed'
├── attempts            INTEGER DEFAULT 0
├── max_attempts        INTEGER DEFAULT 3
├── result              JSONB                  -- agent output written on completion
├── error               TEXT                   -- last error message
├── dedupe_key          TEXT UNIQUE            -- prevents duplicate jobs
├── claimed_at          TIMESTAMPTZ
├── completed_at        TIMESTAMPTZ
├── created_at          TIMESTAMPTZ DEFAULT now()
├── updated_at          TIMESTAMPTZ DEFAULT now()
└── INDEXES
    ├── idx_agent_jobs_target_status ON (target_agent, status, priority DESC)
    └── idx_agent_jobs_source ON (source_agent, created_at)
```

### 3.2 `agent_memory` — Per-agent persistent memory

Each agent has isolated memory. The Orchestrator can read all agents' memory for oversight. Individual agents can only read their own.

```
agent_memory
├── id                  SERIAL PRIMARY KEY
├── agent_id            TEXT NOT NULL          -- 'orchestrator' | 'small_cap' | 'long_term'
├── memory_type         TEXT NOT NULL          -- 'fact' | 'thesis' | 'watchlist' | 'scan_param' | 'performance'
├── key                 TEXT NOT NULL          -- lookup key (e.g., ticker, theme name)
├── value               JSONB NOT NULL         -- structured memory content
├── confidence          REAL DEFAULT 1.0       -- 0.0-1.0, decays over time or on contradicting evidence
├── expires_at          TIMESTAMPTZ            -- optional TTL for time-sensitive memories
├── created_at          TIMESTAMPTZ DEFAULT now()
├── updated_at          TIMESTAMPTZ DEFAULT now()
└── CONSTRAINTS
    ├── UNIQUE (agent_id, memory_type, key)
    └── INDEX idx_agent_memory_agent_type ON (agent_id, memory_type)
```

### 3.3 `agent_reports` — Published research output

Immutable once written. Reports are the primary output artifact of the system.

```
agent_reports
├── id                  SERIAL PRIMARY KEY
├── agent_id            TEXT NOT NULL
├── report_type         TEXT NOT NULL          -- 'ticker_research' | 'dilution_analysis' | 'macro_summary' | 'portfolio_recommendation' | 'thesis_update'
├── ticker              TEXT                   -- nullable (macro reports have no ticker)
├── title               TEXT NOT NULL
├── summary             TEXT NOT NULL          -- 2-3 sentence executive summary
├── body                JSONB NOT NULL         -- structured report content (sections, data points, charts)
├── data_sources        JSONB NOT NULL         -- array of { source, url, fetched_at } for audit trail
├── confidence          REAL DEFAULT 0.5       -- agent's self-assessed confidence in the analysis
├── created_at          TIMESTAMPTZ DEFAULT now()
└── INDEXES
    ├── idx_agent_reports_agent_type ON (agent_id, report_type, created_at DESC)
    └── idx_agent_reports_ticker ON (ticker, created_at DESC)
```

### 3.4 `agent_conversations` — Chat history with users

Stores the web UI and Discord conversation threads.

```
agent_conversations
├── id                  SERIAL PRIMARY KEY
├── user_id             TEXT NOT NULL           -- references users.id
├── channel             TEXT NOT NULL            -- 'web' | 'discord'
├── role                TEXT NOT NULL            -- 'user' | 'assistant' | 'system'
├── content             TEXT NOT NULL
├── agent_id            TEXT                     -- which agent responded (null for user messages)
├── metadata            JSONB                    -- tool calls, report references, etc.
├── created_at          TIMESTAMPTZ DEFAULT now()
└── INDEXES
    ├── idx_agent_conversations_user ON (user_id, created_at DESC)
    └── idx_agent_conversations_channel ON (channel, user_id, created_at DESC)
```

---

## 4. Agent Specifications

### 4.1 Orchestrator

**Runtime:** Long-running Node.js process in Docker Compose.
**Poll interval:** 2 seconds on `agent_jobs` where `target_agent = 'orchestrator'`.
**Schedule:** Cron triggers at 6:00 AM EST (pre-market prep), 9:30 AM EST (market open), 4:30 PM EST (market close summary).

**Responsibilities:**

1. **Request routing (Research Analyst logic).** When a user query or scheduled scan arrives, the Orchestrator classifies it using deterministic rules — not an LLM call:
   - Market cap < $200M AND pre-market gain >= 50% → route to `small_cap`
   - Macro/sector/commodity/interest rate topic → route to `long_term`
   - Ambiguous or multi-domain → split into sub-jobs, one per agent
   - Simple factual lookup → handle directly via Polygon/AskEdgar without agent delegation

2. **Memory oversight.** The Orchestrator can read all agents' memory rows. It uses this to detect contradictions (e.g., Small Cap agent is bullish on a ticker that Long Term agent flagged as fundamentally deteriorating) and inject context when routing jobs.

3. **Report aggregation.** When agents complete reports, the Orchestrator receives the completion event, optionally adds cross-agent context, and pushes the final report to the appropriate output channel (web notification, Discord embed).

4. **Schedule management.** Owns the cron schedule. At each trigger, it creates `scheduled_scan` jobs for each agent based on their registered scan parameters.

**LLM usage:** The Orchestrator calls the LLM only for:
- Synthesizing cross-agent summaries
- Answering user chat queries that require reasoning (not routing)
- Generating the daily briefing from aggregated agent outputs

### 4.2 Dilutionary Small Cap Trader

**Runtime:** Long-running Node.js process in Docker Compose.
**Poll interval:** 5 seconds on `agent_jobs` where `target_agent = 'small_cap'`.
**Autonomous trigger:** Pre-market scan at 7:00 AM EST. Checks Polygon.io for stocks matching: close >= $0.75, pre-market gain >= 50%, market cap < $200M.

**Private state (in `agent_memory`):**
- `scan_param` entries: threshold values (price floor, gain %, market cap ceiling)
- `watchlist` entries: tickers currently being tracked with entry/exit levels
- `fact` entries: per-ticker dilution history, historical performance notes
- `performance` entries: accuracy of past calls (predicted vs actual outcome)

**Capabilities:**
1. **Pre-market scanner.** Fetches Polygon.io snapshot data, filters against scan parameters, produces candidate list.
2. **Dilution analysis.** For each candidate, queries AskEdgar for SEC filings (S-3, prospectus supplements, 8-K dilution announcements). Cross-references with historical dilution patterns stored in memory.
3. **Technical analysis.** Fetches OHLCV from Polygon.io, applies pattern recognition (support/resistance, volume profile, gap analysis) using the LLM with structured output schema.
4. **Report generation.** Produces a `dilution_analysis` report with: ticker, dilution risk score, technical setup, entry/exit levels, confidence rating.

**LLM usage:** Every analysis step after the initial scan filter. The LLM receives structured data (not raw HTML) and returns structured JSON per the output schema.

**Historical research import:** You mentioned importing historical research reports. This will be a one-time bulk insert into `agent_memory` with `memory_type = 'fact'` and the ticker as the key. We will need a migration script for this — format TBD based on what your existing research looks like.

### 4.3 Long Term Investor

**Runtime:** Long-running Node.js process in Docker Compose.
**Poll interval:** 10 seconds on `agent_jobs` where `target_agent = 'long_term'`.
**Autonomous trigger:** Weekly macro scan on Sunday evening. Daily sector rotation check at 5:00 PM EST.

**Private state (in `agent_memory`):**
- `thesis` entries: active investment theses with entry conditions, invalidation criteria, and target exit signals
- `watchlist` entries: sectors and names under observation
- `fact` entries: macro indicators being tracked (Fed funds rate, CPI, PMI, yield curve)
- `scan_param` entries: sector allocation targets, risk tolerance parameters
- `performance` entries: thesis outcome tracking (validated, invalidated, in-progress)

**Capabilities:**
1. **Macro analysis.** Fetches economic data via Polygon.io and supplementary sources. Identifies macro regime (expansion, contraction, transition) and sector implications.
2. **Sector screening.** Narrows from macro thesis to specific sectors, then to individual names using fundamental data from AskEdgar (10-K, 10-Q financials).
3. **Portfolio construction.** Given user's age, time horizon, and goals (stored in Orchestrator memory as user profile), recommends a portfolio with position sizing rationale and suitability assessment.
4. **Thesis lifecycle management.** Each thesis is a living document in memory. The agent updates thesis status based on new data, marks theses as invalidated when conditions change, and signals when a thesis has fully played out.

**LLM usage:** All analysis and thesis generation. The LLM receives structured financial data and returns structured JSON. Portfolio recommendations require explicit suitability disclaimers in the output schema.

---

## 5. Agent Registration & Lifecycle

### 5.1 Agent Interface

Every agent implements a common TypeScript interface:

```typescript
interface AgentDefinition {
  id: string;                          // 'orchestrator' | 'small_cap' | 'long_term'
  name: string;                        // Human-readable name
  description: string;                 // What this agent does
  version: string;                     // Semver for schema compatibility
  pollInterval: number;                // Milliseconds between job queue polls
  schedules: CronSchedule[];           // Autonomous cron triggers
  capabilities: string[];              // Registered capability names
  outputSchemas: Record<string, ZodSchema>; // Per-report-type output validation
}

interface AgentRuntime {
  start(): Promise<void>;              // Begin polling + cron registration
  stop(): Promise<void>;               // Graceful shutdown
  health(): Promise<AgentHealthStatus>; // For Docker healthcheck
  processJob(job: AgentJob): Promise<AgentJobResult>; // Core work handler
}
```

### 5.2 Explicit Registration

At startup, each agent service calls `registry.register()` which:
1. Writes a heartbeat row to a `agent_registry` table (agent_id, version, last_heartbeat, status)
2. Validates that its output schemas are compatible with the Orchestrator's expectations
3. Begins its poll loop and registers its cron schedules

The Orchestrator checks `agent_registry` heartbeats before routing jobs. If an agent has not heartbeated in 3x its poll interval, the Orchestrator marks it `unhealthy` and stops routing new work to it.

### 5.3 `agent_registry` table

```
agent_registry
├── agent_id            TEXT PRIMARY KEY
├── version             TEXT NOT NULL
├── status              TEXT DEFAULT 'starting' -- 'starting' | 'healthy' | 'unhealthy' | 'stopped'
├── capabilities        JSONB NOT NULL          -- array of capability names
├── last_heartbeat      TIMESTAMPTZ
├── started_at          TIMESTAMPTZ DEFAULT now()
├── metadata            JSONB                   -- config, poll interval, etc.
```

---

## 6. LLM Integration

### 6.1 Single Call Wrapper

All LLM calls go through one function. No agent calls the NVIDIA API directly.

```typescript
// lib/agents/llm.ts
async function callLLM(params: {
  agentId: string;
  systemPrompt: string;
  messages: ChatMessage[];
  outputSchema?: ZodSchema;       // If provided, enforce structured output
  temperature?: number;            // Default 0.1 for analytical work
  maxTokens?: number;              // Default 4096
}): Promise<LLMResponse>
```

**Provider:** NVIDIA API Platform
**Model:** `meta/llama-3.1-70b-instruct`
**Endpoint:** `https://integrate.api.nvidia.com/v1`
**Auth:** `NDIA_API_KEY` env var

### 6.2 System Prompts

Each agent has a dedicated system prompt file:

```
lib/agents/prompts/
├── orchestrator.md       -- routing context, cross-agent synthesis rules
├── small-cap.md          -- dilution analysis framework, technical patterns
└── long-term.md          -- macro analysis framework, portfolio theory, suitability rules
```

Each prompt enforces a strict JSON output schema per job type. The wrapper validates the response against the Zod schema before returning.

---

## 7. Data Source Integration

### 7.1 Polygon.io

**Configured:** Yes (starter tier, in .env)
**Rate limit:** 5 calls/minute on free tier
**Usage pattern:** Sequential fetches with 12-second spacing between calls. No parallel Polygon requests.

```typescript
// lib/agents/data/polygon.ts
class PolygonClient {
  async getSnapshot(ticker: string): Promise<TickerSnapshot>;
  async getOHLCV(ticker: string, timespan: string, from: string, to: string): Promise<Candle[]>;
  async getMarketStatus(): Promise<MarketStatus>;
  async getGainers(type: 'premarket' | 'regular'): Promise<GainerEntry[]>;
}
```

### 7.2 AskEdgar

**Configured:** Key acquired (`ASKEDGAR_API_KEY`)
**Usage pattern:** Parallel fetches via `Promise.allSettled` (AskEdgar has generous rate limits).

```typescript
// lib/agents/data/askedgar.ts
class AskEdgarClient {
  async getFilings(ticker: string, types: string[]): Promise<Filing[]>;
  async getFinancials(ticker: string, periods: number): Promise<FinancialData>;
  async searchFilings(query: string): Promise<SearchResult[]>;
}
```

### 7.3 Rate Limit Coordinator

Because both agents share the same Polygon API key, a central rate limiter prevents exceeding 5 req/min:

```typescript
// lib/agents/data/rate-limiter.ts
class PostgresRateLimiter {
  // Uses a simple counter row in Postgres, checked before each external call
  async acquire(source: 'polygon' | 'askedgar'): Promise<boolean>;
  async release(source: 'polygon' | 'askedgar'): Promise<void>;
}
```

This is simpler than a Redis-based limiter and keeps Postgres as the single coordination layer.

---

## 8. Channel Abstraction

### 8.1 Web UI → Orchestrator

The Next.js API route `POST /api/agents/chat` accepts user messages and writes them to `agent_jobs` with `source_agent = 'user'` and `target_agent = 'orchestrator'`. It then polls for the completed job result (or uses Server-Sent Events if you want real-time streaming later).

```
POST /api/agents/chat
Body: { message: string, conversationId?: string }
Auth: Existing JWT session
Response: { jobId: string, status: 'queued' }

GET /api/agents/chat/:jobId
Auth: Existing JWT session
Response: { status: 'pending' | 'completed', result?: AgentResponse }
```

### 8.2 Discord → Orchestrator

The existing Discord bot gets a new slash command: `/ask <query>`. This command:
1. Resolves the Discord user to a Nexus user via `discord_user_links`
2. Writes an `agent_job` with `source_agent = 'user'`, `target_agent = 'orchestrator'`, `channel = 'discord'`
3. Defers the Discord reply
4. Polls `agent_jobs` for completion
5. Formats the result as a Discord embed and edits the deferred reply

### 8.3 Orchestrator → Discord (outbound)

When an agent produces a report autonomously (e.g., Small Cap scanner finds a match), the Orchestrator:
1. Writes the report to `agent_reports`
2. Enqueues a `notification_job` (existing pattern) with the report summary formatted for Discord
3. The existing notification processor delivers it

This means zero new Discord delivery infrastructure. We reuse `notification_jobs` and `sendDiscordDms`.

---

## 9. Docker Compose Additions

```yaml
# Added to existing services/docker-compose.yml

  orchestrator:
    build: ./agent-orchestrator
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - NDIA_API_KEY=${NDIA_API_KEY}
      - NDIA_BASE_URL=https://integrate.api.nvidia.com/v1
      - NDIA_MODEL=meta/llama-3.1-70b-instruct
      - POLYGON_API_KEY=${POLYGON_API_KEY}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
    depends_on:
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "healthcheck.js"]
      interval: 30s
      timeout: 10s
      retries: 3

  agent-small-cap:
    build: ./agent-small-cap
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - NDIA_API_KEY=${NDIA_API_KEY}
      - NDIA_BASE_URL=https://integrate.api.nvidia.com/v1
      - NDIA_MODEL=meta/llama-3.1-70b-instruct
      - POLYGON_API_KEY=${POLYGON_API_KEY}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
    depends_on:
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "healthcheck.js"]
      interval: 30s
      timeout: 10s
      retries: 3

  agent-long-term:
    build: ./agent-long-term
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - NDIA_API_KEY=${NDIA_API_KEY}
      - NDIA_BASE_URL=https://integrate.api.nvidia.com/v1
      - NDIA_MODEL=meta/llama-3.1-70b-instruct
      - POLYGON_API_KEY=${POLYGON_API_KEY}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
    depends_on:
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "healthcheck.js"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## 10. File Structure

```
services/
├── agent-orchestrator/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── healthcheck.js
│   └── src/
│       ├── index.ts              -- entry point, poll loop, cron setup
│       ├── router.ts             -- deterministic routing rules (Research Analyst logic)
│       ├── scheduler.ts          -- cron trigger management
│       └── synthesizer.ts        -- cross-agent report aggregation
│
├── agent-small-cap/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── healthcheck.js
│   └── src/
│       ├── index.ts              -- entry point, poll loop
│       ├── scanner.ts            -- pre-market scan logic
│       ├── dilution-analyzer.ts  -- SEC filing analysis
│       └── technical-analyzer.ts -- OHLCV pattern analysis
│
├── agent-long-term/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── healthcheck.js
│   └── src/
│       ├── index.ts              -- entry point, poll loop
│       ├── macro-analyzer.ts     -- economic regime identification
│       ├── sector-screener.ts    -- sector-to-name funnel
│       ├── portfolio-builder.ts  -- construction + suitability
│       └── thesis-manager.ts     -- thesis lifecycle CRUD
│
lib/agents/                        -- shared code (used by all services + Next.js app)
├── types.ts                       -- AgentDefinition, AgentJob, AgentReport interfaces
├── registry.ts                    -- registry.register(), heartbeat, health check
├── llm.ts                         -- callLLM wrapper
├── job-queue.ts                   -- claimJob, completeJob, failJob (mirrors notification-jobs.ts pattern)
├── memory.ts                      -- readMemory, writeMemory, queryMemory per agent
├── prompts/
│   ├── orchestrator.md
│   ├── small-cap.md
│   └── long-term.md
└── data/
    ├── polygon.ts                 -- Polygon.io client
    ├── askedgar.ts                -- AskEdgar client
    └── rate-limiter.ts            -- Postgres-based rate limiter

app/api/agents/
├── chat/route.ts                  -- User chat → agent_jobs
├── reports/route.ts               -- GET reports for user
└── health/route.ts                -- Agent registry status
```

---

## 11. Build Order

Sequential. Each step must pass validation before proceeding.

| Step | Description | Depends On |
|------|-------------|------------|
| 1 | Add env vars (POLYGON_API_KEY, ASKEDGAR_API_KEY, NDIA_API_KEY, NDIA_BASE_URL, NDIA_MODEL) | None |
| 2 | Remove `@google/genai` package | None |
| 3 | Create Drizzle migration for 5 new tables (agent_jobs, agent_memory, agent_reports, agent_conversations, agent_registry) | Step 1 |
| 4 | Implement `lib/agents/` shared code (types, registry, llm, job-queue, memory, data clients) | Step 3 |
| 5 | Implement Orchestrator service with routing rules + scheduler | Step 4 |
| 6 | Implement Small Cap Trader agent | Step 5 |
| 7 | Implement Long Term Investor agent | Step 5 |
| 8 | Add `/ask` slash command to Discord bot + channel adapter wiring | Step 5 |
| 9 | Implement web UI slide-out panel + API routes (`/api/agents/chat`, `/api/agents/reports`) | Step 5 |
| 10 | Integration testing: end-to-end job flow from user query through agent response | Steps 6-9 |
| 11 | Import historical research data into agent_memory | Step 6 |

Steps 6, 7, 8, and 9 can run in parallel after Step 5 is complete.

---

## 12. Security Considerations

- **Agent services connect to Postgres via `DATABASE_URL`** — same as existing services. No new auth mechanism needed.
- **API routes (`/api/agents/*`)** use existing JWT session auth for web users and scoped service JWTs for Discord bot.
- **LLM API key** (`NDIA_API_KEY`) is only accessible to Docker services and the Next.js server — never exposed to the client.
- **Agent memory isolation** is enforced at the application layer (agents filter by their own `agent_id`). Consider adding row-level security in Postgres if you later allow third-party agents.
- **Rate limiter** prevents agents from burning through Polygon.io quota, which could cause service degradation for the backtesting tab.
- **Report content** should include a standard disclaimer for any financial analysis. This is enforced in the output schema, not left to the LLM's discretion.

---

## 13. Deferred: Swing Trader Agent

You referenced a swing trader capability in the Orchestrator description (trending companies, sentiment from social media, news commentary). This is not in the current roster but the architecture supports adding it later by:

1. Creating `services/agent-swing-trader/`
2. Implementing the `AgentDefinition` interface
3. Calling `registry.register()` at startup
4. Adding routing rules in the Orchestrator's `router.ts`
5. Adding the new `agent_id` to the `agent_memory` and `agent_reports` queries

No schema changes required. The tables are agent-agnostic by design.

---

## 14. Open Questions (Require Your Input)

1. **Historical research format.** What format are your existing research reports in? (PDF, markdown, spreadsheet, plain text?) This determines the import script for Step 11.

2. **User profile storage.** The Long Term Investor needs age, time horizon, and goals. Where should this live — `agent_memory` under the Orchestrator, or a dedicated `user_profiles` table?

3. **Polygon tier confirmation.** Does your starter key give you pre-market snapshot data (`/v2/snapshot/locale/us/markets/stocks/tickers`)? The Small Cap scanner depends on this endpoint specifically.

4. **Discord notification scope.** Should autonomous reports (e.g., Small Cap scanner finds a match at 7:15 AM) go to a specific Discord channel, or DM the user directly?

5. **Financial disclaimers.** How prominent do you want the "this is not financial advice" language? Embedded in every report, or a one-time acknowledgment flow?
