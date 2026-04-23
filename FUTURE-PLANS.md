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

### Option 2: Full Journal Migration — Daily/Weekly Review in Nexus

**Status (2026-04-19):** SPEC'D — see active execution spec in `HANDOFF.md` ("Trade Journal Enhancement — DRC + Weekly Review + Archive"). Final design supersedes the original sketch below.

**Final design decisions (locked in before spec):**
- **Calendar location:** duplicate-rendered at top of `JournalTab` (Dashboard keeps its copy). Collapsible, `localStorage`-persisted.
- **Interaction:** click day → DRC side-sheet; click weekly row → Weekly Review side-sheet. Same shadcn `Sheet` primitive `TradeDetailSheet` uses.
- **Editable templates:** per-user, reorder + rename + required-toggle of fixed-type fields (bool/text/number/enum/auto). Stored as JSON; no migrations when template changes.
- **Template snapshots:** each saved DRC/Weekly copies the template `fields[]` into its own row at save time. Old reports preserve their original layout; future reports pick up the edited template. Eliminates orphan-key problem entirely.
- **Chart auto-attach (v1):** live-reference via `tradeIds[]` — report re-renders existing `JournalTradeChart` on open. No blob storage until PDF export arrives.
- **Auto-populated fields:** `grossResult`, `netResult`, `rTotal`, `perDayR` computed from trades by new `lib/journal-aggregates.ts` helpers.
- **Archive tab:** new top-level tab, flat list + type/date filters, JSON export per report (`Blob` download). Keyboard shortcut is `g a` sequence — the numeric 1–6 tab shortcuts stay untouched.
- **Template editing UX:** pencil icon inside new-report sheets (hidden on saved reports); includes "Reset to defaults" button.
- **Save model:** explicit Save button (no autosave). Reopening a day loads the existing DRC and upserts on save.

**Starting template fields (DRC):** followedProcess (bool), riskedAccordingly (bool), missedTrades (text), thoughts (text), goals (text), grossResult (auto), netResult (auto), rTotal (auto), grade (enum A+…F).

**Starting template fields (Weekly):** perDayR (auto bar strip), whatWorked (text), whatDidnt (text), cycleNotes (text), goalsNextWeek (text).

**Deferred to later phases:**
- `hodTime` / `lodTime` trade fields (Option 1 or separate spec).
- Chart screenshot → Vercel Blob storage (needed for PDF export).
- PDF export.
- Mobile nav "More" menu collapse (v1 uses `overflow-x-auto`).

**Effort:** 5–7 Codex sessions across 6 phases. See `HANDOFF.md` for per-phase steps.

---

## Notes

- Option 1 (structured trade-row fields: `grade`/`setupType`/`errors`/`agenda`) is still pending and separate from Option 2. Note that Option 2's DRC has a `grade` field on the *report*, not the trade row — they're different surfaces.
- The `tags` system already in Nexus could partially cover setup type and errors, but dedicated structured fields are better for analytics (consistent values, filterable, chartable).
- R-multiple tracking already works if `initialRisk` is set — consider a user-level default risk setting so it doesn't need to be entered per trade.

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

---

## Agent Hardening Backlog (2026-04-15, refreshed 2026-04-16)

**Context:** The current agent stack is already substantial: typed blueprints, DB-backed jobs, checkpoints, retry logic, runtime limits, and specialist routing are all in place. The next constraint is not "add more agent code" so much as "tighten the runtime controls before giving the system more autonomy."

### Recently completed

- Service endpoint authorization hardening shipped in commit `7118598`.
- Prompt trust-boundary labeling shipped in commit `2a856f1`.
- Memory / retention TTL-on-read shipped in commit `bf13567`.

### Short follow-up note

- Retention work now only needs routine production verification of the Vercel cron and future policy tweaks if TTL defaults or cleanup scope need to expand.

### Hardening items to prioritize

