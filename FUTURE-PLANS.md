# Nexus Terminal — Future Plans

Brainstorming and planned features captured across sessions so they don't get lost.

---

## Trade Journal Enrichment (from Notion Gap Analysis, 2026-03-25)

Nexus captures execution mechanics well (prices, quantities, MFE/MAE, exit efficiency) but lacks the qualitative trade analysis fields that drive improvement. These fields exist in Jared's Notion "Trading Second Brain" D1 Trade Log but aren't in Nexus.

### Option 1: Structured Fields — Add Notion columns to Nexus trades

Add 4 new fields to the `trades` table:

| Field | Type | Values |
|-------|------|--------|
| `grade` | select | A+, A, B+, B, C+, C, D, F |
| `setupType` | select | AH GAPPER, 7 AM GAPPER, 4 AM GAPPER, JOIN UP, INTRADAY PARA |
| `errors` | multi-select (JSON array) | EARLY ENTRY, LATE ENTRY, EARLY ADD, LATE ADD, EARLY COVER, LATE COVER, OVERSIZING, UNDERSIZING, NO TRIGGERS, MISSED TRIGGERS, TRADING P&L, FOLLOWED BLINDLY, MISSED ENTIRELY, DID NOT FIT, MISCLICK, TRAILED TOO TIGHT |
| `agenda` | multi-select (JSON array) | ATM, GTG S1, EQUITY LINE, INDUCEMENT, CASHLESS WARRANTS, ITM WARRANTS, ITM CONVERTS, DID NOT FIT |

**UI changes:**
- TradeDetailSheet gets new editable fields (dropdowns/multi-selects alongside notes)
- Performance tab gets new breakdowns: P&L by Setup Type, Most Common Errors, Grade Distribution, Performance by Agenda

**Why this matters:** Unlocks analytics that neither Notion nor current Nexus can do — e.g., "what's my win rate on ATM agenda trades?" or "how often does EARLY ENTRY cost me?"

**Effort:** ~2-3 sessions (schema migration, PATCH route update, UI for each field, new performance charts)

---

### Option 2: Full Journal Migration — Option 1 + Daily/Weekly Review in Nexus

Everything from Option 1, plus:

**Daily Review Card (DRC):**
- New DB table: `dailyReviews` (userId, date, followedProcess, riskedAccordingly, thoughts, goals, grossResult, netResult)
- Collapsible "Daily Review" section in JournalTab when expanding a day
- Questions match Notion DRC: Did I follow process? Did I risk accordingly? Missed trades? Thoughts? Goals?
- Chart upload/annotation support

**Weekly Review:**
- New DB table: `weeklyReviews` (userId, weekStart, weekEnd, rResults per day, whatWorked, whatDidnt, cycleNotes, goalsNextWeek)
- Section in Performance tab with auto-populated weekly R totals + reflection questions

**Additional trade fields:**
- `hodTime` — select (30-min buckets from 7:00 to 16:00) — when the name topped
- `lodTime` — select (same buckets) — when the name bottomed

**Why this matters:** Nexus fully replaces Notion for trading workflow. Reviews sit next to actual execution data.

**Effort:** ~4-5 sessions. Can be phased — do Option 1 first, then add reviews.

---

## Notes

- Option 1 is the recommended starting point — biggest analytical value for the effort
- Option 2 can layer on top later once Option 1 is in use and we know if Notion reviews should migrate
- The `tags` system already in Nexus could partially cover setup type and errors, but dedicated structured fields are better for analytics (consistent values, filterable, chartable)
- R-multiple tracking already works if `initialRisk` is set — consider a user-level default risk setting so it doesn't need to be entered per trade

---

## Market Pulse Bot — Daily Gap Scanner Summary (2026-04-06)

**Goal:** Automated end-of-day market summary posted to Discord — gap scanner stats, multiday runners, and AI-generated analysis. Modeled after the "Market Pulse" Discord bot format.

### Data Pipeline

