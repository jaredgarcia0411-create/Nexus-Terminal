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

## Agent Response Quality (2026-04-10, updated 2026-04-15)

### Completed — P0 through Tier 1 (2026-04-13)

P0, P1, P2, and Tier 1 are implemented. Execution details archived in HANDOFF.md (collapsed summary at top — "T1.1–T1.3 specialist blueprints completed 2026-04-13"). Key deliverables:

- **P2.1** Persist assistant conversation turns — `orchestrator-chat.ts` inserts `role: 'assistant'` rows after synthesis.
- **P2.2** Route specialist results back to Discord — `discord-bot/index.ts` polls specialist jobs and replies inline.
- **P2.3** Deterministic report inputs — Both blueprints have `RSI`, `MACD.macd`, `EMA9`, `EMA21`, `High.1M`, `Low.1M`; small-cap computes 14 deterministic fields; swing computes `relativeVolume`, `extension5d/10d`.
- **P2.4 / T1.1** Memory writes after research — Swing + small-cap both upsert thesis memory with 7-day TTL.
- **P2.5** Report and embed contract cleanup — Typed renderers in `discord.ts` for all three report types; typed contracts in `types.ts`.
- **T1.2** Deterministic news/catalyst extraction for small-cap — `extractNewsMetrics()` in `small-cap-research.ts:376-439` scans news array before LLM step (flags `hasFilingCatalyst`, `catalystCategories`, etc.).
- **T1.3** Swing deterministic gap-day comparison — gap-stats metrics computed alongside small-cap.
- **Swing-Trader Massive News integration** (2026-04-14) — `fetch-news` step calls `fetchTickerNews(ticker, 3)` from Massive and feeds `recentNews` array into the LLM prompt.

### Tier 2 — Next Sprint (Medium Impact, Medium Effort)

**T2.0: News Pipeline Unification — BIRD Catalyst Gap (2026-04-15)** 🔴 HIGHEST PRIORITY

Observed on BIRD (04/15/26): swing-trader Catalyst section said "No recent news articles are available" and small-cap said "the recent 8-K filing was a legit catalyst" without quoting the actual headline. AskEdgar clearly had the news (convertible financing + pivot from footwear to "NewBird AI" GPU-as-a-Service). Root causes:

1. **Swing-trader never reads AskEdgar news.** `fetch-news` step (`swing-trader-research.ts:729-754`) only calls Massive's `fetchTickerNews()`, which is a general-news API that misses SEC-filing-driven catalysts like 8-Ks. The `fetch-filings` step calls `getCachedTickerData()` but extracts only `gapStats`, `ownership`, `historicalFloat`, `dilutionRating`, `registrations`, `offerings` — never `news` or `filing-titles`.
2. **Small-cap strips context.** `buildNewsDigest()` (`small-cap-research.ts:441-456`) reduces each item to `{title, date, type}` with fallback `'(untitled)'`. AskEdgar's `/v1/news` response leaves `title` empty for SEC filings (only populated for `form_type = "news"`) — so 8-Ks show up as "(untitled)" and the LLM has nothing to quote.
3. **`/v1/filing-titles` is fetched but ignored in small-cap's `fetch-filings` step.** The endpoint returns AI-generated one-liners like "Announces $50M ATM offering program" — exactly what the Catalyst section needs — but `fetch-filings` at line 732 only reads `rawData['news']`.
4. **Both prompts lack "quote the headline" instruction.** Neither blueprint tells the LLM to embed the actual headline string in its Catalyst explanation.

**Fix:** Build shared news-formatter helper, wire it into both blueprints, update prompts. See the execution spec in `HANDOFF.md` — "News Pipeline Unification" section. Complexity: MEDIUM.

**T2.1: Per-section source attribution**
- Files: `lib/agents/types.ts`, both specialist blueprints, `lib/agents/discord.ts`
- What: Replace flat `evidenceIds: string[]` with per-section `sourceRef` fields. Each `TrafficLightSection` gets an optional `sourceRef: string` pointing to the specific AskEdgar endpoint or news item.
- Why: Foundation for trustworthy reports — currently no way to trace "why is offering risk red?" back to a specific filing.
- Complexity: MEDIUM

**T2.2: Macro `policyState` and `riskMatrix`**
- Files: `lib/agents/types.ts`, `orchestrator-macro-summary.ts`, `discord.ts`
- What: Add `policyState` (Fed funds range, market-implied path, inflation trend) and `riskMatrix` (5 risk dimensions as traffic lights) to `MacroSummaryReport`. Feed through to Discord embed and orchestrator context.
- Why: Macro summary currently lacks the structure that makes it actionable for trading decisions.
- Complexity: MEDIUM

**T2.3: Dilution-overhang flag for swing**
- File: `lib/agents/blueprints/swing-trader-research.ts`
- What: Add boolean `dilutionOverhang` to `runnerQuality` schema, computed from `registrations` and `offerings` (active shelf + recent offerings = true).
- Why: Quick win — data already fetched, just needs a boolean computation.
- Complexity: LOW

### Tier 3 — Future (After Production Data)

**T3.1: Pre-market scan blueprint** — `small-cap-trader:pre-market-scan` stub. HIGH.
**T3.2: Pattern-check blueprint** — `swing-trader:pattern-check` stub. HIGH.
**T3.3: Trade context formatting helper** — shared `formatTradesForLlm()`. LOW.
**T3.4: Model tuning via env vars** — already wired, just change `INTERACTIVE_LLM_MODEL` / `BACKGROUND_LLM_MODEL`. LOW.
**T3.5: Source-linked news objects** — structured `NewsItem` type with URL, publisher, date per section.
**T3.6: X/social attention scoring** — `attentionScore`, influencer concentration, social-first warning flags. Only after core reports are stable.
**T3.7: Event chronology** — what hit first, what confirmed it, what changed after the open. Requires new data sources.
**T3.8: Thesis invalidation fields** — explicit conditions under which each report's thesis is no longer valid.