1. **Add approval gates for high-impact actions**
   - **Current gap:** The prompt policy says the system should be careful, but the runtime does not yet have a general approval framework for consequential mutations or external side effects.
   - **Why this matters:** "The model promised to be safe" is not a control. Any future write action, webhook trigger, broker integration, account mutation, or file mutation needs a runtime gate.
   - **Desired state:** Explicit approval-required tool classes, auditable approval records, resumable jobs, and deny-by-default behavior for mutating tools.

2. **Fix budget enforcement so spend limits actually work**
   - **Current gap:** `buildLlmTrackingEntry()` in `lib/agents/blueprint-runner.ts` records `estimatedCostCents: 0`, while `checkBudget()` in `lib/agents/runtime-limits.ts` gates on the summed `estimatedCostCents` column.
   - **Why this matters:** The current budget system looks real but cannot trip correctly. More agentic behavior means more model calls, so this becomes a real operational risk instead of a cosmetic one.
   - **Desired state:** Real per-model cost estimation, reserve-then-reconcile accounting, accurate request logging, and hard stop behavior before a user or background workflow can burn through budget unnoticed.

3. **Add transactionality and dependency tracking for multi-agent workflows**
   - **Current gap:** The current chat flow persists the user message and queued job as separate inserts, and routed orchestration only tracks a single `specialistJobId`.
   - **Why this matters:** As soon as orchestration becomes parallel or fan-out based, partial writes and missing dependency graphs become correctness problems.
   - **Desired state:** Atomic enqueue/persist operations, explicit parent/child job relationships, and durable tracking for parallel specialist runs. The runtime should know which runs depend on which others before autonomy grows.

4. **Move risky execution outside the Next.js app boundary**
   - **Current gap:** The repo's worker model is durable-process oriented, but there is no dedicated external sandbox boundary for untrusted code, generated scripts, or richer tool execution.
   - **Why this matters:** Vercel/serverless is a bad place to let autonomous execution grow legs. The app should orchestrate, not become the sandbox.
   - **Desired state:** Next.js remains the control plane. Risky execution happens in a sidecar/worker/sandbox service with short-lived credentials and explicit input/output contracts.

### Order of operations

- Add approval gates and real spend enforcement next.
- Then add transactional run/dependency tracking for multi-agent work.
- Then move risky execution into a real sandbox boundary.
- Keep end-to-end evals and trace review as a separate standing requirement before increasing autonomy.
- Only after that should the repo take on substantially more autonomous behavior.

### Guiding rule

The model should be treated as a **coordinator with bounded tools**, not a privileged process with broad implied authority.

---

## Hermes Sidecar Evaluation (2026-04-15)

**Question:** Could Hermes act as a "second hand on deck" for Nexus Terminal?

**Short answer:** Yes, but only if it is scoped as a sidecar worker or internal operator assistant, not as the primary trust boundary of the product.

### What "sidecar" means here

Hermes would run as a separate service or container alongside Nexus Terminal, with a narrow interface. Nexus stays the system of record and UI/API surface. Hermes becomes an auxiliary runtime that can do bounded higher-autonomy work and return structured outputs.

### Good fits for a Hermes sidecar

- Long-form research synthesis
- Repo-aware codebase investigation
- Drafting implementation plans or test plans
- Background research jobs that enrich a Nexus report
- Internal operator workflows where a trusted human is already in the loop

### Bad fits for a Hermes sidecar

- Direct write access to the main app database
- Direct execution of high-impact product mutations
- Multi-tenant customer-facing authority boundary
- Anything that assumes "Hermes said it, so it must be safe"

### Recommended integration shape

1. **Run Hermes as an isolated service**
   - Separate process/container from Next.js and from the main worker loop
   - Prefer container isolation over host execution
   - Give it its own credentials and network policy