```
4:30 PM ET cron trigger
    |
    +- 1. Query TradingView screener for today's 30%+ gappers
    |     (gap%, VWAP, float, volume, sector, industry, country)
    |
    +- 2. For each gapper, fetch OHLCV from Polygon/Massive
    |     (compute: open-to-high, open-to-low, open-to-close, close vs VWAP)
    |
    +- 3. Query TradingView for multiday runners (Perf.1M > 100%)
    |
    +- 4. Store results to DB (new `daily_scanner` table)
    |
    +- 5. Compute rolling stats from stored history (90-day, 5-day)
    |
    +- 6. Feed stats to LLM -> generate AI analysis narrative
    |
    +- 7. Post to Discord via webhook
```

### Data Sources (3 APIs, already have 2)

| Data Need | Source | Key | Cost |
|-----------|--------|-----|------|
| Daily gapper list (gap%, OHLC, volume, sector, industry, country, float, VWAP) | TradingView Screener (existing route) | `TRADINGVIEW_SESSION_ID` (have it) | Free |
| OHLCV + VWAP per ticker (for open-to-high/low/close stats) | Polygon/Massive | `MASSIVE_API_KEY` (have it) | Free (5 calls/min) |
| Float per ticker (backup if TradingView float is spotty) | FMP | Need to sign up | Free (250 calls/day) |

### TradingView Screener Fields to Add

Current route (`/api/tradingview/gainers`) only pulls 7 fields. Expand to include:
- `gap` — server-computed gap % (open vs prev close)
- `VWAP` — volume-weighted average price
- `float_shares_outstanding` — float
- `country` — country of listing
- `open`, `high`, `low` — full OHLC (already have `close`)
- `Perf.1M` — 30-day performance (for multiday runner scan)
- `premarket_change`, `premarket_volume` — pre-market stats

### What Already Exists in the Codebase

- TradingView screener route: `/api/tradingview/gainers/route.ts`
- Polygon/Massive API key: `MASSIVE_API_KEY` env var
- Cron infrastructure: `vercel.json` cron config, `requireCronSecret()` in `lib/server-db-utils.ts`
- LLM client: `lib/llm-client.ts` (`callLlm`, `callLlmStreaming`)
- Discord client: `lib/discord/client.ts` (read-only — need to add webhook for posting)

### What Needs to Be Built

1. **New DB table** — `daily_scanner` to store each day's gapper results (enables rolling 90-day stats)
2. **New cron route** — `/api/cron/market-summary` triggered at 4:30 PM ET
3. **Discord webhook** — add POST capability (just a webhook URL, no bot code needed)
4. **Expanded TradingView query** — add the extra columns listed above
5. **Stat computation** — SQL aggregation over stored history for rolling stats
6. **LLM prompt template** — structured prompt that produces the AI analysis narrative
7. **FMP API integration** — sign up for free key, add float lookup as backup

### Output Format (4 sections posted to Discord)

1. **Gap Scanner Summary** — 90-day rolling stats (total gappers, median gap%, % below VWAP, % below open, open-to-high/low/close medians with std dev, % made new HOD after 11am, % broke PM high)
2. **Gap Scanner Results** — last 5 trading days stats + table of gappers >= 50% (symbol, date, gap%, close color, volume, float, range, industry, country)
3. **Multiday Runners** — stocks up 100%+ over 30 days (symbol, price, 30d%, avg vol, float, industry, country, run start date, catalyst)
4. **AI Analysis on Market Strength** — LLM-generated narrative: overall strength, themes, expectations, market strength rating (Strong/Neutral/Weak)

### Limitations

- **TradingView screener is live-only** — no historical lookback. Must snapshot and store daily. 90-day history builds up over time.
- **Pre-market OHLC** (PM high/low/open) not available from screener — only PM change/volume. "% Broke Premarket High" stat needs Polygon intraday data ($29/mo).

### Cost Tiers

| Scenario | Monthly Cost |
|----------|-------------|
| Start free (TradingView + Polygon free + FMP free) | $0 |
| Add pre-market intraday data (Polygon Starter) | $29/mo |
| Add FMP paid (if 250 call/day limit hit) | +$19/mo |

---

## Local AI Agent Research (2026-04-06)

### Summary

Investigated running local LLMs (Hermes, Gemma 4, Llama 3.x) for personal assistant and trading agent use.

### Key Findings

