# AGENTIC_EXPANSION.md

**Status:** PLANNED — Implementation paused until final approval
**Owner:** Nexus Terminal Autonomous Expansion Program
**Created:** 2026-03-12
**Last Updated:** 2026-03-12

## Executive Summary

This plan defines a custom **OpenClaw-style** external agent service to run as a specialized autonomous team for Nexus Terminal. The system keeps Nexus Terminal as the authoritative product and adds a separate project (external) for orchestration, analysis, strategy research, and eventual controlled execution.

Recommended architecture:

- Build a **custom orchestrator-first external agent framework** (not a third-party multi-agent framework)
- Use **specialist agents** with orchestrator-mediated communication
- Start with **API-based LLM calls**, keep the codebase **LLM-provider-agnostic** for optional local migration later
- Start with **no live execution**, then phase in **Swing Trader Level 3 autonomy** only after 3 months of paper trading
- Integrate with Discord for full team/user conversation and control

## Strategic Decision Summary

- **Approach:** A + B hybrid from the previous analysis
  - Keep current Nexus/JARVIS hybrid architecture for existing platform value
  - Add external OpenClaw service for autonomous strategy discovery/refinement
- **LLM model policy:** Start API-first; design abstraction layer for future local LLM migration
- **Autonomy target:** Swing Trader = **Level 3**, others advisory/analytics only
- **Trading rollout:** **At least 3 months paper-only** before considering live execution
- **Discord:** Private server first, with owner + invite-limited friends access
- **Control:** Kill switch remains owner-only and tied to tight guardrails

---

## OpenClaw Architecture

### High-Level Layout

```
User (Discord / Nexus) -> Orchestrator -> Specialist Agents -> Nexus APIs

Agents:
- Orchestrator (hub)
- Researcher (data + filings + news)
- Dilutionary Trader (small cap dilution specialist)
- Long-term Investor (fundamental strategist)
- Swing Trader (technical + execution-capable)
- Analyst (synthesis + risk)
- Backtester (validation + metrics)

Memory -> centralized through Orchestrator -> persisted via Nexus endpoints
```

### Memory and Communication Pattern

- All inter-agent messages flow through the Orchestrator (no direct peer-to-peer chatter).
- Memory is written/read in one place by Orchestrator and injected by task context.
- Every agent receives constrained context; only relevant memory is passed.
- All important messages and decisions are persisted for explainability and auditability.

### Why Orchestrator-Mediated Communication

1. Prevents noisy autonomous loops
2. Creates deterministic approval/decision path
3. Simplifies kill-switch and budget enforcement
4. Keeps explainability/traceability per decision
5. Makes cost control practical (LLM calls only when needed)

---

## Plan Scope by Phase

## Phase 0 — Non-Implementation Gate

### Immediate Constraints (Before Phase 1)

- No Phase 1 coding or runtime deployment yet.
- Document architecture, file layout, workflows, and guardrails.
- Update API surface requirements in Nexus for eventual external integration.

### Decisions already confirmed

- Swing Trader = Level 3 autonomy target.
- Paper trading minimum: **3 months**.
- Broker integration is future work only; build scaffold/infra in advance.
- Discord command and conversation layer is required from day 1 of agent framework.
- Private Discord first; expand later.
- Kill switch is owner-only and tightly enforced.
- Specialist agents with time/skill activation windows.

---

## Phase 1 — Core Framework Foundation (Planned only)

### Sprint 1.1: Core OpenClaw services

- Orchestrator service entrypoint and shared runtime
- `AgentBase` abstraction
- `WorkflowEngine` and `DialogueManager`
- `LLMGateway` abstraction (provider interface with request/response DTOs)
- Deterministic context injection and response schemas

#### Deliverable modules (planned)

- `external/openclaw/src/core/orchestrator.ts`
- `external/openclaw/src/core/agent-base.ts`
- `external/openclaw/src/core/workflow-engine.ts`
- `external/openclaw/src/core/memory-hub.ts`
- `external/openclaw/src/core/dialogue-manager.ts`
- `external/openclaw/src/core/llm-gateway.ts`
- `external/openclaw/src/types/index.ts`

### Sprint 1.2: Safety primitives and guardrails

- Global and per-agent guardrails
- Decision gates before any trade action
- Kill switch with owner-only controls
- Circuit-breaker and anomaly-triggered stop conditions

### Sprint 1.3: Discord conversational layer (conversation-first)

- Slash commands
- Mention routing (`@Orchestrator`, `@SwingTrader`, etc.)
- Persistent thread storage
- Structured embeds / concise state updates
- Owner-only high-risk command gates

### Sprint 1.4: Nexus API integration contracts

- Add external service API endpoints in Nexus (authn, read/write strategy + trade context)
- Read-only default, minimal privilege model
- Signed request support / API key strategy

---

## Phase 2 — Specialist Agents & Workflows

### Sprint 2.1: Deterministic agents (lower cost)

- Researcher agent
  - EDGAR/news feed ingestion and normalization
  - Filings monitor and event triggers
- Backtester agent
  - Deterministic simulation + strategy score calculations

### Sprint 2.2: LLM-assisted research specialists

- Dilutionary Trader
- Long-term Investor
- Analyst (synthesis and contradiction resolution)

### Sprint 2.3: Swing Trader (execution-oriented)

- Technical analysis + confidence scoring
- Controlled trade construction (entry, stop, target, R/R)
- Paper trade path only (phase-gated)
- Optional confirmation windows before auto actions

### Sprint 2.4: Orchestrator strategy runtime and conflict control

