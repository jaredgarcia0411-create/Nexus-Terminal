# Jarvis Capability Plan

Last updated: 2026-03-10

## Goal

Transform Jarvis from a basic prompt-and-scrape assistant into a persistent, multi-source, orchestrated trading intelligence system. Jarvis should be able to retrieve, organize, and synthesize information from curated web sources, user documents, journal entries, and cached macro headlines to produce structured, citable, actionable analysis.

## Guiding Principles

- Quality and token efficiency over raw speed.
- Allowlist-first source policy. No open web crawling.
- Indefinite knowledge retention bounded by per-user storage limits.
- Every response follows a default structured format with source attribution.
- Build the pipeline incrementally. Ship small, validate, expand.

## Locked Decisions

| Decision | Choice |
|---|---|
| Source policy | Allowlist-first |
| ~~First preset~~ | ~~Earnings~~ — replaced by Dilution Research pack (Sprint 8) |
| Dilution research | AskEdgar API (`eapi.askedgar.io`) — on-demand, single-ticker, 12 endpoints |
| Memory retention | Indefinite, bounded per-user, eviction by relevance score |
| Macro pipeline | Background cron + cache (daily on Vercel Hobby tier) |
| User doc uploads | PDF + plain text in first release |
| Response format | Mandatory structured schema on all LLM responses |
| Speed vs quality | Quality + token efficiency prioritized; median latency target < 8s |

## Defined Metrics

| Metric | Target |
|---|---|
| Structured format compliance | 100% of LLM responses |
| Citation coverage | Every claim tied to a source label |
| Token efficiency | Context window under 80% of model limit |
| Median latency | < 8s for standard requests |
| Scrape success rate | > 90% on allowlisted domains |
| Cost per request | Track and report (no hard cap yet) |
| Memory utilization | Indefinite retention, per-user storage bounded |

## Current Jarvis Baseline

- 4 modes: daily-summary, trade-analysis, assistant, macro-summary (dilution-research planned for Sprint 8)
- Scrapes up to 5 URLs per request with allowlist validation, robots.txt checks, and scrape-cache short-circuiting
- Remembers up to 20 recent URLs per user (`jarvis_source_urls`)
- Uses persistent knowledge memory (`jarvis_knowledge_chunks`) across web, journal, user docs, and cached headlines
- Macro-summary mode runs the orchestration pipeline; other modes remain single-pass
- Includes deterministic structured fallback when LLM is unavailable or returns invalid output
- Includes safety controls: per-user rate limiting, LLM circuit breaker, and token usage tracking (`jarvis_request_log`)
- Includes admin observability endpoints for memory and request/token stats
- Jarvis functionality is covered by route/module/eval tests

## Implementation Phases

### Phase A — Organized Sources (Sprint 0 + Sprint 1)

#### Sprint 0 — Foundation and Guardrails

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-001 | Extract shared Jarvis types to `lib/jarvis-types.ts` | S | done |
| JRV-002 | Domain allowlist module (`lib/jarvis-allowlist.ts`) with validation helper | S | done |
| JRV-003 | Scrape timeout (10s per URL) + structured error return | S | done |
| JRV-004 | Trim client trade payload to only fields Jarvis uses | S | done |
| JRV-005 | Remove legacy `url` singular field from `JarvisRequest` | XS | done |

Exit criteria: Shared types in place, allowlist enforced, scraping safer, payload leaner.

#### Sprint 1 — Source Organization + Earnings Preset

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-010 | Source pack data model in `lib/jarvis-source-packs.ts` | S | done |
| JRV-011 | Earnings preset: Earnings Whispers, MarketWatch, Nasdaq calendar, SEC EDGAR | S | done (superseded by Dilution pack in Sprint 8) |
| JRV-012 | API: resolve source pack by ID in POST handler | S | done |
| JRV-013 | UI: source pack picker (dropdown/card in JarvisTab) | M | done |
| JRV-014 | UI: grouped chips (presets vs remembered vs manual), labels, timestamps | M | done |

Exit criteria: User can run Jarvis with 1 click using the Earnings preset. Pack template is reusable.

### Phase B — High-Signal Scraping (Sprint 2 + Sprint 3)

#### Sprint 2 — Structured Scraping Pipeline

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-020 | Structured extractor: title, publish date, author, body, tickers | M | done |
| JRV-021 | Content chunking: overlapping chunks at 512-token target with metadata | M | done |
| JRV-022 | Hash-based dedupe: fingerprint chunks, suppress near-duplicates | S | done |
| JRV-023 | Source ranking: freshness + ticker relevance + trust tier scoring | M | done |
| JRV-024 | Context preview: return `sources[]` with title, host, relevance, excerpt | S | done |