### Deep Research Reference (2026-04-12)

Preserved for context when implementing Tier 2+. These findings informed the Tier 1 execution spec.

#### AskEdgar Coverage We Already Have But Underuse

`fetchTickerData()` already pulls: `float-outstanding`, `screener`, `dilution-rating`, `dilution-data`, `offerings`, `equity-lines`, `registrations`, `news`, `nasdaq-compliance`, `pump-and-dump-tracker`, `agreements`, `historical-float-pro`, `reverse-splits`, `filing-titles`, `gap-stats`, `ownership`, `split-status`.

#### Remaining Small-Cap Deterministic Fields (not yet computed)

- `avgPremarketToVWAPFade` — needs premarket data (Polygon intraday, $29/mo)
- `offeringTagFrequencyOnGapDays` — needs gap-stats cross-referenced with offering dates

#### Higher-Tier / Unverified AskEdgar Endpoints

`offerings-advanced`, `dilution-data-advanced`, `rofr`, `research-reports`, `research-reports-short`, `research-reports-tldr` — use only after verified access and clear field-level contracts.

#### Macro Summary Full Redesign (deferred to Tier 2)

Recommended enriched macro schema (beyond current implementation):

- `macroDrivers` with `bullCase`/`bearCase`/`watchItems` per theme
- `policyState`: Fed range, market-implied path, key quote, inflation trend
- `riskMatrix`: inflation, growth, geopolitics, liquidity, theme-crowding
- `deskImplications` as structured sub-objects instead of flat strings

#### X / Social-Source Guidance

- Treat X as attention/narrative spread, not truth.
- Use for `attentionScore`, influencer concentration, and social-first warning flags.
- Never let X define catalyst sections unless corroborated by filings or reputable news.

### Product Assumptions

- Discord stays the primary delivery surface.
- `agent_reports.report_json` is the canonical contract; routes expose that shape plus metadata.
- `fetchJmt415()` stays out of scope until its endpoint contract is confirmed.
- Retail-tier AskEdgar assumptions remain the baseline.

---

## In-Site Agent — Chat / Reasoning Panel (2026-04-15)

**Goal:** Let me ask reasoning questions about my own data directly from the Nexus site, without going through Discord. On-demand, chat-style.

### Use cases
- "Review my trades tagged `breakout-failed` over the last 3 months — what's the common pattern?"
- "Summarize my worst 10 R trades this quarter and tell me what setups they share."
- "Compare my A-grade trades to my C-grade trades — what's different about entry timing?"
- General Q&A over journal entries, tags, performance snapshots.

### Shape (rough, to be planned later)
- New API route under `app/api/agents/` that streams responses via `createSSEResponse`.
- New blueprint in `lib/agents/blueprints/` — in-site specialist that has tool access to trades, journal, tags, performance aggregations.
- UI: chat panel in the site (probably a slide-out or a tab, TBD). Messages persist per-conversation.
- Reuses existing agent runtime — same blueprint system, just a different trigger surface (HTTP instead of Discord).

### Open questions for planning
- Where does the chat UI live? New tab, dashboard widget, or global slide-out?
- Do conversations persist in the DB, or ephemeral per-session?
- Which tools does the agent get — read-only trade queries only, or can it write annotations back?
- Cost control — cap tokens per turn, or let it run long?

### Don't build until
In-site agent depends on the AEV2 blueprint system being stable in production. Tier 1 agent quality work (HANDOFF) should land first so the reasoning it produces is trustworthy.

---

## Scheduled Morning & EOD Brief (2026-04-15)

**Goal:** Home-server cron generates a structured brief twice a day — before market open and after close — summarizing what to watch and what happened. Displayed on the Nexus dashboard when I open the site.

### Morning brief (pre-market)
- Small-cap watchlist: overnight gappers, pre-market movers, fresh filings, dilution flags.
- Macro setup: overnight futures, major econ data on the calendar, Fed speakers, notable earnings.
- "What to watch today" — 2–3 narrative themes.

### EOD brief (post-close)
- What actually moved, why, and how my watchlist performed.
- Macro recap — key data prints, closing levels, narrative shifts.
- Carry-over setups worth tracking into tomorrow.

### Shape (rough, to be planned later)
- **Trigger:** home-server cron (not Vercel) — runs inside the `services/` Docker stack, same host as the agent containers. Vercel cron is for the market-pulse Discord bot; this one lives with the agents.
- Cron kicks the agent runtime, agent pulls TradingView + Massive + AskEdgar + macro sources, writes a snapshot row to a new `daily_briefs` table.
- Dashboard reads the latest snapshot on page load — no LLM cost per visit, no wait.
- Two cron slots: ~8:00 AM ET (morning) and ~4:30 PM ET (EOD).

### Open questions for planning
- New table schema for `daily_briefs` (morning vs EOD as separate rows or one row per day with both).
- Which existing blueprints to reuse vs. a new "daily-brief" blueprint.
- Dashboard placement — top card, dedicated section, or new tab?
- How macro data is sourced (FMP? econ calendar API? scraped?).
- Overlap with the Market Pulse Discord bot above — can they share the same data pipeline?
