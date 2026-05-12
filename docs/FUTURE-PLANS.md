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

**Status:** SHIPPED 2026-04-19 → 2026-04-20. DRC + Weekly Review + Archive tab live. Commits `4757fa3`, `0e41b5a`, `8dd6b12`, `fe97e8c`, `c300153`, `f1fde41`. See git history for implementation detail and the original design decisions.

**Deferred (not shipped with Option 2):**
- `hodTime` / `lodTime` trade fields (folds into Option 1 or separate spec).
- Chart screenshot → Vercel Blob storage (needed for PDF export).
- PDF export.

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

**Recommendation:** Claude API for production trading agents. Local models only for privacy-sensitive drafting/brainstorming. Cloud inference APIs (Groq, Google AI Studio, OpenRouter) are cheaper and more reliable than self-hosted hardware.

### Why not local for agents

- Local models (Hermes, Gemma 4, Llama 3.x) are fine for drafting, summarizing, structured output, general Q&A — bad at multi-step tool chaining (60–70% reliability vs 90%+ cloud), long context (8–32K vs 200K), and agentic autonomy.
- Gemma 4 (27B) impressive for size but doesn't match 70B+ on hard tasks; tool use fragile.
- Mini-PC clusters not practical — network latency kills throughput. One bigger machine wins.
- Sweet-spot hardware if pursued: M4 Mac Mini 32GB (~$900) or desktop + RTX 3060 12GB (~$800) for 8–13B models.

### Cloud inference providers

| Provider | Free tier | Best for |
|----------|-----------|----------|
| Google AI Studio | Generous free | Gemma/Gemini, general tasks |
| Groq | Rate-limited free | Extremely fast inference |
| Cerebras | Rate-limited free | Fast inference |
| OpenRouter | Pay-per-token | One API key for dozens of models |

### Model routing strategy

- **Simple parsing / structured output** → cheap/fast (Gemma 12B via Groq, free).
- **Research summaries / TLDRs** → mid-tier (Gemini Flash via Google AI Studio, free).
- **Complex reasoning / analysis** → Claude API (existing `lib/llm-client.ts`).

---

## Agent Memory — Investigate Graphiti & Letta (2026-04-07)

**Context:** `agent_memory_v2` (Postgres KV scoped by user+agent+category, see `lib/agents/memory.ts`) is the current memory layer and the right primitive for structured trading facts. Surveyed the landscape (mem0, Letta, Zep/Graphiti, Cognee, mempalace) — two systems worth revisiting **only when a specific limitation is hit**, never preemptively.

### Trigger 1: temporal pattern queries → Graphiti

Revisit when an agent needs questions where the **time validity of a fact** matters, not just its current value — e.g. *"did the MDR runner setup work in Q1 but stop after April?"* or *"what did I think about TSLA's float in February vs now?"*

- Bitemporal knowledge graph — every edge has `valid_from`/`valid_to`; old facts are superseded, not overwritten.
- OSS core of Zep (Zep Community Edition deprecated in 2025). Backends: Neo4j or FalkorDB (FalkorDB lighter, better for sidecar). Repo: https://github.com/getzep/graphiti
- **Shape:** sidecar container in `services/docker-compose.yml`, one graph namespace per agent, REST. Coexists with `agent_memory_v2` — KV for current facts, graph for "facts over time."
- **Don't add until:** you write a SQL query against `agent_memory_v2` and can't express the temporal dimension cleanly.

### Trigger 2: agent self-editing memory → Letta

Revisit when you want agents to **autonomously decide what to remember** rather than having `context.ts` and blueprint code do the writes. Today memory writes are in code paths you control; Letta's pitch is agent-called memory tools mid-conversation.

- MemGPT-paper lineage: *core* (always in context, agent-editable) / *recall* (searchable history) / *archival* (long-term store). Agents are first-class REST services with Postgres persistence — fits the Neon stack. Docker-native, has an ADE GUI. Repo: https://github.com/letta-ai/letta
- **Shape:** bigger lift than Graphiti — Letta wants to *be* the agent runtime. Evaluating means rewriting one blueprint as a Letta agent, not a drop-in.
- **Don't add until:** the deterministic "code writes memory" pattern feels too rigid — e.g. orchestrator needs to dynamically promote a `trade_insight` to core memory based on conversation flow.

### What NOT to do