2. **Expose a narrow contract**
   - Nexus calls Hermes for a small number of jobs, for example:
     - `researchTicker`
     - `analyzeRepo`
     - `draftPlan`
     - `summarizeFindings`
   - Hermes returns structured JSON, not ad hoc prose blobs that the app blindly trusts

3. **Keep Nexus as the control plane**
   - Nexus owns auth, scheduling, persistence, approvals, and final user-visible state
   - Hermes should not become the thing that decides who can do what in the product

4. **Treat Hermes output as untrusted**
   - Validate response payloads with Zod
   - Require explicit promotion before any Hermes output becomes durable memory, a report, or a user-facing action
   - Log the full request/response and tool path for auditability

5. **Start read-only**
   - First version should have read-only access to repo context, approved APIs, or a scoped research dataset
   - Any write path should be mediated by Nexus after validation and, ideally, explicit approval

### "Second hand on deck" interpretation

The right mental model is:

- **Yes:** a second set of hands for research, synthesis, codebase spelunking, and draft proposals
- **No:** a silent second brain that can independently mutate the app or act as a hidden control plane

If implemented well, Hermes would feel like a high-agency staff analyst attached to the product team, not a ghost maintainer living inside the app.

### Candidate first experiment

Use Hermes for one bounded internal workflow:

- Input: "research this ticker / repo area / product question"
- Hermes does multi-step research in its own runtime
- Output: structured JSON report with sources, confidence, and proposed next actions
- Nexus renders the result, stores it if approved, and does not grant Hermes direct mutation rights

### Why this is attractive

- Lets Nexus keep its typed workflow engine and existing DB-backed job model
- Avoids replacing the current architecture with a bigger assistant runtime
- Gives a place for higher-autonomy behavior that would be awkward inside a Vercel-oriented app
- Makes the trust boundary explicit instead of accidental

### Revisit question

If Hermes proves useful as a sidecar, the next question is not "should Hermes replace the agent stack?" It is "which specific workflows benefit from a sidecar more than they benefit from being implemented as typed Nexus blueprints?"

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

- Discord remains a useful off-platform delivery surface, but it should not be the canonical request/response path for in-site agent work.
- `agent_reports.report_json` is the canonical contract; routes expose that shape plus metadata.
- `fetchJmt415()` stays out of scope until its endpoint contract is confirmed.
- Retail-tier AskEdgar assumptions remain the baseline.

---

## Site-Native Agent Reports & Macro Surface (2026-04-16)

**Question reviewed:** How should research reports and the macro daily report show up in the Nexus site, and should web requests bounce through Discord first?

**Short answer:** No. Do not route site requests through Discord and then relay the result back into the app. The repo is already DB-backed at the core. Discord sits on top as a transport and delivery client, not the system of record.

### What the architecture review found

- `agent_jobs`, `agent_reports`, and `agent_conversations` in `lib/db/schema.ts` are already the durable primitives for orchestration, persisted artifacts, and chat transcript data.
- Research reports and macro summaries are both persisted through `writeAndDeliverReport()` in `lib/agents/discord.ts`. Storage happens first, then Discord delivery is attempted after the report row already exists.
- The site already has read APIs for native rendering:
  - `app/api/agents/reports/route.ts`
  - `app/api/agents/reports/[id]/route.ts`
  - `app/api/agents/research/route.ts`
  - `app/api/agents/macro-summary/latest/route.ts`
- The current chat ingress is still Discord-specific. `app/api/agents/service/chat/route.ts` is guarded by a shared service key plus `discord_user_id`, and it hardcodes `channel: 'discord'` despite the orchestrator blueprint already supporting `channel: 'web' | 'discord'`.
- Routed chat is split into two lifecycles today:
  - the orchestrator chat job completes early with `routed: true`
  - the specialist report arrives later through `agent_reports` + Discord delivery
- `agent_conversations` is not yet a full cross-agent thread model. It captures user/orchestrator chat turns, while specialist outputs live separately in `agent_reports`.

### Why Discord should stay out of the site request path