- **Local models are good for:** drafting content, brainstorming, summarizing pasted text, structured output, general Q&A
- **Local models are bad at:** multi-step tool chaining (60-70% reliability vs 90%+ cloud), long context (8-32K vs 200K), agentic autonomy
- **Gemma 4 (27B):** Impressive for size but doesn't match 70B+ models on hard tasks. Tool use is fragile.
- **Mini PC clusters:** Not practical — network latency kills throughput. Get one bigger machine instead.
- **Sweet spot hardware:** M4 Mac Mini 32GB ($900) or desktop + RTX 3060 12GB ($800) for 8B-13B models
- **Best free cloud inference:** Google AI Studio, Groq, Cerebras — all OpenAI-compatible APIs

### Recommendation

Use cloud APIs (Claude) for production trading agents. Local models for privacy-sensitive drafting/brainstorming only. Cloud inference APIs (Groq, Google AI Studio, OpenRouter) are cheaper and more reliable than self-hosted hardware.

### Cloud Inference Providers

| Provider | Free Tier | Best For |
|----------|-----------|----------|
| Google AI Studio | Generous free | Gemma/Gemini, general tasks |
| Groq | Rate-limited free | Extremely fast inference |
| Cerebras | Rate-limited free | Fast inference |
| OpenRouter | Pay-per-token | One API key for dozens of models |

### Model Routing Strategy

Use different models for different tasks based on complexity:
- **Simple parsing/structured output** -> cheap/fast model (Gemma 12B via Groq, free)
- **Research summaries/TLDRs** -> mid-tier model (Gemini Flash via Google AI Studio, free)
- **Complex reasoning/analysis** -> Claude API (existing `lib/llm-client.ts`)

---

## Agent Memory — Investigate Graphiti & Letta (2026-04-07)

**Context:** AEV2 already has a working memory layer in `agent_memory_v2` (Postgres KV scoped by user+agent+category, see `lib/agents/memory.ts` and `lib/agents/types.ts:36-47`). For most trading-agent needs this is the right call — simple, queryable, auditable. Surveyed the broader landscape (mem0, Letta, Zep/Graphiti, Cognee, mempalace) and identified two systems worth revisiting **only when a specific limitation is hit**, not preemptively.

### Trigger 1: Temporal pattern queries -> investigate Graphiti

**When to revisit:** When an agent (Small Cap or Swing) needs to answer questions like *"did the MDR runner setup work in Q1 but stop working after April?"* or *"what did I think about TSLA's float in February vs now?"* — questions where the **time validity of a fact** matters, not just its current value.

**Why Graphiti specifically:**
- Bitemporal knowledge graph — every edge has `valid_from` / `valid_to` timestamps, so old facts aren't overwritten, they're superseded
- OSS core of Zep (note: Zep Community Edition was deprecated in 2025 — Graphiti is the path forward)
- Backend options: Neo4j or FalkorDB (FalkorDB is lighter, better for sidecar deployment)
- Repo: https://github.com/getzep/graphiti

**Integration shape:** Run as a sidecar container in `services/docker-compose.yml`. One graph namespace per agent. Agents call it via REST. Would coexist with `agent_memory_v2`, not replace it — KV for current facts, graph for "facts over time."

**Don't add until:** You write a SQL query against `agent_memory_v2` and realize you can't express the temporal dimension cleanly.

### Trigger 2: Agent self-editing memory -> investigate Letta

**When to revisit:** When you want agents to **autonomously decide what to remember** rather than having `context.ts` and blueprint code do all the writes. Today, memory writes happen in code paths you control. Letta's pitch is that the agent itself calls memory tools mid-conversation to update its own state.

**Why Letta specifically:**
- Built on the MemGPT paper — OS-style memory hierarchy: *core memory* (always in context, agent-editable), *recall memory* (conversation history, searchable), *archival memory* (long-term external store, searchable)
- Agents are first-class REST services with Postgres persistence — matches the Neon stack
- Docker-native, has an Agent Development Environment (ADE) GUI for inspecting memory state
- Repo: https://github.com/letta-ai/letta

**Integration shape:** Bigger lift than Graphiti — Letta wants to *be* the agent runtime, not just a memory store. Likely means rewriting one blueprint as a Letta agent to evaluate, not a drop-in addition.

**Don't add until:** You hit a case where the deterministic "code writes memory" pattern is too rigid — e.g., the orchestrator needs to dynamically promote a `trade_insight` to `core memory` based on conversation flow, and hardcoding that logic feels wrong.

### What NOT to do