- **Don't replace `agent_memory_v2`** with either. Postgres KV is the right primitive for structured trading facts; Graphiti/Letta are additions, not replacements.
- **Don't adopt mempalace** — 2 days old as of 2026-04-07, single maintainer, Python+MCP only. Watch 3–6 months.
- **Don't adopt mem0 or Cognee** — mem0 overlaps what you have; Cognee is RAG-doc-heavy, wrong shape for trading agents.

### Why not preemptive (revisited 2026-04-12)

Agent output quality is upstream of memory — fix what agents *say* before tuning what they *remember*. `agent_memory_v2` hasn't been exercised at scale yet, so a temporal graph would have nothing to store. Both systems are significant infrastructure for agents that have run a handful of production scans. Right sequence: fix output → run daily in production → let `agent_memory_v2` accumulate → *then* evaluate.

### Action when triggered

Re-read this note, spike the system on one blueprint + one use case in a branch with no production wiring, measure whether it actually answers the question `agent_memory_v2` couldn't, and only then write an AEV2 sprint to integrate.

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

**T2.0: News Pipeline Unification — SHIPPED.** `lib/agents/news-formatter.ts` wired into both specialist blueprints; catalyst sections now quote actual filing titles. (Originally observed on BIRD 2026-04-15: 8-K catalyst was visible to AskEdgar but never reached the LLM. See git history for the fix.)

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

## Agent Hardening Backlog (2026-04-15, refreshed 2026-04-24)

**Context:** The current agent stack is already substantial: typed blueprints, DB-backed jobs, checkpoints, retry logic, runtime limits, and specialist routing are all in place. The next constraint is not "add more agent code" so much as "tighten the runtime controls before giving the system more autonomy."

### Recently completed

- Service endpoint authorization hardening (`7118598`).
- Prompt trust-boundary labeling (`2a856f1`) — `lib/agents/trust-boundary.ts` + `__tests__/trust-boundary.test.ts`.
- Memory / retention TTL-on-read (`bf13567`) — `__tests__/agent-retention-cron.test.ts`.
- Spend enforcement — real per-model cost estimation + hard-stop gating. Commits `7aad160`, `abdefe9`, `1bd5e1e`, `8ad674e`, `9f0a123`. `buildLlmTrackingEntry()` in `blueprint-runner.ts:168` now calls `estimateCostCents(...)`; `checkBudget()` in `runtime-limits.ts:94` gates on accurate summed cost.

### Tool classification rule (replaces "general approval framework")

Today's agents are effectively read-only: they fetch external data (AskEdgar, FRED, RSS, Massive) and produce text reports. There is no tool that mutates state outside the agent's own logs, so a general approval framework would be built before it had anything to gate. A pure research report → user-read flow has no mutation surface, so a HITL gate would be rubber-stamping, not safety.

Rule going forward: **don't ship a mutation-capable agent tool without a gate.** Classify each tool as:

- **read** — no gate. External data fetches, LLM calls, report synthesis.
- **internal-write** — no user-facing gate. Agent's own memory/checkpoint/queue writes, bounded by spend + retention.
- **pre-approved external** — narrow allowlisted surfaces (e.g. posting to a fixed Discord channel). Don't grow the allowlist without a gate.
- **external-mutation** — requires runtime approval row before execution. Deny-by-default for unknown tool classes.

Current stack mapping:

- *read:* `fred-client`, `rss-lite`, `scrape-lite`, `sentiment-client`, AskEdgar helpers, `llm-client`, `news-formatter`
- *internal-write:* `memory`, `checkpoints`, `queue`/`worker`, `agent_runs` / `agent_request_log` inserts
- *pre-approved external:* `discord.ts` (fixed channel allowlist + user map)
- *external-mutation:* none today
- *user-initiated writes (not agent-initiated):* journal writes, trade review saves, sheet sync — the UI click is the approval

When the first `external-mutation` tool is on the roadmap (broker integration, agent-initiated bulk journal mutation, outbound DM to non-allowlisted recipient, generated-code execution, new mutating third-party API), the approval-gate framework ships alongside it: `pending_approvals` table, UI card, resumable job path via existing `checkpoints.ts`, auditable approval records.

### Still open