Exit criteria: Jarvis uses ranked, deduplicated, structured excerpts. Response includes source traceability.

#### Sprint 3 — Default Response Format + Trust Layer

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-030 | Define response schema: TL;DR, Findings, Action Steps, Risks, Sources | S | done |
| JRV-031 | System prompt engineering to enforce structured output | M | done |
| JRV-032 | Response parser + validator with graceful fallback | M | done |
| JRV-033 | UI: structured response renderer (sections, visual hierarchy, source links) | M | done |
| JRV-034 | Fallback quality mode: deterministic output matching same schema | S | done |

Exit criteria: Every Jarvis response follows the defined schema with citations.

### Phase C — Memory Jarvis (Sprint 4 + Sprint 5)

#### Sprint 4 — Persistent Knowledge Store

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-040 | Knowledge store schema: `jarvis_knowledge_chunks` table | M | done |
| JRV-041 | Ingest pipeline: store structured chunks + metadata after scraping | M | done |
| JRV-042 | Retrieval pipeline: keyword + recency hybrid retrieval | L | done |
| JRV-043 | Token budget manager: assemble context within 80% model limit | M | done |
| JRV-044 | Memory management API: view count, purge by source, purge all | S | done |
| JRV-045 | Drizzle migration for `jarvis_knowledge_chunks` | S | done |

Exit criteria: Jarvis answers from previously scraped knowledge without re-scraping. Memory is indefinite and bounded.

#### Sprint 5 — Additional Context Sources

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-055 | Embeddings integration: ingest-time vectors for all source types (NVIDIA) | M | done |
| JRV-050 | Journal entry context: pull trade notes + tags into retrieval | M | done |
| JRV-051 | User doc upload API: `POST /api/jarvis/upload` for PDF + plain text | L | done |
| JRV-052 | Upload UI: file drop zone, upload status, manage uploaded docs | M | done |
| JRV-053 | Source attribution labels: `web_source`, `trade_journal`, `user_document`, `cached_headline` | S | done |
| JRV-054 | UI: color-coded source badges on each citation | S | done |

Exit criteria: Jarvis blends web + journal + uploaded doc context with explicit attribution per finding.

### Phase D — Orchestrated Jarvis (Sprint 6)

#### Sprint 6 Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Vercel tier | Hobby — daily cron (`0 11 * * *`, 6 AM ET) | Hobby only supports daily crons; run before US market open |
| Paywalled domains | Replace `bloomberg.com`, `ft.com`, `scmp.com` with `investing.com`, `tradingeconomics.com`, `nikkei.com` | Paywalled sites yield minimal scrapeable text |
| Cached headline ownership | `userId: 'system'` — globally visible to all users | Macro headlines are not user-specific; avoids redundant scraping |
| Critique step | OFF by default (`JARVIS_ORCHESTRATION_CRITIQUE=false`) | Ship pipeline stable first; toggle on via env var when latency baseline established |
| Orchestration scope | `macro-summary` mode only; existing modes stay single-pass | Minimize regression risk; follow-up migration tracked as deferred JRV-077 |
| LLM rate limit | 40 RPM on NVIDIA/DeepSeek API — orchestration must add 1.5s delay between LLM calls | Prevents 429s during multi-step pipeline; cron embedding ingestion must also throttle |
| Macro domain list | US: `cnbc.com`, `reuters.com`, `investing.com`, `federalreserve.gov`; EU: `ecb.europa.eu`, `tradingeconomics.com`; Asia: `boj.or.jp`, `nikkei.com`; Global: `imf.org`, `worldbank.org` | 10 open-access domains across 4 regions |

#### Sprint 6 — Orchestration Pipeline + Macro Summary

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-060 | Macro headline cron job: scrape allowlisted sources per region on daily schedule (Vercel Hobby) | L | done |
| JRV-061 | Macro source allowlist: curated domains per region (US, EU, Asia, global) — open-access only | M | done |
| JRV-062 | Orchestration engine: plan -> retrieve -> summarize -> critique -> answer | L | done |
| JRV-063 | Macro summary mode: new `macro-summary` JarvisMode with country-by-country output | M | done |
| JRV-064 | UI: macro summary action card with region breakdown | S | done |

Exit criteria: Jarvis produces a daily macro summary from cached headlines using multi-step reasoning. Pipeline is reusable.

### Phase E — Production-Ready (Sprint 7, parallel from Phase B onward)