- **Don't replace `agent_memory_v2`** with either system. The Postgres KV is the right primitive for structured trading facts (thesis, watchlist, scan_param, performance). Graphiti and Letta are *additions* for specific scenarios, not replacements.
- **Don't adopt mempalace** — repo was 2 days old as of 2026-04-07, single dominant maintainer, Python+MCP only. Watch for 3-6 months and revisit if it stabilizes.
- **Don't adopt mem0 or Cognee** — mem0 overlaps too much with what you already have, and Cognee is RAG-doc-heavy, wrong shape for trading agents.

### Preemptive adoption considered & rejected (2026-04-12)

Asked whether to add Graphiti/Letta now so agents build long-term memory from day one. Answer: **no — the trigger-based approach is still correct.** Reasons:

1. **Agent output quality is upstream of memory.** The agents currently produce broken embeds (n/a fields, fabricated numbers). Fixing what agents *remember* is pointless if what they *say* is wrong. Solve the JMT output format first (see Agent Response Quality section).
2. **No production data yet.** Sprint 4 just passed smoke tests. `agent_memory_v2` hasn't been exercised in production. There's nothing meaningful to store in a temporal graph or self-editing memory system yet.
3. **Premature infrastructure cost.** Graphiti needs Neo4j/FalkorDB as a Docker sidecar. Letta wants to replace the entire agent runtime. Both are significant complexity for agents that have run a handful of test scans.
4. **Right sequence:** Fix output quality → run agents daily in production → let `agent_memory_v2` accumulate real data for a few weeks → *then* evaluate if temporal queries or self-editing memory are needed.

The triggers above remain the right gates. Revisit after agents have been running production scans for 2+ weeks.

### Action when triggered

1. Re-read this note and the original `/learn` conversation
2. Spike Graphiti/Letta in a branch — one agent, one use case, no production wiring
3. Measure: does it actually answer the question that `agent_memory_v2` couldn't?
4. Only then write an AEV2 sprint spec to integrate

---

## Agent Response Quality — Remaining Work (P2+) (2026-04-10, updated 2026-04-12)

P0 and P1 are implemented. This section now tracks only the remaining structural work plus the deep-research findings that should inform the next execution pass.

### P2 — Next Sprint (Structural)

**P2.1: Persist assistant conversation turns**
- Files: `lib/agents/blueprints/orchestrator-chat.ts`, `app/api/agents/service/chat/route.ts`
- What: insert `role: 'assistant'` conversation rows after orchestrator synthesis and preserve the routing metadata needed for multi-turn chat continuity.
- Complexity: MEDIUM

**P2.2: Route specialist results back to Discord**
- Files: `services/discord-bot/index.ts`, likely `app/api/agents/service/chat/route.ts`
- What: when the orchestrator routes to a specialist, poll the specialist completion path and post the final specialist result back into `#orchestrator` instead of stopping at the job ID.
- Complexity: MEDIUM

**P2.3: Extend deterministic report inputs**
- Files: `lib/agents/blueprints/small-cap-research.ts`, `lib/agents/blueprints/swing-trader-research.ts`
- What: add `High.1W`, `Low.1W`, `RSI`, `MACD.macd`, `EMA9`, and `EMA21` to the TradingView columns and compute deterministic pre-LLM technical summaries instead of relying on raw blobs.
- Complexity: MEDIUM

**P2.4: Memory writes after research**
- Files: both specialist blueprints, `lib/agents/memory.ts`
- What: upsert a `thesis` memory row keyed by ticker after successful research completes.
- Complexity: MEDIUM

**P2.5: Report and embed contract cleanup**
- Files: `lib/agents/discord.ts`, `app/api/agents/reports/route.ts`, `app/api/agents/reports/[id]/route.ts`, `app/api/agents/macro-summary/latest/route.ts`
- What: rebuild the report-family renderers around explicit stored JSON contracts, surface stable report metadata in routes, and stop relying on top-level key guessing.
- Complexity: MEDIUM

### Deep Research Follow-Up — 2026-04-12

This section captures the repo-aware findings that should shape the next implementation handoff for small-cap reports, swing reports, and the macro summary.

#### Core Findings