1. **Transactionality and dependency tracking for multi-agent workflows**
   - **Current gap:** Chat flow persists the user message and queued job as separate inserts; routed orchestration only tracks a single `specialistJobId` (`orchestrator-chat.ts`).
   - **Why this matters:** As soon as orchestration becomes parallel or fan-out based, partial writes and missing dependency graphs become correctness problems.
   - **Desired state:** Atomic enqueue/persist operations, explicit parent/child job relationships, and durable tracking for parallel specialist runs.

2. **Isolated sandbox boundary for untrusted execution**
   - **Current state:** `services/` sidecar runs the worker off-Vercel (`agent-entrypoint.ts`, `agent.Dockerfile`, `docker-compose.yml`). Next.js = control plane.
   - **Current gap:** The sidecar runs the same blueprint code — no isolated sandbox for generated scripts or richer tool execution, no short-lived credentials, no explicit input/output contract layer.
   - **Why this matters:** When a tool that executes generated code or calls wider third-party APIs is added, that execution should not share the same process/credentials as the blueprint runner.
   - **Desired state:** Dedicated execution sandbox (separate container or process) behind a narrow contract, reached only from the sidecar, never from Next.js.

### Order of operations

- **Now:** transactionality / dependency tracking (needed before any parallel specialist work).
- **When the first external-mutation tool is on the roadmap:** approval-gate framework shipped alongside it.
- **When a generated-code or broad-third-party tool is on the roadmap:** sandbox boundary shipped alongside it.
- **Standing requirement:** end-to-end evals and trace review before increasing autonomy.

### Guiding rule

The model should be treated as a **coordinator with bounded tools**, not a privileged process with broad implied authority.

---

## Hermes Sidecar Evaluation (2026-04-15)

**Could Hermes act as a "second hand on deck" for Nexus?** Yes — but scoped as a sidecar worker, not as the product's trust boundary. Nexus stays the system of record; Hermes becomes an auxiliary runtime for bounded higher-autonomy work that returns structured outputs. Think "staff analyst attached to the product team," not "ghost maintainer living inside the app."

### Good fits

Long-form research synthesis, repo-aware codebase investigation, drafting implementation/test plans, background research that enriches a Nexus report, operator workflows where a trusted human is already in the loop.

### Bad fits

Direct write access to the main DB, direct execution of high-impact product mutations, multi-tenant authority boundary, anything that assumes "Hermes said it, so it must be safe."

### Integration shape

1. **Isolated service** — separate process/container from Next.js and the main worker loop, own credentials + network policy, prefer container over host execution.
2. **Narrow contract** — Nexus calls a small set of jobs (`researchTicker`, `analyzeRepo`, `draftPlan`, `summarizeFindings`). Responses are structured JSON, not prose blobs the app blindly trusts.
3. **Nexus stays the control plane** — auth, scheduling, persistence, approvals, final user-visible state all live in Nexus.
4. **Treat output as untrusted** — Zod-validate responses; require explicit promotion before Hermes output becomes durable memory/report/action; log full request/response and tool path.
5. **Start read-only** — repo context, approved APIs, scoped research datasets only. Any write path mediated by Nexus after validation and approval.

### First experiment

One bounded workflow: "research this ticker / repo area / product question." Hermes runs multi-step in its own runtime and returns structured JSON (sources, confidence, proposed next actions). Nexus renders + stores if approved; no direct mutation rights for Hermes.

### Revisit question

If Hermes proves useful, the next question is not *"should Hermes replace the agent stack?"* — it is *"which specific workflows benefit from a sidecar more than from being implemented as typed Nexus blueprints?"*

---

## Site-Native Agent Surfaces (2026-04-15 / 2026-04-16)

**Decision:** Agent output reaches the user through site-native surfaces. Discord stays downstream as optional fan-out, not a middleman for in-site flows. `agent_reports.report_json` is the canonical artifact; UI and Discord both read from there.

### Why Discord stays out of the site request path

The durable truth already lives in Postgres. `agent_jobs`, `agent_reports`, and `agent_conversations` in `lib/db/schema.ts` are the primitives for orchestration, persisted artifacts, and chat transcripts. Reports are written by `writeAndDeliverReport()` in `lib/agents/discord.ts` — storage happens first, then Discord delivery attempts after the report row already exists. `services/discord-bot/index.ts` is integration glue for Discord users, not a control plane the site should reuse. Bouncing web requests through Discord would move product flow through the least authoritative layer and inherit Discord bot/webhook failure modes for no product upside.

### Planned surfaces

