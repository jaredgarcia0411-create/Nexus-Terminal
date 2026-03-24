# Agentic Expansion V2 — Revision 2 (Consolidated Plan)

> Generated: 2026-03-23 | Status: PLAN — Awaiting approval before implementation
> Supersedes: AE_V2_THOUGHTS.md (analysis absorbed), AGENTIC_EXPANSION_V2.md R1.1-R1.11 (decisions carried forward)

---

## What This Document Is

This is the final, consolidated implementation plan for the Nexus Terminal multi-agent system. It merges AGENTIC_EXPANSION_V2.md (the architecture spec), its Revision 1 amendments, and the AE_V2_THOUGHTS.md cost/gap analysis into a single source of truth.

**All work happens on feature branch `agents-v2`**, merged to `main` after full validation.

---

## Decisions Log (All Locked)

| Decision | Choice | Source |
|----------|--------|--------|
| Server OS | Native Ubuntu (fresh install) — NOT WSL2 | R2 (changed from R1.1) |
| Docker | Docker Engine native on Ubuntu | R2 |
| Neon plan | Launch plan from day one (~$5-10/mo) | R2 (changed from spec's free tier assumption) |
| Connection pooling | Use Neon's built-in PgBouncer (pooled connection string) — no self-hosted PgBouncer | R2 |
| LLM provider | Groq only (Llama 3.3 70B). No hybrid, no DeepSeek, no local models | R2 (simplified from R1.3) |
| Report delivery | Discord-first via per-channel webhooks | R1.2 |
| Supervised mode | Level 1.5 — reports posted as FYI, no approval gate | R1.1 |
| In-app approval UI | None in V1 (AgentReportQueue.tsx, AgentStats.tsx removed from plan) | R1.2 |
| Discord bot | Keep existing bot running until Orchestrator absorbs its commands, then retire | R2 |
| Orchestrator Discord | Bidirectional — bot listener built INTO the Orchestrator container (not separate service) | R2 |
| Discord user mapping | Hardcoded for V1 (discord_user_links table was dropped, not recreating) | R2 |
| Monitoring | No Prometheus/Grafana/Loki in V1. Docker stats + Discord #agent-system + admin API | R2 |
| Local LLM | No — API only | R1.1 |
| Schwab relay | Stays on Fly.io, untouched, no agent interaction | R2 |
| Git workflow | Feature branch `agents-v2`, merge to `main` after validation | R2 |
| Agent rollout | Orchestrator + Small Cap Trader first. Long Term Investor deployed after 1 week of stable operation | R2 |
| Jarvis cutover | Clean — Jarvis dies the moment agents go live (no parallel operation) | R2 |
| AskEdgar counter | Remove in-memory counter, rely on askedgar_cache table for deduplication | R2 |

---

## Revised Cost Model

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| Neon Launch | $5-10 | 0.25 CU x ~16hrs/day on trading days. Usage-based at $0.106/CU-hr |
| Groq LLM | $0-5 | ~500K tokens/month. Free tier (30 req/min, 100K tokens/day) may cover most usage |
| Electricity | $3-5 | Laptop 24/7 at ~50W |
| **Total** | **$8-20/mo** | Well under $30-40 budget |

**Why the AE_V2_THOUGHTS $75-150/mo estimate was wrong:** It projected 100K conversations/month. Real usage: 1 daily scan (~6 LLM calls, ~12K tokens) + 1 weekly macro (~10K tokens) + occasional chat (~5K tokens/day) = ~500K tokens/month total = under $1/month at Groq rates. Even 10x this is $10/month.

---

## Spec Corrections (Errors in Original)

| Error | Location | Fix |
|-------|----------|-----|
| "750 compute-hours/month" for Neon free tier | Section 5, line 247 | Actual limit: 100 CU-hours/month. Moot now — we're on Launch plan |
| NVIDIA API as default provider | Section 8, env vars | Replace with Groq. `AGENT_API_BASE_URL=https://api.groq.com/openai/v1` |
| WSL2 deployment instructions | R1.1, R1.9 | Replace with native Ubuntu instructions (see Phase 0) |
| `discord_user_links` table reference | R1.2, Section 19 | Table was dropped in migration 0003. Hardcode mapping for V1 |
| AskEdgar in-memory counter | `lib/jarvis/askedgar.ts` line ~21 | Remove `let callCount`. Cache table handles dedup |
| `host.docker.internal` for local LLM | Section 8.3 | Not applicable — no local LLM in V1. Remove reference |

---

## Phase 0: Ubuntu Server Setup

**Goal:** Fresh Ubuntu laptop is ready to run Docker containers 24/7.

### 0.1 System Configuration

```bash
# Disable sleep/suspend (laptop must stay awake)
sudo systemctl mask sleep.target suspend.target hibernate.target

# Verify it worked
systemctl status sleep.target  # should show "masked"

# Set hostname (optional, nice for logs)
sudo hostnamectl set-hostname nexus-server
```

### 0.2 Install Docker Engine

```bash
# Install Docker (official script)
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group (avoids sudo for every command)
sudo usermod -aG docker $USER

# Log out and back in for group change to take effect, then:
sudo systemctl enable docker
sudo systemctl start docker

# Verify
docker --version
docker compose version
docker run hello-world
```

### 0.3 Install Node.js + Clone Repo

```bash
# Install Node 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Clone and setup
git clone <your-repo-url> ~/Nexus-Terminal
cd ~/Nexus-Terminal
git checkout -b agents-v2
npm install
```

### 0.4 Network Configuration

```bash
# Use ethernet (not Wi-Fi) for reliability
# Verify connection
ip addr show

# If you need to access the laptop from other machines on your network:
# Note the IP address from the ethernet interface (e.g., 192.168.1.x)
```

### 0.5 Neon Upgrade

1. Log into [Neon Console](https://console.neon.tech)
2. Upgrade project to **Launch** plan
3. Go to Connection Settings → enable **Pooled connection** → copy the `-pooler` connection string
4. Update `services/.env` with the pooled connection string as `DATABASE_URL`

### 0.6 Discord Setup

Create these channels and webhooks in your Discord server:

| Channel | Purpose | Create Webhook? |
|---------|---------|----------------|
| `#orchestrator` | Two-way chat with Orchestrator (bot listens here) | No — bot uses gateway, not webhook |
| `#small-cap-scans` | Pre-market scan results | Yes |
| `#small-cap-research` | On-demand ticker research | Yes |
| `#macro-updates` | Daily/weekly macro analysis | Yes |
| `#thesis-tracking` | Thesis status updates | Yes |
| `#agent-system` | Health alerts, budget warnings, errors | Yes |

**To create a webhook:** Channel Settings → Integrations → Webhooks → New Webhook → Copy URL

Save webhook URLs — they go in `services/.env` in Phase 5.

### 0.7 Groq API Key

1. Go to [Groq Console](https://console.groq.com)
2. Create API key (or reuse existing Jarvis key if it's Groq)
3. Save as `AGENT_API_KEY` in `services/.env`

### Phase 0 Checklist

- [ ] Ubuntu sleep disabled
- [ ] Docker Engine installed and running
- [ ] Docker starts on boot (`systemctl enable docker`)
- [ ] Node 20 installed
- [ ] Repo cloned, `agents-v2` branch created
- [ ] Neon upgraded to Launch plan
- [ ] Pooled connection string copied
- [ ] 6 Discord channels created
- [ ] 5 Discord webhooks created (all except #orchestrator)
- [ ] Groq API key ready
- [ ] Laptop on ethernet

---

## Phase 1: Foundation (No Breaking Changes)

**Goal:** Create the shared agent library. No DB changes, no route changes, nothing breaks.

**Branch:** `agents-v2`

### Files to Create

| # | File | Purpose | Reuse From |
|---|------|---------|------------|
| 1 | `lib/agents/types.ts` | All type definitions: AgentId, JobType, Blueprint, StepInput/Output, configs | Rewrite from `lib/jarvis/types.ts` |
| 2 | `lib/agents/retry.ts` | `calculateBackoffMs(attempt)`, `shouldRetry()` | New |
| 3 | `lib/agents/llm-client.ts` | Provider-agnostic LLM wrapper with Groq support | Rewrite from `lib/jarvis/client.ts` |
| 4 | `lib/agents/circuit-breaker.ts` | Per-agent circuit breaker (5 failures = open, 60s reset) | Copy + modify `lib/jarvis/circuit-breaker.ts` |
| 5 | `lib/agents/rate-limit.ts` | Per-user rate limiting (30 req/hr) | Copy from `lib/jarvis/rate-limit.ts` |
| 6 | `lib/agents/admin.ts` | `requireAgentAdmin()` header check | Copy + rename from `lib/jarvis/admin.ts` |

### Key Changes from Jarvis Equivalents

**llm-client.ts** — The big rewrite:
- Remove streaming support (agents don't stream)
- Add provider detection from URL (Groq vs generic OpenAI-compatible)
- Return structured `LlmResponse` with token counts
- Per-agent circuit breaker reference (not module-level singleton)
- Env vars: `AGENT_API_KEY` (fallback `JARVIS_API_KEY`), `AGENT_API_BASE_URL`, `AGENT_MODEL`

**circuit-breaker.ts** — Minor change:
- Wrap in factory/class that takes `agentId` so each agent has independent state

### Validation

```bash
npm run lint && npx tsc --noEmit
```

---

## Phase 2: Schema & Migration

**Goal:** Add 5 new tables, modify `agent_memory`, run migration.

### 2.1 Schema Changes in `lib/db/schema.ts`

Add these 5 tables (exact schemas from AGENTIC_EXPANSION_V2.md Sections 3.1-3.5):

1. **`agent_registry`** — 3 rows max, tracks agent health/status
2. **`agent_jobs`** — Job queue with SKIP LOCKED polling. **Include `progress_note TEXT` column** (from R1.5)
3. **`agent_reports`** — Published research output, Discord-delivered
4. **`agent_conversations`** — Chat history (replaces `jarvis_conversations`). Includes `channel` column ('web' | 'discord')
5. **`agent_request_log`** — Token/cost tracking with `agent_id`, `model_used`, `estimated_cost_cents`

Modify **`agent_memory`**:
- Add `agent_id TEXT NOT NULL DEFAULT 'jarvis'`
- Drop old unique constraint `(user_id, category, key)`
- Add new unique constraint `(user_id, agent_id, category, key)`
- Add index on `(user_id, agent_id, category)`

### 2.2 Generate & Run Migration

```bash
npm run db:generate    # generates migration 0011
npm run db:migrate     # runs it
```

### 2.3 Seed Data

After migration, seed `agent_registry` with 3 rows:

```sql
INSERT INTO agent_registry (id, display_name, description, status, capabilities)
VALUES
  ('orchestrator', 'Orchestrator', 'Routes requests, runs macro cron, cross-agent synthesis', 'offline', '["chat", "macro-summary"]'),
  ('small-cap-trader', 'Small Cap Trader', 'Pre-market dilution scans, on-demand research', 'offline', '["research", "trade-analysis"]'),
  ('long-term-investor', 'Long Term Investor', 'Weekly macro analysis, daily thesis tracking', 'offline', '["macro-summary", "research"]');
```

Update existing agent_memory rows:

```sql
UPDATE agent_memory SET agent_id = 'orchestrator' WHERE agent_id = 'jarvis';
```

### Validation

```bash
npm run lint && npx tsc --noEmit
npm run db:studio  # visually verify tables exist
```

---

## Phase 3: Shared Agent Logic

**Goal:** Build the core runtime: job queue, worker loop, blueprint engine, memory, heartbeat.

### Files to Create

| # | File | Purpose | Reuse From |
|---|------|---------|------------|
| 7 | `lib/agents/db.ts` | DB connection factory for Docker (single pooled WebSocket, uses Neon pooler string) | New |
| 8 | `lib/agents/job-queue.ts` | `createJob()`, `pollForJob()` (SKIP LOCKED), `completeJob()`, `failJob()` | New |
| 9 | `lib/agents/token-tracking.ts` | `estimateCostCents()`, `logAgentRequest()` | Rewrite from `lib/jarvis/token-tracking.ts` |
| 10 | `lib/agents/memory.ts` | `readMemory()`, `writeMemory()`, `upsertMemory()` — all scoped by `agent_id` | Rewrite from `lib/jarvis/memory.ts` |
| 11 | `lib/agents/context.ts` | `buildAgentContext()` — trades, macro, scoped memory | Extend from `lib/jarvis/context.ts` |
| 12 | `lib/agents/prompts.ts` | `getSystemPrompt(agentId, mode)` — loads from .md files | Rewrite from `lib/jarvis/prompts.ts` |
| 13 | `lib/agents/prompts/orchestrator.md` | Orchestrator system prompt | New |
| 14 | `lib/agents/prompts/small-cap.md` | Small Cap Trader system prompt (dilution framework, technical patterns) | New |
| 15 | `lib/agents/prompts/long-term.md` | Long Term Investor system prompt (macro framework, portfolio theory) | New |
| 16 | `lib/agents/blueprint-runner.ts` | `runBlueprint()` — iterates steps, tracks tokens, updates progress_note | New |
| 17 | `lib/agents/config.ts` | `AGENT_CONFIGS` — agent definitions with blueprint resolvers | New |
| 18 | `lib/agents/heartbeat.ts` | `startHeartbeat()` — 30s interval, updates agent_registry | New |
| 19 | `lib/agents/worker.ts` | `startWorker()` — poll loop, graceful shutdown (SIGTERM/SIGINT) | New |
| 20 | `lib/agents/macro-cron.ts` | `startMacroCron()` — setInterval, catch-up logic, market holiday gate | Rewrite from Vercel cron |
| 21 | `lib/agents/discord-embed.ts` | Embed builders per report type (scan, research, macro, thesis, system alert) | New |
| 22 | `lib/agents/discord-delivery.ts` | `postToDiscord(webhookUrl, embed)` — simple fetch POST | New |

### Key Design Details

**db.ts** — Uses the Neon pooled connection string:
```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // pooler string from Neon
  max: 1,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
```

**job-queue.ts** — The SKIP LOCKED poll query (from spec Section 3.2). **Adaptive polling:** 5s when a job was found, 30s when idle. Saves Neon compute hours.

**worker.ts** — Graceful shutdown:
1. SIGTERM/SIGINT → stop accepting new jobs
2. Finish current job (or mark back to `queued` if > 30s)
3. Update agent_registry status → `'offline'`
4. Close DB pool
5. Exit

**macro-cron.ts** — Catch-up logic (from R1.4):
```
if today's macro summary missing AND hour < 14 → run
Check Massive API marketstatus first — no-op on weekends/holidays
```

**blueprint-runner.ts** — Accumulator pattern (from R1.5):
- Each step receives all previous steps' output (spread)
- Updates `progress_note` column before each step
- Tracks total tokens across all LLM steps

**discord-delivery.ts** — Simple webhook POST:
```typescript
async function postToDiscord(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
}
```

### Blueprint Definitions

Defined in `config.ts`. Each agent has blueprints (from spec Section 6.4):

**Small Cap Trader:**
- `small-cap:pre-market-scan` — 6 steps: fetch-snapshot → fetch-filings → analyze-dilution (LLM) → fetch-ohlcv → analyze-technicals (LLM) → assemble-report
- `small-cap:research` — 5 steps: fetch-ticker-data → fetch-filings → calculate-indicators → analyze-and-report (LLM) → assemble-report

**Orchestrator:**
- `orchestrator:chat` — 2 steps: route-or-handle → synthesize-response (LLM, only if needed)
- `orchestrator:macro-summary` — 4 steps: scrape-headlines → fetch-market-snapshot → generate-briefing (LLM) → save-summary

**Long Term Investor (Phase 5b):**
- `long-term:macro-scan` — 5 steps
- `long-term:thesis-check` — 3 steps

### Validation

```bash
npm run lint && npx tsc --noEmit
```

---

## Phase 4: API Routes

**Goal:** Create the new `/api/agents/*` endpoints on Vercel. These are the bridge between the web UI and the agent job queue.

### Routes to Create

| # | Route | Method | Purpose |
|---|-------|--------|---------|
| 23 | `/api/agents/chat` | POST | Create chat job → returns `{ job_id }` |
| 24 | `/api/agents/chat` | GET | Poll for result `?job_id=X` → returns `{ status, result?, progress_note?, error? }` |
| 25 | `/api/agents/reports` | GET | List reports `?status=pending_review&agent_id=X` |
| 26 | `/api/agents/reports/[id]` | GET | Get single report detail |
| 27 | `/api/agents/reports/[id]` | PATCH | Update status (for future use — Level 1.5 means reports are FYI) |
| 28 | `/api/agents/research` | POST | Create research job for specific ticker |
| 29 | `/api/agents/trade-analysis` | POST | Create trade analysis job |
| 30 | `/api/agents/admin/stats` | GET | Agent health, token usage, cost, budget tracking |
| 31 | `/api/agents/admin/memory` | GET/DELETE | View/purge agent memory |
| 32 | `/api/agents/macro-summary/latest` | GET | Latest macro summary |

### Chat Polling Flow (from spec Section 13)

1. Client POSTs `{ message, session_id?, agent_id? }` → server routes via deterministic rules → creates `agent_jobs` row → returns `{ job_id }`
2. Client polls GET every 2 seconds
3. Returns `{ status: 'completed', result }` or `{ status: 'processing', progress_note }` or `{ status: 'failed', error }`

### Routing Logic

```typescript
function routeToAgent(message: string, explicitAgentId?: string): AgentId {
  if (explicitAgentId && isValidAgentId(explicitAgentId)) return explicitAgentId;
  if (message.startsWith('/research ')) return 'small-cap-trader';
  if (message.startsWith('/analyze')) return 'small-cap-trader';
  if (message.startsWith('/macro')) return 'long-term-investor';
  if (message.startsWith('/thesis')) return 'long-term-investor';
  return 'orchestrator';
}
```

### Budget Alert Logic (in admin/stats)

When computing monthly stats, if `budgetUsedPercent > 80`, the Orchestrator's heartbeat loop posts a warning to `#agent-system` via webhook.

### All routes must use `requireUser()`

### Validation

```bash
npm run lint && npx tsc --noEmit
```

---

## Phase 5: Docker Infrastructure

**Goal:** Build and deploy Orchestrator + Small Cap Trader on the Ubuntu laptop.

### 5.1 Files to Create

| # | File | Purpose |
|---|------|---------|
| 33 | `services/agent.Dockerfile` | Single shared Dockerfile (tsx runtime) |
| 34 | `services/agent-entrypoint.ts` | Entry point — reads AGENT_ID, starts worker + cron if orchestrator |
| 35 | `services/docker-compose.agents.yml` | Agent services (separate from existing discord-bot compose) |
| 36 | `services/.env.example` | Template for all required env vars |

### 5.2 Dockerfile (tsx runtime, from R1.5)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --production
COPY lib/ ./lib/
COPY services/agent-entrypoint.ts ./services/
CMD ["npx", "tsx", "services/agent-entrypoint.ts"]
```

### 5.3 Docker Compose (agents only)

```yaml
# services/docker-compose.agents.yml
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
      - AGENT_API_BASE_URL=${AGENT_API_BASE_URL:-https://api.groq.com/openai/v1}
      - AGENT_MODEL=${AGENT_MODEL:-llama-3.3-70b-versatile}
      - AGENT_POLL_INTERVAL_MS=${AGENT_POLL_INTERVAL_MS:-5000}
      - ASKEDGAR_API_KEY=${ASKEDGAR_API_KEY}
      - MASSIVE_API_KEY=${MASSIVE_API_KEY}
      - MACRO_CRON_HOUR=6
      - DISCORD_BOT_TOKEN=${DISCORD_BOT_TOKEN}
      - DISCORD_CHANNEL_ORCHESTRATOR=${DISCORD_CHANNEL_ORCHESTRATOR}
      - DISCORD_WEBHOOK_SYSTEM=${DISCORD_WEBHOOK_SYSTEM}
      - DISCORD_WEBHOOK_MACRO=${DISCORD_WEBHOOK_MACRO}
      - AGENT_MONTHLY_BUDGET_CENTS=${AGENT_MONTHLY_BUDGET_CENTS:-4000}
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
      test: ["CMD", "sh", "-c", "test -f /tmp/healthy && find /tmp/healthy -mmin -2 | grep -q ."]
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
      - AGENT_API_KEY=${AGENT_API_KEY}
      - AGENT_API_BASE_URL=${AGENT_API_BASE_URL:-https://api.groq.com/openai/v1}
      - AGENT_MODEL=${AGENT_MODEL:-llama-3.3-70b-versatile}
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
      test: ["CMD", "sh", "-c", "test -f /tmp/healthy && find /tmp/healthy -mmin -2 | grep -q ."]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 5.4 Environment File Template

```bash
# services/.env
DATABASE_URL=postgresql://...@...neon.tech/neondb?sslmode=require  # USE POOLER STRING

# LLM (Groq)
AGENT_API_KEY=gsk_...
AGENT_API_BASE_URL=https://api.groq.com/openai/v1
AGENT_MODEL=llama-3.3-70b-versatile

# Data APIs
ASKEDGAR_API_KEY=...
MASSIVE_API_KEY=...

# Discord Webhooks
DISCORD_BOT_TOKEN=...
DISCORD_CHANNEL_ORCHESTRATOR=...  # channel ID, not webhook
DISCORD_WEBHOOK_SCANS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_RESEARCH=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_MACRO=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_THESIS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_SYSTEM=https://discord.com/api/webhooks/...

# Budget
AGENT_MONTHLY_BUDGET_CENTS=4000  # $40/month hard cap for alerts
```

### 5.5 Deploy

```bash
cd ~/Nexus-Terminal/services
cp .env.example .env
# Fill in .env with real values

docker compose -f docker-compose.agents.yml build
docker compose -f docker-compose.agents.yml up -d

# Verify
docker compose -f docker-compose.agents.yml ps
docker compose -f docker-compose.agents.yml logs -f orchestrator
# Check Discord #agent-system for startup message
```

### 5.6 Stale Job Reaper (Orchestrator)

The Orchestrator runs every 5 minutes (from R1.4):
```sql
UPDATE agent_jobs SET status = 'queued', started_at = NULL
WHERE status = 'processing' AND started_at < now() - interval '5 minutes';
```

### Validation

- Both containers show `healthy` in `docker compose ps`
- Agent rows in `agent_registry` show `status = 'online'`
- `last_heartbeat` updating every 30s
- Startup message appears in Discord `#agent-system`

---

## Phase 5b: Long Term Investor (After 1 Week)

**Goal:** Deploy third agent after Orchestrator + Small Cap Trader prove stable.

### Prerequisites
- Phase 5 running for at least 1 week
- No unresolved errors in `#agent-system`
- Pre-market scans completing successfully
- Budget tracking shows costs within expectations

### Steps
1. Add `long-term-investor` service to `docker-compose.agents.yml` (same pattern as small-cap-trader, add `DISCORD_WEBHOOK_MACRO` and `DISCORD_WEBHOOK_THESIS`)
2. `docker compose -f docker-compose.agents.yml up -d long-term-investor`
3. Verify heartbeat, test with `/macro` command in `#orchestrator`

---

## Phase 6: Frontend

**Goal:** Replace Jarvis UI with Agent UI.

### Files to Create

| # | File | Purpose | Replaces |
|---|------|---------|----------|
| 37 | `components/trading/AgentChat.tsx` | Polling-based chat with agent selector, progress indicator | `JarvisChat.tsx` |
| 38 | `components/trading/AgentTab.tsx` | Wraps AgentChat. Just chat in V1 (no Reports/Stats sub-tabs) | `JarvisTab.tsx` |

### Files to Rename (content carried forward, just renamed)

| Old | New |
|-----|-----|
| `JarvisStructuredResponse.tsx` | `AgentStructuredResponse.tsx` |
| `JarvisDilutionReport.tsx` | `AgentDilutionReport.tsx` |
| `JarvisMacroSummary.tsx` | `AgentMacroSummary.tsx` |

### Sidebar Change

In `components/trading/Sidebar.tsx`:
- Tab key `'jarvis'` → `'agents'`
- Label "Jarvis" → "Agents"
- No badge count in V1

### AgentChat.tsx Key Differences from JarvisChat.tsx

- **Polling** instead of SSE streaming (POST creates job, GET polls for result)
- **Agent selector** dropdown (Orchestrator, Small Cap Trader, Long Term Investor)
- **Progress indicator** — shows `progress_note` while job is processing ("Step 2/6: Fetching filings...")
- **No streaming tokens** — response appears all at once when job completes

### Validation

```bash
npm run lint && npx tsc --noEmit
npm run dev  # test chat locally
```

---

## Phase 7: Clean Cutover & Cleanup

**Goal:** Remove all Jarvis code. This is the point of no return.

**This happens in a single deploy (from R1.6):**

### Step 1: Run Migration 0011 (already done in Phase 2)

Verify data migrated:
- `agent_conversations` has data from `jarvis_conversations`
- `agent_request_log` has data from `jarvis_request_log`
- `agent_memory` rows have `agent_id = 'orchestrator'`

### Step 2: Delete Jarvis Files (~22 files)

```
# API routes
app/api/jarvis/chat/route.ts
app/api/jarvis/chat/stream/route.ts
app/api/jarvis/research/route.ts
app/api/jarvis/trade-analysis/route.ts
app/api/jarvis/admin/memory/route.ts
app/api/jarvis/admin/stats/route.ts
app/api/jarvis/macro-summary/latest/route.ts
app/api/jarvis/cron/macro-summary/route.ts

# Library
lib/jarvis/client.ts
lib/jarvis/types.ts
lib/jarvis/prompts.ts
lib/jarvis/context.ts
lib/jarvis/memory.ts
lib/jarvis/research.ts
lib/jarvis/trade-analysis.ts
lib/jarvis/token-tracking.ts
lib/jarvis/circuit-breaker.ts
lib/jarvis/admin.ts
lib/jarvis/rate-limit.ts
lib/jarvis/historical-summary.ts
lib/jarvis/scrape-lite.ts

# Frontend
components/trading/JarvisChat.tsx
components/trading/JarvisTab.tsx
```

**Keep (moved to shared):** `lib/jarvis/askedgar.ts` → move to `lib/askedgar.ts` (used by agent blueprints and `/api/askedgar/*` routes)

### Step 3: Migration 0012 — Drop Legacy Tables

```sql
DROP TABLE jarvis_conversations;
DROP TABLE jarvis_request_log;
```

### Step 4: Remove Vercel Macro Cron

Delete the cron config for `/api/jarvis/cron/macro-summary` (now runs inside Orchestrator container).

### Step 5: Deploy to Vercel

Push `agents-v2` branch. Verify everything works. Merge to `main`.

### Validation

```bash
npm run lint && npx tsc --noEmit
npm run build  # full production build must pass
```

---

## Phase 8: Discord Bot Retirement (Future)

**Goal:** Fold existing Discord bot commands into the Orchestrator, then retire the bot.

**Not in initial launch.** The existing bot (`services/discord-bot/`) keeps running alongside agents. When ready:

1. Map existing bot commands to Orchestrator handlers:
   - `/journal` → Orchestrator reads trades, formats response
   - `/sync` → Orchestrator triggers Discord report import
   - `/stats` → Orchestrator queries admin stats
   - `/pnl` → Orchestrator calculates P&L
   - `/alert` → Orchestrator manages alerts
2. Remove `discord-bot` service from compose
3. Delete `services/discord-bot/` directory
4. Remove Redis service from compose (only used by the bot)

---

## Complete File Inventory

### Files to CREATE (38)

```
# Phase 1: Foundation (6)
lib/agents/types.ts
lib/agents/retry.ts
lib/agents/llm-client.ts
lib/agents/circuit-breaker.ts
lib/agents/rate-limit.ts
lib/agents/admin.ts

# Phase 3: Shared Logic (16)
lib/agents/db.ts
lib/agents/job-queue.ts
lib/agents/token-tracking.ts
lib/agents/memory.ts
lib/agents/context.ts
lib/agents/prompts.ts
lib/agents/prompts/orchestrator.md
lib/agents/prompts/small-cap.md
lib/agents/prompts/long-term.md
lib/agents/blueprint-runner.ts
lib/agents/config.ts
lib/agents/heartbeat.ts
lib/agents/worker.ts
lib/agents/macro-cron.ts
lib/agents/discord-embed.ts
lib/agents/discord-delivery.ts

# Phase 4: API Routes (10)
app/api/agents/chat/route.ts
app/api/agents/reports/route.ts
app/api/agents/reports/[id]/route.ts
app/api/agents/research/route.ts
app/api/agents/trade-analysis/route.ts
app/api/agents/admin/stats/route.ts
app/api/agents/admin/memory/route.ts
app/api/agents/macro-summary/latest/route.ts

# Phase 5: Docker (4)
services/agent.Dockerfile
services/agent-entrypoint.ts
services/docker-compose.agents.yml
services/.env.example

# Phase 6: Frontend (2)
components/trading/AgentChat.tsx
components/trading/AgentTab.tsx
```

### Files to MODIFY (5)

```
lib/db/schema.ts                  -- 5 new tables, alter agent_memory
components/trading/Sidebar.tsx    -- jarvis → agents tab
lib/jarvis/askedgar.ts            -- remove in-memory counter (then move to lib/askedgar.ts in Phase 7)
JarvisStructuredResponse.tsx      -- rename to AgentStructuredResponse.tsx
JarvisDilutionReport.tsx          -- rename to AgentDilutionReport.tsx
JarvisMacroSummary.tsx            -- rename to AgentMacroSummary.tsx
```

### Files to DELETE (~22, Phase 7)

All `lib/jarvis/*` (except askedgar.ts which moves), all `app/api/jarvis/*`, `JarvisChat.tsx`, `JarvisTab.tsx`.

---

## Environment Variables (Final)

### New (agents)

| Variable | Default | Used By |
|----------|---------|---------|
| `AGENT_API_KEY` | falls back to `JARVIS_API_KEY` | All agents |
| `AGENT_API_BASE_URL` | `https://api.groq.com/openai/v1` | All agents |
| `AGENT_MODEL` | `llama-3.3-70b-versatile` | All agents |
| `AGENT_LLM_TIMEOUT_MS` | `30000` | All agents |
| `AGENT_POLL_INTERVAL_MS` | `5000` | All agents |
| `AGENT_ID` | required per service | Each Docker service |
| `AGENT_ADMIN_KEY` | falls back to `JARVIS_ADMIN_KEY` | Next.js app |
| `AGENT_MONTHLY_BUDGET_CENTS` | `4000` | Orchestrator |
| `MACRO_CRON_HOUR` | `6` | Orchestrator |
| `DISCORD_CHANNEL_ORCHESTRATOR` | required | Orchestrator |
| `DISCORD_WEBHOOK_SCANS` | required | Small Cap Trader |
| `DISCORD_WEBHOOK_RESEARCH` | required | Small Cap Trader |
| `DISCORD_WEBHOOK_MACRO` | required | Long Term Investor |
| `DISCORD_WEBHOOK_THESIS` | required | Long Term Investor |
| `DISCORD_WEBHOOK_SYSTEM` | required | Orchestrator |

### Kept (existing)

`DATABASE_URL`, `ASKEDGAR_API_KEY`, `MASSIVE_API_KEY`, `DISCORD_BOT_TOKEN`

### Deprecated (fallback only)

`JARVIS_API_KEY`, `JARVIS_API_BASE_URL`, `JARVIS_MODEL`, `JARVIS_ADMIN_KEY`, `CRON_SECRET`

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Neon compute overages | Low | Medium | Adaptive polling (5s→30s idle), Launch plan has no hard ceiling — just costs more |
| Groq rate limiting on free tier | Medium | Low | 100K tokens/day limit. If hit, responses queue until reset. Paid tier removes limits (~$1-5/mo) |
| Laptop loses power/network | Medium | Low | `restart: unless-stopped` auto-recovers. Catch-up logic handles missed scans. Reports resume, nothing is lost |
| Agent produces bad analysis | Medium | Medium | Level 1.5 — reports are FYI in Discord. User reads and decides. No automated trading |
| Migration breaks Jarvis | Low | High | Clean cutover (R1.6). All changes in one deploy. Feature branch tested before merge |
| Docker containers eat too much RAM | Low | Medium | 512M limits per container. 3 agents = 1.5GB. 16GB laptop has plenty of headroom |

---

## Deferred to V2+

- In-app report approval queue (AgentReportQueue.tsx)
- In-app stats dashboard (AgentStats.tsx)
- Discord reaction-based approval
- Opening bell trigger (market open scan)
- Swing Trader agent
- Prometheus/Grafana/Loki monitoring stack
- Auto-deploy script (currently manual `docker compose build && up`)
- Discord user mapping table (hardcoded for V1)

---

## Summary

| Phase | What | Files | Depends On |
|-------|------|-------|------------|
| **0** | Ubuntu server setup, Neon upgrade, Discord channels | 0 code | Nothing |
| **1** | Foundation types + utilities | 6 | Phase 0 |
| **2** | DB schema + migration | 1 modified | Phase 1 |
| **3** | Core agent runtime | 16 | Phase 2 |
| **4** | API routes | 8 | Phase 3 |
| **5** | Docker deploy (Orchestrator + Small Cap) | 4 | Phase 4 |
| **5b** | Long Term Investor deploy | 0 new (config change) | Phase 5 + 1 week |
| **6** | Frontend (AgentChat, AgentTab, sidebar) | 2 new + renames | Phase 4 |
| **7** | Jarvis cleanup + legacy table drop | 22 deleted | Phase 5 + 6 verified |
| **8** | Discord bot retirement (future) | deletes | Phase 7 stable |

**Total new code:** ~38 files across `lib/agents/`, `app/api/agents/`, `services/`, `components/trading/`
**Estimated monthly cost:** $8-20 (well under $30-40 budget)
**Feature branch:** `agents-v2` → merge to `main` after full validation