- The current specialist prompts ask for analysis that the blueprints do not actually support with structured inputs.
- `getCachedTickerData()` already fetches a broad AskEdgar surface, but the live blueprints mostly throw it away before the LLM step.
- The small-cap blueprint currently passes only `filings`, `cashPosition`, and TradingView price context into the LLM, even though the report wants theme, chart-history, historical stats, and JMT commentary.
- The swing blueprint currently passes only `filings`, `cashPosition`, TradingView price context, and 10 OHLC bars. It does not provide computed RSI, EMA, relative-volume, or theme context even though the report implicitly expects those judgments.
- The macro pipeline is structurally thin and has a contract mismatch: the stored schema is `{ summary, keyEvents, sectorNotes, confidence }`, while the Discord embed expects `marketBias`, `rates`, `breadth`, `topTheme`, and `watchlist`.
- Attribution remains too loose. `evidenceIds` exists, but the schema does not require per-section source mapping, and the report builders do not expose source URLs or article provenance.

#### AskEdgar Coverage We Already Have But Underuse

`fetchTickerData()` already pulls these endpoint families:

- `float-outstanding`
- `screener`
- `dilution-rating`
- `dilution-data`
- `offerings`
- `equity-lines`
- `registrations`
- `news`
- `nasdaq-compliance`
- `pump-and-dump-tracker`
- `agreements`
- `historical-float-pro`
- `reverse-splits`
- `filing-titles`
- `gap-stats`
- `ownership`
- `split-status`

The normalized snapshot already exposes typed sections for `news`, `offerings`, `registrations`, `equityLines`, `historicalFloat`, `reverseSplits`, `splitStatuses`, `agreements`, and `gapStats`, plus `rawData` for the full payload. The research-tab TLDR path in `lib/research.ts` is currently the only place that tries to summarize most of that payload in one pass.

#### Small-Cap Additions To Promote

- `gap-stats` should drive deterministic chart-history and historical-stat summaries before the LLM sees the data.
- `news` should drive the catalyst timeline, source chronology, and any future JMT commentary extraction.
- `dilution-rating`, `dilution-data`, `offerings`, `registrations`, and `equity-lines` should remain core inputs.
- `ownership`, `historical-float-pro`, `reverse-splits`, `split-status`, `agreements`, `nasdaq-compliance`, and `pump-and-dump-tracker` should become explicit report inputs instead of silent background data.
- `market-strength` is a useful theme enrichment, but only if the endpoint contract is verified first.

Recommended deterministic pre-LLM fields for small-cap:

- `gapCount`
- `sameDayFadeRate`
- `avgCloseVsOpen`
- `avgHighExtension`
- `avgPremarketToVWAPFade`
- `offeringTagFrequencyOnGapDays`
- `hasActiveShelf`
- `hasActiveAtm`
- `amountRemainingAtm`
- `splitApproved`
- `splitEffectivePending`
- `daysToComplianceDeadline`
- `floatTrend`
- `knownHolderOverhang`

#### Swing Additions To Promote

- `gap-stats`, `float-outstanding`, `historical-float-pro`, and `ownership` should be used to judge float quality, runner cleanliness, and whether the move resembles prior continuation or exhaustion behavior.
- `dilution-rating`, `registrations`, and `offerings` should be used as overhang filters rather than the main thesis driver.
- `market-strength` and `ai-chart-analysis` are potentially useful enrichments, but only after their contracts are verified.

Recommended deterministic pre-LLM fields for swing:

- RSI
- EMA9
- EMA21
- relative volume
- 5-day / 10-day extension stats
- current move vs prior gap-day outcomes
- theme alignment score
- dilution-overhang flag

#### Higher-Tier / Unverified AskEdgar Endpoints

If the account tier supports them, these are likely high-value enrichments:

- `offerings-advanced`
- `dilution-data-advanced`
- `rofr`
- `research-reports`
- `research-reports-short`
- `research-reports-tldr`

Use them only as enrichments unless their schemas are confirmed and source-backed. They should not become primary evidence without verified access and clear field-level contracts.

#### Non-AskEdgar Additions Worth Adding