#### Sprint 7 — Safety, Governance, and Cost Controls

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-070 | Per-user rate limiting (target: 30 requests/hour) | M | done |
| JRV-071 | Token budget tracking: log input/output tokens per request, aggregate per user/day | M | done |
| JRV-072 | Circuit breaker: disable LLM on high error rate, fall back to deterministic | S | done |
| JRV-073 | Robots.txt respect before scraping | S | done |
| JRV-074 | Scrape cache layer: cache by URL + hash with configurable TTL | M | done |
| JRV-075 | Observability endpoint: `/api/jarvis/admin/stats` for latency, errors, tokens (admin only) | M | done |
| JRV-076 | Eval harness: golden prompt set + automated quality scoring per release | L | done |
| JRV-077 | Migrate daily-summary, trade-analysis, assistant modes to orchestration engine | M | deferred (deprioritized — focus shifted to dilution research) |

Exit criteria: Safe to scale with predictable performance and cost. Regression quality tracked automatically.

### Phase F — Dilution Intelligence (Sprint 8)

#### Sprint 8 Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data source | AskEdgar API only (`eapi.askedgar.io`) | Single API provides all dilution, offering, SEC filing, and scam risk data; no scraper needed |
| Trigger model | On-demand, one ticker at a time (NOT cron) | Dilution research is ticker-specific and user-initiated |
| Pipeline path | Orchestration engine (plan → retrieve → summarize → answer) | Reuses existing `runOrchestration`; plan step short-circuits (no LLM call) |
| Knowledge persistence | Ingest AskEdgar results into `jarvis_knowledge_chunks` as `api_data` source type | Historical context for the same ticker surfaces automatically in future analyses |
| New source type | `api_data` added to `JarvisSourceType` union | Distinguishes AskEdgar-sourced data from web scrapes, journals, and documents |
| API rate budget | 100 calls/day tracked in-memory with env override `ASKEDGAR_DAILY_LIMIT` | Each report uses 12 calls; budget allows ~8 full reports/day; counter resets at midnight UTC |
| Earnings pack | Remove entirely from `sourcePacks` array | Replaced by dilution research; earnings URLs were unreliable scraped targets |
| Auth | `API-KEY: ${ASKEDGAR_API_KEY}` header | Matches AskEdgar API spec; key stored in env, never exposed to client |
| Error handling | Graceful per-endpoint — each of 12 endpoints called independently via `Promise.allSettled` | One endpoint failure must not block the rest of the report |
| UI card placement | Remove earnings card, keep macro summary card, add Dilution Research card alongside it | Two action cards total (Macro + Dilution) |
| Risk color mapping | Low=emerald/green, Medium=amber/yellow, High=rose/red | Direct mapping from AskEdgar's High/Medium/Low ratings |
| Skipped endpoints | `funds-underwriters` (institutional-only), `screener/options` (not needed) | Access restrictions and irrelevance |
| Skipped report sections | PR History move stats, Theme, Chart History, Historical Commentary, View Historical Charts | User decision — focus on dilution data |

#### Sprint 8 — Dilution Research Pack (AskEdgar Integration)

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-080 | AskEdgar API client with typed endpoints and daily rate tracking | M | pending |
| JRV-081 | Dilution research types: new mode, source type, report schema | S | pending |
| JRV-082 | Add `api_data` source type to DB schema + knowledge retrieval | S | pending |
| JRV-083 | AskEdgar data aggregator: 12 endpoints → unified report + chunks | L | pending |
| JRV-084 | Remove earnings pack, add dilution-research pack | XS | pending |
| JRV-085 | Dilution-specific orchestration system prompt + plan shortcut | M | pending |
| JRV-086 | Route handler: dilution-research mode with validation and ingestion | M | pending |
| JRV-087 | Dilution report renderer component (14 visual sections) | L | pending |
| JRV-088 | Wire dilution report into structured response renderer | S | pending |
| JRV-089 | JarvisTab UI: dilution research card + ticker input | M | pending |
| JRV-090 | Tests: client, aggregator, route integration | M | pending |

Exit criteria: User can enter a ticker, receive a comprehensive dilution research report with 14 sections, risk color coding, and data source verification. Results persist in knowledge for future context. API budget tracked at 100 calls/day.

## Build Order

