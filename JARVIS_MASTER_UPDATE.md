# JARVIS_MASTER_UPDATE.md

## Executive Summary

**Architecture**: Hybrid single-LLM with state machine routing

**Budget**: $100/month (100 requests/day × 30 days × $0.033 avg = $99)

**Timeline**: 4 weeks (4 sprints)

**Discord**: New bot from scratch, bidirectional

**Pattern Analysis**: Async (30s tolerance)

**Filings Scope**: 10 tickers max

---

## Sprint 1: Foundation & Discord Bot

### Epic 1.1: Discord Infrastructure

- [ ] **1.1.1** Create Discord application & bot
- [ ] **1.1.2** Set up bot permissions (read/send messages, embeds, slash commands)
- [ ] **1.1.3** Implement Discord webhook handler `/app/api/discord/webhook/route.ts`
- [ ] **1.1.4** Create command parser (natural language → structured intent)
- [ ] **1.1.5** Add rate limiting (prevent spam, protect budget)

**Cost Impact**: $0 (Discord API free tier)

### Epic 1.2: State Machine Core

- [ ] **1.2.1** Create `lib/agent-workflow.ts` - workflow state management
- [ ] **1.2.2** Define workflow types: `chat`, `pattern_mine`, `filings_check`, `report_gen`, `strategy_build`
- [ ] **1.2.3** Implement task queue with PostgreSQL (`agent_workflows` table)
- [ ] **1.2.4** Add async worker pattern for long-running tasks
- [ ] **1.2.5** Create Discord notification service (progress updates, completions)

**New Tables**:

```sql
agent_workflows - workflow state
discord_sessions - user/channel context
```

### Epic 1.3: Cost Optimization Layer

- [ ] **1.3.1** Implement request classifier (routes to appropriate workflow)
- [ ] **1.3.2** Add Redis/caching layer for embeddings (avoid re-embedding)
- [ ] **1.3.3** Create token budget tracker (per-request and monthly)
- [ ] **1.3.4** Set up tiered model routing (cheap model for routing, DeepSeek for reasoning)

**Acceptance Criteria**:

- Bot responds to "hello" in Discord
- State machine persists workflow state
- Token tracking active

---

## Sprint 2: Pattern Mining & Filings Ingestion

### Epic 2.1: Pattern Mining Agent

- [ ] **2.1.1** Create `lib/pattern-miner.ts` - statistical analysis of trade history
- [ ] **2.1.2** Implement feature extraction (time-of-day, setup type, hold duration, tags)
- [ ] **2.1.3** Add clustering algorithm (k-means/DBSCAN) for pattern discovery
- [ ] **2.1.4** Create pattern embeddings and store in `trading_patterns` table
- [ ] **2.1.5** Build Discord command: `/analyze patterns [timeframe]`

**Cost Optimization**: Run once daily via cron, not per-request

**Estimated Cost**: $5/month (daily batch processing)

### Epic 2.2: EDGAR Filings Monitor

- [ ] **2.2.1** Create `lib/edgar-client.ts` - SEC EDGAR RSS feed parser
- [ ] **2.2.2** Implement ticker filtering (max 10 tickers)
- [ ] **2.2.3** Add filing type detection (10-K, 10-Q, 8-K)
- [ ] **2.2.4** Create structured ingestion pipeline (XBRL → text → chunks → embeddings)
- [ ] **2.2.5** Build Discord alert: "New 10-Q for AAPL"
- [ ] **2.2.6** Add Vercel cron: `/api/cron/filings-check` (runs every 6 hours)

**New Source Type**: `edgar_filing` in `jarvisKnowledgeChunks`

**Cost Impact**: $10/month (EDGAR scraping + embedding)

### Epic 2.3: Research Report Generator

- [ ] **2.3.1** Extend existing `runOrchestration` for filings context
- [ ] **2.3.2** Create filing analysis prompt template
- [ ] **2.3.3** Implement structured output: financial highlights, risks, trading implications
- [ ] **2.3.4** Build Discord command: `/report [ticker] [filing_type]`
- [ ] **2.3.5** Add rich embed formatting for Discord (charts, tables)

**Acceptance Criteria**:

- Pattern mining runs successfully on your trade history
- Bot alerts on new filings for monitored tickers
- Research reports posted to Discord with proper formatting

---

## Sprint 3: Strategy Generation & Advanced Features

### Epic 3.1: Strategy Synthesis Engine

- [ ] **3.1.1** Create `lib/strategy-builder.ts` - pattern-to-strategy mapper
- [ ] **3.1.2** Implement rule generation (entry/exit conditions from patterns)
- [ ] **3.1.3** Add backtest integration (reuse existing backtest infrastructure)
- [ ] **3.1.4** Create strategy versioning and metadata storage
- [ ] **3.1.5** Build Discord command: `/build-strategy from-pattern [pattern_id]`
- [ ] **3.1.6** Add strategy approval workflow (draft → review → activate)

**New Table**: `trading_strategies`

### Epic 3.2: Bidirectional Conversation

- [ ] **3.2.1** Enhance Discord command parser for natural language queries
- [ ] **3.2.2** Add conversation context persistence (thread-based)
- [ ] **3.2.3** Implement follow-up question handling
- [ ] **3.2.4** Create command shortcuts: `@Jarvis what's the pattern for AAPL?`
- [ ] **3.2.5** Add voice message transcription (optional, cost +$10/month)