1. **Wrong authority boundary**
   - The durable truth already lives in Postgres. Making Discord the middleman would move product flow through the least authoritative layer in the stack.

2. **Extra failure modes with no product upside**
   - A site request that bounces through Discord would inherit Discord bot uptime, channel routing, and webhook behavior even though the app can already read reports directly from the DB.

3. **The current Discord path is integration glue, not product architecture**
   - `services/discord-bot/index.ts` is effectively a client for `/api/agents/service/chat`, plus a delivery endpoint for routed outputs. That is useful for Discord users, but it is the wrong primitive to reuse as the in-site control plane.

4. **The repo already points the other way**
   - `agent_reports` is the canonical persisted artifact.
   - Discord is downstream of report persistence.
   - The right product direction is site-native rendering with optional Discord fan-out.

### Product recommendation

**Macro daily report**
- Put the latest macro summary on `Dashboard`, not in a new top-level tab.
- Use `GET /api/agents/macro-summary/latest` as the initial source.
- Render it as a full-width "what matters today" card above the existing performance overview.
- Important caveat: if macro should show even before trades are imported, it cannot live inside the current `trades.length === 0` empty-state gate in `DashboardTab.tsx`.

**Research reports and agent work**
- Keep this inside `Research`, not as a separate top-level nav item yet.
- Add an `Agent Desk` submode to `ResearchTab` alongside the existing ticker-first workflow.
- Recommended shape:
  - left rail = recent jobs / recent reports
  - main pane = selected report detail or explicit run actions
  - explicit actions first (`Run small-cap research`, `Run swing research`) before freeform site chat

### Why not a new top-level tab yet

- The shell is tightly coupled around the current tab list in `app/page.tsx`, `Sidebar.tsx`, `CommandPalette.tsx`, and `use-global-shortcuts.ts`.
- Mobile nav is already dense.
- The shared toolbar is trade-oriented and would be semantically wrong for a dedicated macro/agent tab unless it is made tab-aware first.
- `Research` already has the wide canvas that an agent/report workspace needs; `Dashboard` already owns the "today's overview" role that the macro report fits.

### Recommended build order

1. **Dashboard macro card**
   - Show the latest macro summary in-site with no Discord dependency.

2. **Research Agent Desk**
   - Surface report history and report detail from `agent_reports`.
   - Let the user explicitly queue specialist research jobs from the site.

3. **User-authenticated research job status**
   - Add a proper site-facing status/read contract for queued research runs instead of relying on implicit `${jobId}:research` behavior or polling the reports list.

4. **Site-native chat route**
   - Add a separate user-authenticated `/api/agents/chat` or equivalent `channel: 'web'` path.
   - Do not reuse the Discord service route as-is.

5. **Unified conversation/event model**
   - If chat becomes first-class, specialist completions need to fold back into one session/thread instead of living only as separate report artifacts.

### Architecture gaps to solve before in-site chat feels real

- **Discord-locked service route**
  - `service/chat` currently assumes `discord_user_id`, shared service auth, and `channel: 'discord'`.

- **No clean user-facing job polling for research**
  - `POST /api/agents/research` queues a job, but the site does not yet have a first-class status endpoint analogous to the Discord service polling flow.

- **Conversation history is not session-scoped enough**
  - `buildContext()` currently loads conversation history by `userId + agentId`, which is too broad once the site and Discord both become active chat surfaces.

- **Delivery status is overloaded**
  - `agent_reports.status` currently doubles as report delivery status. A valid report can become `delivery_failed` solely because Discord delivery failed, which is the wrong signal if the site becomes a primary surface.

- **Do not create a new report store**
  - The repo already has legacy `research_reports` / `imported_research_reports` paths. New agent product work should continue to standardize on `agent_reports`, not create a third or fourth report pipeline.

### Explicit decisions for the future execution spec