- workflow templates:
  - strategy discovery
  - daily pre-market prep
  - execution monitoring
- confidence threshold + consensus/override checks
- escalation on conflict

---

## Phase 3 — Strategy Evolution & Lifecycle (Planned)

- Strategy lifecycle:
  1. discover
  2. filter
  3. backtest
  4. paper trade 90+ days
  5. review
  6. refine/version
  7. live (manual approval)

- Lineage tracking: each strategy version stores parent strategy and contributor agents
- Performance review gates (minimum samples, drawdown controls, win-rate checks)
- Agent scorecards for continual improvement

---

## Phase 4 — Production & Hardening (No immediate start)

- Containerized deployment for external project
- monitoring, logs, metrics, and alerting
- cost tracking dashboards
- graceful failover and restart policy
- staged deployment readiness for future broker integration

## Phase 5 — Broker integration (deferred)

- Planned architecture point only, no immediate implementation
- Build execution interfaces and strategy handoff contracts now
- Keep logic and policy layer independent from broker transport

---

## Agent Roles and Capabilities

### Orchestrator
- Role: director, scheduler, conflict resolver
- LLM usage: low/minimal
- Responsibilities:
  - assigns sub tasks
  - applies guardrails
  - composes final decision logs

### Researcher
- Role: market/news/filings scout
- LLM usage: none (deterministic)
- Responsibilities:
  - ingest sources
  - normalize and tag structured payloads
  - deliver event alerts

### Dilutionary Trader
- Role: small-cap dilution specialist
- LLM usage: high
- Responsibilities:
  - analyze float/warrants/offering risk
  - generate dilution risk report

### Long-term Investor
- Role: fundamentals and thesis validation
- LLM usage: high
- Responsibilities:
  - valuation checks
  - macro/sector positioning context
  - fundamental framing for strategy candidates

### Swing Trader
- Role: technical + execution specialization
- LLM usage: medium
- Responsibilities:
  - pattern and momentum setup generation
  - position plan creation
  - paper execution
  - strategy-specific execution logic
- **Autonomy:** Level 3 (execution-capable) only

### Analyst
- Role: synthesis and risk adjudication
- LLM usage: high
- Responsibilities:
  - aggregate multiple agent findings
  - flag contradictions
  - produce risk-aware recommendation

### Backtester
- Role: deterministic validation
- LLM usage: none
- Responsibilities:
  - run historical simulations
  - compute metrics (Sharpe, drawdown, win-rate)
  - output validation summaries for Analyst/Orchestrator

---

## Safety Model (Owner-First)

- **Kill switch owner-only** (manual hard stop)
- Global and agent-level ceilings for:
  - daily loss
  - open positions
  - position size
  - market hours
  - consecutive losses
- Orchestrator blocks unsafe actions before downstream agents act
- All trading actions are logged with explainability fields:
  - signal source
  - confidence
  - alternative considered
  - rationale
  - guardrail checks run

---

## Discord Experience

- Private guild with controlled roles
- Channels: orchestration, strategy discovery, paper-trade reports, admin
- Slash commands include:
  - `/ask`
  - `/discover`
  - `/status`
  - `/strategy`
  - `/backtest`
  - `/paper`
  - `/kill` (owner only)
  - `/metrics`
  - `/logs`

- Threaded conversations and agent mentions for directed routing

---

## Data Inputs to Agents

OpenClaw agents consume:

- User trade history from Nexus
- Current market context from existing sources
- Saved research and macro snapshots
- Volatility and regime indicators
- Journal/trade metrics from Nexus for feedback loops

---

## Cost Projection (Target)

| Component | Target Monthly | Notes |
|---|---:|---|
| OpenClaw compute/host | $25 - $40 | External deployment
| LLM API (API-first mode) | $40 - $65 | Orchestration + analysis + synthesis calls
| Data/API costs | $15 - $25 | Filings/research sources as used
| Optional Redis/cache | $0 - $15 | Optional for scaling
| Total | **$80 - $120** | within planned budget envelope |

---

## Local LLM Path (future)

- Keep LLM gateway as interface from phase zero, so migration requires no major redesign.
- Likely order:
  1. keep API for high-reasoning tasks
  2. shift deterministic and low-depth tasks toward local first
  3. evaluate hybrid with complexity thresholds per agent
- Migration is optional, staged, and can be postponed.

---

## Open Questions (Final Approval Required)

1. **Broker target path:** Schwab vs another broker API for eventual live execution
2. **GPU/LCLM migration timing:** now planning only or phase-gate after stable 60 days
3. **Initial friend access in Discord:** keep strictly owner-only for first months or allow 2-3 trusted users
4. **Strategy sharing model:** private-only vs possible future sharing mode
5. **Kill switch scope:** default should halt only Swing Trader or all agents
6. **Paper-trade minimum duration:** 3 months locked unless explicit exception
7. **Memory retention horizon:** e.g., 12 months with archive policy
8. **Auto-reporting frequency:** hourly digest vs event-based only

---

## Acceptance Criteria (Post-Approval)

- Phase 1 implemented only after all final approval answers
- No live trading enabled in first release
- End-to-end logs present for every agent decision
- Orchestrator can deny unsafe actions using guardrails
- 3-month paper-trade floor enforced before any live execution path

## Notes

- This document is the governing plan for the agentic expansion.
- `JARVIS_MASTER_UPDATE.md` has been replaced by this plan naming and stored as `AGENTIC_EXPANSION.md`.
- Phase implementation begins only after final approval and missing answers are resolved.