| Phase | Sprints | Milestone |
|---|---|---|
| Phase A | Sprint 0 + Sprint 1 | Organized Sources |
| Phase B | Sprint 2 + Sprint 3 | High-Signal Scraping |
| Phase C | Sprint 4 + Sprint 5 | Memory Jarvis |
| Phase D | Sprint 6 | Orchestrated Jarvis |
| Phase E | Sprint 7 (parallel from Phase B) | Production-Ready |
| Phase F | Sprint 8 | Dilution Intelligence |

## Progress Log

| Date | Update |
|---|---|
| 2026-03-10 | Sprint 8 planned (JRV-080 to JRV-090): Dilution Research Pack via AskEdgar API. 11 tickets, 3 creates, 9 modifies, 3 test files. Earnings pack will be replaced by dilution-research pack. On-demand single-ticker analysis through orchestration engine. 12 AskEdgar API endpoints per report with 100 calls/day budget. 14-section report with risk color coding. Sprint 0-2 ticket statuses corrected from pending to done (were implemented but never marked). JRV-077 deprioritized in favor of dilution research focus. |
| 2026-03-09 | Sprint 7 completed (JRV-070 to JRV-076, JRV-077 deferred): added per-user in-memory rate limiting (30 req/hr), token budget tracking via `jarvis_request_log` table with Drizzle migration, circuit breaker for LLM failures (5-failure threshold, 60s reset), robots.txt compliance before scraping with 1h cache, scrape cache using `jarvis_knowledge_chunks.lastSeenAt` (1h web/12h headline TTL), admin-only observability endpoint (`/api/jarvis/admin/stats`), and eval harness with 6 golden prompts for structural compliance validation. JRV-077 (migrate remaining modes to orchestration) deferred to future sprint. |
| 2026-03-08 | Sprint 6 planning finalized. All decisions locked: Vercel Hobby daily cron at 6 AM ET (`0 11 * * *`), 10 open-access macro domains across 4 regions (replaced paywalled bloomberg/ft/scmp with investing.com/tradingeconomics.com/nikkei.com), system-level headlines (`userId: 'system'`), critique step off by default, orchestration scoped to macro-summary mode only (existing modes deferred to Sprint 7 as JRV-077), 40 RPM NVIDIA rate limit with 1.5s inter-call delay. Execution spec: 13 changes, 12 files (4 creates, 8 modifies). |
| 2026-03-07 | Sprint 5 completed (JRV-055, JRV-050 to JRV-054): added NVIDIA embedding integration with ingest-time vectors (migrated to `vector(1024)`), journal-note synchronization from trades with tags/performance context, PDF+text upload pipeline (`/api/jarvis/upload`) with document metadata tracking and chunk ingestion, Jarvis documents sub-tab UI for upload/list/delete management, retrieval/prompt attribution by source type, and color-coded citation badges for web/journal/document/headline sources. |
| 2026-03-07 | Sprint 4 completed (JRV-040 to JRV-045): added persistent `jarvis_knowledge_chunks` schema + migration (with pgvector), write-through ingest with seen-count/last-seen updates, keyword+recency retrieval from PostgreSQL full-text search, token-budget context assembly via env-configurable limits, admin-only memory stats/purge APIs behind `x-jarvis-admin-key`, and automatic per-user eviction for non-web chunks at 100MB default bound. |
| 2026-03-07 | JRV-033 completed: added `JarvisStructuredResponse` renderer with visual section hierarchy (`TL;DR`, findings, action steps, risks), warning styling, and clickable source links with relevance/ticker badges; wired `JarvisTab` to use the new renderer and added UI-focused rendering tests. |
| 2026-03-07 | JRV-034 completed: improved deterministic fallback quality in `buildStructuredFallbackFromSources` (rank-aware findings, ticker-aware actions, confidence-aware risks) and made route-level fallback message schema-consistent via `formatStructuredMessage`. |
| 2026-03-07 | JRV-032 completed: added `parseJarvisLlmResponse` validation/parsing + structured fallback helpers, integrated route-level parser fallback, and added regression coverage in response/scrape/route tests with `scraped source` context ranking contracts. |
| 2026-03-07 | JRV-031 implemented in the route layer: consolidated strict system prompt for schema-only JSON output and added regression coverage asserting prompt contract shape. |
| 2026-03-07 | JRV-030 marked done; structured Jarvis response schema now enforced end-to-end with parser/fallback coverage and explicit contract tests in route handler. |
| 2026-03-07 | Jarvis LLM provider switched from GLM-4.7 to DeepSeek V3.2 via NVIDIA API. Updated `.env.example`, `app/api/jarvis/route.ts` constants, and tests to reflect the change. |
| 2026-03-06 | Plan created. Current state documented. Sprint board defined. Locked decisions captured. |