All four ride the same `agent_reports` / `agent_jobs` primitives — do not create a new report store. Legacy `research_reports` and `imported_research_reports` exist; keep agent work consolidated on `agent_reports`.

**1. Dashboard macro card**
- Latest macro summary rendered in-site, no Discord dependency. Source: `GET /api/agents/macro-summary/latest`.
- Placement: full-width "what matters today" card above performance overview. Must render even before trades are imported — today's `trades.length === 0` empty-state gate in `DashboardTab.tsx` would block it.

**2. Research Agent Desk** (submode of `Research`)
- Left rail: recent jobs / recent reports. Main pane: selected report detail or explicit run actions.
- Explicit actions (`Run small-cap research`, `Run swing research`) before freeform chat.
- Read APIs already exist: `app/api/agents/reports/route.ts`, `app/api/agents/reports/[id]/route.ts`, `app/api/agents/macro-summary/latest/route.ts`.

**3. Scheduled Morning & EOD Briefs**
- Home-server cron inside `services/` Docker stack (not Vercel). Two slots: ~8:00 AM ET (morning) and ~4:30 PM ET (EOD).
- Cron kicks the agent runtime; agent pulls TradingView + Massive + AskEdgar + macro sources; writes a snapshot row to a new `daily_briefs` table. Dashboard reads the latest snapshot on page load — no LLM cost per visit.
- Morning: small-cap watchlist (overnight gappers, pre-market movers, fresh filings, dilution flags), macro setup (futures, econ calendar, Fed speakers, notable earnings), 2–3 "what to watch" themes.
- EOD: what moved + why, watchlist performance, macro recap, carry-over setups for tomorrow.
- Open questions: one row per day (morning + EOD fields) vs. two rows? Reuse existing specialist blueprints vs. new `daily-brief` blueprint? Overlap with the Market Pulse Discord bot — can they share the data pipeline?

**4. In-Site Chat / Reasoning Panel**
- User-authenticated route (`channel: 'web'`), not the Discord service path. New blueprint with tool access to trades, journal, tags, performance aggregations.
- Example questions: *"Common pattern across my `breakout-failed` trades in the last 3 months?"*, *"What separates my A-grade trades from C-grade on entry timing?"*, *"Worst 10 R trades this quarter — shared setups?"*
- Depends on surfaces 1–3 being stable first. Tier 1 agent quality (HANDOFF) must land first so the reasoning is trustworthy.
- Open questions: chat UI placement (inside Research workspace vs. global slide-out)? Persistent vs. ephemeral conversations? Read-only trade queries, or agent-writable annotations? Per-turn token cap?

### Why not a new top-level `Agents` tab (yet)

- Shell is tightly coupled to the current tab list (`app/page.tsx`, `Sidebar.tsx`, `CommandPalette.tsx`, `use-global-shortcuts.ts`).
- Mobile nav is already dense; shared toolbar is trade-oriented.
- `Research` already has the wide canvas an agent/report workspace needs; `Dashboard` already owns "today's overview."

### Phased build order

1. **Dashboard macro card** (surface 1).
2. **Research Agent Desk** (surface 2) — adds a user-facing job-status endpoint for queued research and a `channel: 'web'` chat/trigger route. Do not reuse the Discord service route as-is.
3. **Scheduled briefs** (surface 3) — lands once the dashboard can render queued/completed agent output cleanly.
4. **In-site chat** (surface 4) — needs a proper per-session thread model so routed specialist completions fold back into one conversation.

### Architecture gaps to close along the way

- **Discord-locked service route** — `app/api/agents/service/chat/route.ts` assumes `discord_user_id`, shared service auth, `channel: 'discord'`. The orchestrator blueprint already supports `channel: 'web' | 'discord'`, but the route hardcodes Discord.
- **Conversation history scope too broad** — `buildContext()` loads by `userId + agentId`; needs session scope once both site and Discord are active chat surfaces.
- **`agent_reports.status` overloaded** — a valid report becomes `delivery_failed` when Discord delivery fails. Wrong signal once the site is the primary surface.

### Guardrails

- **Do:** build site-native report rendering first. Macro on `Dashboard`, agent work in `Research`.
- **Do:** treat Discord as optional fan-out and off-platform consumption.
- **Do not:** route web requests through Discord.
- **Do not:** add a top-level `Agents` tab until the workspace proves it needs one.
- **Do not:** start with freeform site chat before the site can render queued jobs and completed reports.

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