- **Do:** build site-native report rendering first.
- **Do:** treat Discord as optional fan-out and off-platform consumption.
- **Do:** put macro on `Dashboard` and agent-driven report work in `Research`.
- **Do not:** route web requests through Discord.
- **Do not:** add a new top-level `Agents` tab until the workspace proves it needs one.
- **Do not:** start with freeform site chat before the site can reliably render queued jobs and completed reports.

### Spec trigger

When ready to execute, the spec should be framed as:

- Phase 1: site-native macro card + agent report history/detail
- Phase 2: site-triggered specialist jobs + user-facing job status
- Phase 3: in-site orchestrator chat with a unified thread/session model

That sequencing keeps the product aligned with the current architecture instead of fighting it.

---

## In-Site Agent — Chat / Reasoning Panel (2026-04-15)

**Goal:** Let me ask reasoning questions about my own data directly from the Nexus site, without going through Discord. On-demand, chat-style.

### Use cases
- "Review my trades tagged `breakout-failed` over the last 3 months — what's the common pattern?"
- "Summarize my worst 10 R trades this quarter and tell me what setups they share."
- "Compare my A-grade trades to my C-grade trades — what's different about entry timing?"
- General Q&A over journal entries, tags, performance snapshots.

### Shape (rough, to be planned later)
- New user-authenticated API route under `app/api/agents/` that supports `channel: 'web'` directly rather than tunneling through the Discord service path.
- New blueprint in `lib/agents/blueprints/` — in-site specialist that has tool access to trades, journal, tags, performance aggregations.
- UI: chat should follow the site-native report surfaces, likely as part of the `Research` workspace rather than a new top-level tab.
- Messages need a real per-session/thread model that can incorporate routed specialist results, not just direct orchestrator turns.
- Reuses existing agent runtime — same blueprint system, just a different trigger surface (HTTP instead of Discord).

### Open questions for planning
- Where does the chat UI live? New tab, dashboard widget, or global slide-out?
- Do conversations persist in the DB, or ephemeral per-session?
- Which tools does the agent get — read-only trade queries only, or can it write annotations back?
- Cost control — cap tokens per turn, or let it run long?

### Don't build until
In-site agent depends on the AEV2 blueprint system being stable in production, and it should come after site-native macro/report surfaces exist. Tier 1 agent quality work (HANDOFF) should land first so the reasoning it produces is trustworthy.

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

---

## Self-Host Learning Project — Shadow Coolify + Hetzner Staging (2026-04-23)

**Goal:** Build a *non-production* mirror of Nexus Terminal on a Hetzner VPS running Coolify, behind Cloudflare Tunnel, with a flat-rate managed Postgres. Use it to learn Linux/TLS/backups/deploys on something that doesn't matter. **Not a migration** — Vercel + Neon keep running prod the entire time. The success bar is: *restore a full DB backup to a fresh box in under 1 hour, unaided.*

### Why this, not a direct migration
- Migrating prod as my first Linux exposure is the footgun — backup I never tested, `pg_hba.conf` left permissive after debugging, cert renewal silently broken.
- A shadow env lets me break things safely. When I can prove recovery, *then* flipping over is a decision, not a gamble.
- Side benefit: real second environment for testing risky changes before they hit prod.

### Cost
- Hetzner CX22 (Ashburn): ~€4.15/mo (~$4.50)
- DigitalOcean Managed Postgres (1GB basic): $15/mo
- Cloudflare free tier: $0
- **Total: ~$20/mo** for the staging stack, while prod keeps running.

### Success criteria (how I know I'm done)
1. Staging URL (e.g. `staging.nexusterminal.dev`) serves a working mirror of the app via Cloudflare Tunnel.
2. Deploys happen by pushing to a `staging` git branch — no SSH required for normal updates.
3. Weekly automated `pg_dump` lands in encrypted off-box storage (Backblaze B2 or S3).
4. I can destroy the DB, restore from latest backup, and have the app working again — in under 1 hour, from memory.
5. I have a one-page runbook covering: how to SSH in, where logs live, how to roll back a deploy, how to restore the DB.