- source-linked news objects for every report section: `title`, `publisher`, `publishedAt`, `url`, `summary`, `category`, `isPrimary`, `relevance`, `stance`
- Reuters, AP, company press release, and SEC IR article links for primary-catalyst confirmation
- earnings dates, conference schedules, FDA or court or shareholder-vote calendars
- transcript snippets and management-tone shifts
- borrow or short-availability or short-interest change for small-cap reports
- sympathy-ticker watchlists for active themes
- explicit thesis invalidation fields
- event chronology: what hit first, what confirmed it, what changed after the open

#### X / Social-Source Guidance

- X should be treated as attention and narrative spread, not truth.
- Use it for `attentionScore`, influencer concentration, and social-first warning flags.
- Never let X define the catalyst section unless corroborated by filings or reputable news.
- Store exemplar post links, not synthesized "sentiment truth".

#### Macro Summary Redesign

The macro summary should be redesigned around dated, source-backed building blocks, not free-form synthesis from two generic news pages.

As of 2026-04-12, the most relevant macro drivers to anchor are:

- rates and inflation persistence
- labor resilience versus growth slowdown
- energy and geopolitics and oil volatility
- AI infrastructure and electricity demand and industrial spillovers

Recommended macro schema:

- `macroDrivers`: 3-5 current themes, each with `theme`, `whyItMatters`, `sources`, `marketReaction`, `bullCase`, `bearCase`, `watchItems`
- `crossAssetSnapshot`: indices, yields, dollar, oil, gold, VIX, bitcoin, sector ETFs, breadth
- `scheduledCatalysts`: CPI, PPI, payrolls, Fed speakers, Treasury auctions, OPEC or EIA, major earnings clusters
- `policyState`: latest Fed range, market-implied path, key quote, inflation trend
- `riskMatrix`: inflation risk, growth risk, geopolitics risk, liquidity risk, theme-crowding risk
- `deskImplications`: what the setup means for small-cap shorts, momentum longs, and gap-chasing risk
- `sourceIndex`: title, publisher, date, URL for every major claim

### Product Assumptions For The Next Pass

- Discord stays the primary delivery surface.
- The stored `agent_reports.report_json` object is the canonical contract, with routes exposing that shape plus metadata.
- `fetchJmt415()` stays out of scope until its endpoint contract is confirmed.
- Retail-tier AskEdgar assumptions remain the baseline unless a verified higher-tier contract is available.

### P3 — Future Sprint

**P3.1: Pre-market scan blueprint** — `small-cap-trader:pre-market-scan` stub. HIGH.
**P3.2: Pattern-check blueprint** — `swing-trader:pattern-check` stub. HIGH.
**P3.3: Trade context formatting helper** — shared `formatTradesForLlm()`. LOW.
**P3.4: Model tuning via env vars** — already wired, just change `INTERACTIVE_LLM_MODEL` / `BACKGROUND_LLM_MODEL`. LOW.

### Summary Table

| ID | Description | Complexity | Priority |
|----|-------------|------------|----------|
| P2.1 | Persist assistant conversation turns | MEDIUM | Next sprint |
| P2.2 | Route specialist results back to Discord | MEDIUM | Next sprint |
| P2.3 | Extend deterministic report inputs | MEDIUM | Next sprint |
| P2.4 | Memory writes after research | MEDIUM | Next sprint |
| P2.5 | Report and embed contract cleanup | MEDIUM | Next sprint |
| P3.1 | Pre-market scan blueprint | HIGH | Future |
| P3.2 | Pattern-check blueprint | HIGH | Future |
| P3.3 | Trade context formatting helper | LOW | Future |
| P3.4 | Model tuning via env vars | LOW | Future |

### Key Files

| File | Items |
|------|-------|
| `lib/agents/blueprints/orchestrator-chat.ts` | P2.1, macro prompt formatting |
| `lib/agents/blueprints/orchestrator-macro-summary.ts` | macro redesign |
| `lib/agents/blueprints/small-cap-research.ts` | P2.3, provenance tightening |
| `lib/agents/blueprints/swing-trader-research.ts` | P2.3, P2.4, provenance tightening |
| `lib/agents/discord.ts` | P2.5, macro embed redesign |
| `app/api/agents/reports/route.ts` | report metadata contract |
| `app/api/agents/reports/[id]/route.ts` | report detail contract |
| `app/api/agents/macro-summary/latest/route.ts` | macro latest contract |
| `services/discord-bot/index.ts` | P2.2 |
| `lib/agents/context.ts` | typed macro summary access |
