# Nexus Terminal — Product Requirements Document

## Vision

A personal trading terminal that amplifies my team's ability to find, analyze, and execute trades. Not a SaaS competing with TradeZella or Tradervue — a private tool purpose-built for my coworkers and me, with AI agents that act as extra sets of eyes and ears on the market.

## Target Users

- Me (sole developer and primary user)
- Small group of coworkers (day/swing traders)
- All using TradingView, TraderVue, TradeZella, EdgeToTrade alongside this

## What Success Looks Like

Nexus Terminal is "done" when I open it every morning and it tells me:
1. What happened overnight (macro, sector moves, filings, news)
2. What my agents found (opportunities, pattern alerts, strategy signals)
3. How my recent trades performed (PnL, patterns, mistakes to avoid)
4. What my current strategies are doing (backtest results, refinements)

It replaces the 5-tab morning routine with one dashboard.

---

## Core Pillars

### 1. Trade Logging & Performance Analysis (Foundation — Partially Built)
Log every trade, tag it, and analyze performance over time.

**Must have:**
- CSV import from multiple brokers (DAS Trader, Schwab, generic)
- Manual trade entry
- PnL tracking per trade, per day, per week, per strategy
- Tag system for categorizing trades (setup type, ticker, conviction level)
- Performance charts (equity curve, win rate, R-multiple distribution)
- Journal entries attached to trades (what I was thinking, what went wrong)

**Status:** Core functionality exists. Needs polish and completeness.

### 2. Market Overview Dashboard (In Progress)
Clean view of what's happening in the market right now.

**Must have:**
- Current market themes and sector rotation
- Market sentiment indicators
- Market-moving news pieces (not noise — only what matters)
- Macro summary (Fed, economic data, earnings calendar)
- Data freshness — stale data is worse than no data

**Status:** Macro summary exists via cron. Daily ticker summaries exist. Needs better presentation and real-time freshness.

### 3. Research Reports (Active Development — Sprint 8)
On-demand dilution research using AskEdgar API for SEC filings.

**Must have:**
- Pull SEC filings (10-K, 10-Q, 8-K, S-1, etc.) for any ticker
- Generate research reports summarizing dilution risk
- Cache reports to avoid redundant API calls
- Clean, readable report UI

**Status:** AskEdgar integration in progress. Filing titles endpoint working. Full report pipeline being built.

### 4. Agent Team (Architecture Designed — Implementation Next)
Autonomous AI agents running as Docker Compose services on a home server, coordinated via Postgres job queue.

**V1 agents:**

| Agent | Role | Description |
|-------|------|-------------|
| Orchestrator | Coordination | Routes requests, runs macro cron, cross-agent synthesis, Discord bot |
| Small Cap Trader | Dilution research | Pre-market scans, dilution analysis, technical analysis via AskEdgar + Massive API |
| Swing Trader | Momentum plays | MDR pattern recognition, daily momentum scans, parabolic setup alerts |

**Key principles:**
- Each agent has strict scope boundaries — cross-agent data goes through the Orchestrator
- Level 1 supervised mode — all agent reports require user approval before action
- Blueprint-driven handlers — typed step sequences (code vs LLM) keep costs low and results reliable
- Provider-agnostic LLM wrapper — interchangeable providers (NVIDIA API, Groq, local llama.cpp)

**Status:** Architecture spec at `AGENTIC_EXPANSION_V2.md` (DRAFT R2). Nothing built yet.

---

## Non-Goals

- This is NOT a SaaS product — no billing, onboarding, marketing pages
- This is NOT competing with TradingView for charting — we use TradingView for that
- This is NOT an automated trading bot — agents advise, humans decide
- No mobile app — desktop browser is fine

## Technical Constraints

- Vercel Hobby tier (cron limited to daily, serverless function limits)
- Neon Launch plan for agent workloads
- Must stay within reasonable API costs (AskEdgar, Massive API, LLM calls)
- Solo developer — complexity must stay manageable

---

## Priority Order

1. **Finish research reports** (Sprint 8 — active)
2. **Build agent framework** (architecture designed in AGENTIC_EXPANSION_V2.md)
3. **Launch Orchestrator + Small Cap Trader** (first two agents, validate before adding Swing Trader)
4. **Polish trade logging & performance** (ongoing)
5. **Launch Swing Trader** (after first two agents prove stable)
6. **Market overview improvements** (alongside agent work)

---

## Metrics I Care About

- Jarvis response speed (< 3 seconds for chat, < 10 seconds for research)
- Data freshness (filings and market data < 1 hour stale during market hours)
- My own usage — if I stop opening it, something's wrong
- Agent signal quality — are they finding things I wouldn't have found myself?