### Phase 1 — Provision & harden the VPS (~2–3 hrs)
1. Create Hetzner account, provision **CX22 Ubuntu 24.04 LTS** in Ashburn (low latency to US markets).
2. Add my SSH public key during creation. Never touch root password.
3. First SSH in as root, then immediately:
   - Create non-root sudo user (`adduser jared && usermod -aG sudo jared`).
   - Copy SSH key to the new user (`rsync --archive --chown=jared:jared ~/.ssh /home/jared`).
   - Edit `/etc/ssh/sshd_config`: `PermitRootLogin no`, `PasswordAuthentication no`. Reload sshd.
4. Install + enable UFW: allow 22, deny everything else. (Coolify will add 80/443 later.)
5. Install `fail2ban` with default sshd jail.
6. Install `unattended-upgrades` and confirm it's enabled for security updates.
7. Log out, log back in as `jared`, confirm root login is dead.

**Why each step:** SSH key-only + non-root user + UFW + fail2ban + auto-updates is the entire beginner security baseline. Skipping any one of them is how boxes get owned.

### Phase 2 — Install Coolify (~1 hr)
1. Run the Coolify one-liner installer on the VPS.
2. Open Coolify on port 8000 *via SSH tunnel only* (`ssh -L 8000:localhost:8000 jared@vps`) — don't expose the dashboard publicly.
3. Set admin password, configure SMTP-less (skip email), add my git provider (GitHub).
4. Inside Coolify, create a "Staging" project.

**Why SSH tunnel for the dashboard:** the Coolify admin UI is high-value attack surface. Keeping it on localhost behind SSH means even a mis-click can't expose it.

### Phase 3 — Cloudflare Tunnel (~1 hr)
1. In Cloudflare dashboard → Zero Trust → Networks → Tunnels, create a new tunnel. Copy the install command.
2. On the VPS, install `cloudflared` and run the tunnel as a systemd service.
3. Route `staging.<mydomain>` → `http://localhost:3000` (or whatever port Coolify assigns).
4. Remove ports 80/443 from UFW if I opened them — they're not needed. **The tunnel means the box has no public inbound ports except 22.**

**Why this over exposing 80/443 directly:** no public IP = no DDoS surface, no cert management (Cloudflare handles TLS), works behind CGNAT if I ever move the box home. For a beginner, this is the single biggest safety upgrade over raw VPS.

### Phase 4 — Managed Postgres + mirror the schema (~2 hrs)
1. Create DigitalOcean Managed Postgres (basic single-node, 1GB, cheapest tier). Note: *not* self-hosted. The goal here is learning Linux + deploys, not learning DB ops simultaneously.
2. Run my existing Drizzle migrations against the new DB: `DATABASE_URL=<do-url> npx drizzle-kit push` (or whatever command the project uses — check `package.json`).
3. Dump Neon prod schema + *seed data only* (not real user data) and restore to DO: `pg_dump --schema-only` then a small curated seed script. **Do not copy coworkers' real trades into staging.**
4. In Coolify, set `DATABASE_URL` to the DO connection string for the staging app.

**Why managed and not self-hosted Postgres:** the DB holds irreplaceable data. Learning Linux on the app tier is recoverable (rebuild the box); learning Postgres ops on a trading DB is not. Flat-rate managed PG sidesteps the usage-billing gripe without taking on DB admin risk.

### Phase 5 — Deploy the app (~2–3 hrs)
1. Create a `staging` branch off main.
2. In Coolify, add the GitHub repo, point it at `staging`, set build command to `npm run build`, start command to `npm start`.
3. Copy all env vars from Vercel to Coolify. Use **test API keys** wherever possible (Discord bot in a test server, separate Anthropic key with low limit, etc.).
4. First deploy. Expect 2–3 issues on first run — `next build` OOM, missing env var, path case sensitivity (Linux vs macOS). Each failure is a learning moment; don't throw hardware at it before understanding.
5. Verify the staging URL serves the app, login works, a basic page loads.