### Epic 3.3: Cost Monitoring & Alerts

- [ ] **3.3.1** Create dashboard endpoint `/api/admin/costs` (tokens used, cost per day)
- [ ] **3.3.2** Add budget alerts (notify when 80% of monthly budget used)
- [ ] **3.3.3** Implement cost-saving modes (reduce context, use cheaper models)
- [ ] **3.3.4** Build Discord command: `/budget status`

**Acceptance Criteria**:

- Can generate a trading strategy from discovered patterns
- Natural conversation flow in Discord
- Budget tracking accurate to within $1

---

## Sprint 4: Polish, Testing & Deployment

### Epic 4.1: Testing & Quality

- [ ] **4.1.1** Write unit tests for pattern mining
- [ ] **4.1.2** Write integration tests for Discord webhook
- [ ] **4.1.3** Add load testing (simulate 100 requests/day)
- [ ] **4.1.4** Create test fixtures for EDGAR filings
- [ ] **4.1.5** Run lint, typecheck, tests (per AGENTS.md rules)

### Epic 4.2: Documentation & Monitoring

- [ ] **4.2.1** Document Discord bot commands in README
- [ ] **4.2.2** Create troubleshooting guide
- [ ] **4.2.3** Add Sentry/error tracking for Discord bot
- [ ] **4.2.4** Set up logging for workflow state transitions
- [ ] **4.2.5** Create admin commands: `/admin purge-cache`, `/admin stats`

### Epic 4.3: Deployment & Launch

- [ ] **4.3.1** Configure Discord bot for production
- [ ] **4.3.2** Set up environment variables (DISCORD_TOKEN, etc.)
- [ ] **4.3.3** Deploy to Vercel with new cron jobs
- [ ] **4.3.4** Run database migrations
- [ ] **4.3.5** Soft launch (invite-only Discord channel)

**Acceptance Criteria**:

- All tests passing
- Documentation complete
- Bot stable for 48 hours in production
- Monthly cost projection under $100

---

## Cost Breakdown (Monthly)

| Component | Daily Usage | Monthly Cost |
|-----------|-------------|--------------|
| Chat requests (70/day) | 70 × $0.02 | $42 |
| Pattern mining (1/day) | 1 × $0.15 | $4.50 |
| Filings analysis (3/day) | 3 × $0.05 | $4.50 |
| Strategy generation (5/week) | 5 × $0.20 | $4 |
| Embeddings (caching helps) | - | $10 |
| Discord API | Free tier | $0 |
| **Total** | | **$65** |
| **Buffer** | | $35 |
| **Total Budget** | | **$100** |

---

## Key Technical Decisions

1. **Single LLM**: Reuse existing DeepSeek via NVIDIA API, route with classifier
2. **Async Pattern Mining**: Cron job once daily, not real-time (saves cost)
3. **EDGAR RSS**: Poll every 6 hours, not streaming (rate limits + cost)
4. **Caching**: Aggressive caching of embeddings (trade history changes slowly)
5. **Discord Free Tier**: No need for Discord premium features

---

## Dependencies & Blockers

- **Discord.js** or **@discordjs/rest** for bot
- **ioredis** or **node-cache** for caching layer
- **cheerio** for EDGAR HTML parsing
- **Vercel Cron** (already available)
- **Existing**: pgvector, Drizzle, Next.js

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| LLM costs exceed budget | Token tracker + automatic fallback to cheaper model |
| EDGAR rate limiting | Exponential backoff, cache aggressively |
| Discord bot downtime | Webhook-based, stateless, auto-restart |
| Pattern mining too slow | Run async, notify when complete |
| Database bloat | Eviction policy on old embeddings |

---

## Architecture Overview

### Hybrid Single-LLM Architecture

```
User Request → Classifier (1 small LLM call)
                    ↓
        Task Router → Specialized Prompt + Context Assembly
                    ↓
        Single LLM Call with Structured Output
                    ↓
        Tool Execution (DB queries, calculations, Discord post)
```

### Why Hybrid?

- **Cost Efficiency**: 60-70% cheaper than true multi-agent
- **Leverages Existing**: Reuses `jarvis-orchestrator.ts` pattern
- **Scalable**: Can parallelize tool execution even with single LLM
- **Maintainable**: One codebase, one API key, unified logging

### Cost Optimizations

1. **Tiered Models**:
   - Classifier/routing: GPT-4o-mini ($0.60/M tokens)
   - Reasoning: DeepSeek-V3 ($1.00/M tokens)
   - Summarization: GPT-3.5 ($0.50/M tokens)

2. **Caching**:
   - Pattern embeddings: Cache for 24h
   - Filings: Cache EDGAR responses for 6h
   - Avoid re-embedding trade history repeatedly

3. **Batching**:
   - Group Discord notifications (don't post every micro-update)
   - Run pattern mining once/day, not per-request

4. **Smart Routing**:
   - Simple queries → direct RAG response (no LLM)
   - Complex queries → full orchestration

---

## Status

**NOT STARTED** - This document is a planning specification only. Do not begin implementation without explicit approval.

---

*Last Updated*: 2026-03-08