**Why a `staging` branch:** Coolify auto-deploys on push. Keeping staging on its own branch means I can break it freely without touching what Vercel deploys from `main`.

### Phase 6 — Cron jobs (~1 hr)
1. The two existing Vercel crons (`/api/discord/cron/sync`, `/api/cron/agent-retention`) need an equivalent scheduler off Vercel.
2. Easiest path: a **systemd timer** on the VPS that `curl`s the internal endpoint with the `CRON_SECRET` header. Write one `.service` + one `.timer` file per job under `/etc/systemd/system/`.
3. `systemctl enable --now <name>.timer`, then `systemctl list-timers` to confirm.
4. Check `journalctl -u <name>.service` after the first fire to confirm it actually hit the endpoint.

**Why systemd timers:** already on the box, journald gives me logs, no extra deps, no third-party scheduler to trust. GitHub Actions cron is unreliable — drops jobs on inactive repos and delays under load.

### Phase 7 — Backups + the restore drill (~3–4 hrs) — THE MOST IMPORTANT PHASE
1. Create a Backblaze B2 bucket (cheaper than S3 for backups; free tier covers 10 GB).
2. Write a `/usr/local/bin/pg-backup.sh` script: `pg_dump -Fc` → encrypt with `gpg --symmetric` → upload via `rclone` to B2. Include the date in the filename.
3. Add a systemd timer running it **daily at 03:00 UTC**.
4. Add a second timer that deletes B2 objects older than 30 days (retention).
5. **The drill (do this on the calendar, quarterly):**
   - Provision a second throwaway VPS (or just a fresh DO Postgres DB).
   - Download latest B2 backup, decrypt, restore with `pg_restore`.
   - Point the staging app at the restored DB. Confirm it works.
   - **Time the whole operation.** Target: under 1 hour.
6. Only after the restore drill passes do I consider this phase done.

**Why this phase gets its own block:** untested backups are the #1 self-hosted horror story. A backup that has never been restored *is not a backup* — it's a hope. Running the drill once proves the chain works; doing it quarterly catches silent corruption before it matters.

### Phase 8 — Runbook (~1 hr)
Single markdown file at `docs/staging-runbook.md` covering:
- VPS IP, SSH command, who has access.
- How to open Coolify UI (SSH tunnel command).
- Where app logs live (`journalctl` / Coolify UI).
- How to force-redeploy from Coolify dashboard.
- How to roll back a deploy.
- How to restore the DB (exact commands).
- Cloudflare Tunnel dashboard link.
- B2 bucket name + how to list/download backups.

**Why write this now, not later:** in 6 months when something's broken at 11pm, I won't remember any of this. The runbook *is* the project output — the VPS is just the medium I learned on.

### Deferred / out of scope
- **Self-hosting Postgres.** Explicitly skipped. Revisit only after 6 months of successful Coolify operations.
- **Moving prod.** No cutover until the restore drill has passed twice.
- **Preview deploys per PR.** Vercel does this invisibly; Coolify needs extra config. Not worth it for staging.
- **Monitoring/alerting stack.** UptimeRobot free tier pinging the staging URL is enough for a learning env.

### Decision checkpoint (after Phase 7 passes)
Once the quarterly restore drill has passed **twice**, the question becomes: is the savings worth the ongoing ops time? Re-evaluate with real data instead of speculation:
- Actual hours spent on staging in the last 6 months.
- Actual Vercel bill trajectory.
- How many times staging caught a bug that prod would have shipped.

If the answer is "migrate prod," the mechanical work is ~1 day: swap DNS, `pg_dump` Neon → DO, flip env vars. The scary parts will already be solved.
