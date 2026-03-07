# Jarvis Capability Plan

Last updated: 2026-03-07

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
| First preset | Earnings: Earnings Whispers, MarketWatch earnings, Nasdaq earnings calendar, SEC EDGAR |
| Memory retention | Indefinite, bounded per-user, eviction by relevance score |
| Macro pipeline | Background cron + cache (target: every 30min) |
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

- 3 modes: daily-summary, trade-analysis, assistant
- Scrapes up to 5 user-provided URLs per request (raw HTML strip, 2500 char excerpt)
- Remembers up to 20 recent URLs per user (`jarvis_source_urls`)
- Single-pass LLM prompt (system + user message with appended scraped context)
- Deterministic fallback when no API key is configured
- No persistent content memory beyond URL pointers
- No shared types between client and server
- No test coverage for Jarvis logic
- Full trade payload sent from client (more fields than needed)

## Implementation Phases

### Phase A — Organized Sources (Sprint 0 + Sprint 1)

#### Sprint 0 — Foundation and Guardrails

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-001 | Extract shared Jarvis types to `lib/jarvis-types.ts` | S | pending |
| JRV-002 | Domain allowlist module (`lib/jarvis-allowlist.ts`) with validation helper | S | pending |
| JRV-003 | Scrape timeout (10s per URL) + structured error return | S | pending |
| JRV-004 | Trim client trade payload to only fields Jarvis uses | S | pending |
| JRV-005 | Remove legacy `url` singular field from `JarvisRequest` | XS | pending |

Exit criteria: Shared types in place, allowlist enforced, scraping safer, payload leaner.

#### Sprint 1 — Source Organization + Earnings Preset

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-010 | Source pack data model in `lib/jarvis-source-packs.ts` | S | pending |
| JRV-011 | Earnings preset: Earnings Whispers, MarketWatch, Nasdaq calendar, SEC EDGAR | S | pending |
| JRV-012 | API: resolve source pack by ID in POST handler | S | pending |
| JRV-013 | UI: source pack picker (dropdown/card in JarvisTab) | M | pending |
| JRV-014 | UI: grouped chips (presets vs remembered vs manual), labels, timestamps | M | pending |

Exit criteria: User can run Jarvis with 1 click using the Earnings preset. Pack template is reusable.

### Phase B — High-Signal Scraping (Sprint 2 + Sprint 3)

#### Sprint 2 — Structured Scraping Pipeline

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-020 | Structured extractor: title, publish date, author, body, tickers | M | pending |
| JRV-021 | Content chunking: overlapping chunks at 512-token target with metadata | M | pending |
| JRV-022 | Hash-based dedupe: fingerprint chunks, suppress near-duplicates | S | pending |
| JRV-023 | Source ranking: freshness + ticker relevance + trust tier scoring | M | pending |
| JRV-024 | Context preview: return `sources[]` with title, host, relevance, excerpt | S | pending |

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
| JRV-040 | Knowledge store schema: `jarvis_knowledge_chunks` table | M | pending |
| JRV-041 | Ingest pipeline: store structured chunks + metadata after scraping | M | pending |
| JRV-042 | Retrieval pipeline: keyword + recency hybrid retrieval | L | pending |
| JRV-043 | Token budget manager: assemble context within 80% model limit | M | pending |
| JRV-044 | Memory management API: view count, purge by source, purge all | S | pending |
| JRV-045 | Drizzle migration for `jarvis_knowledge_chunks` | S | pending |

Exit criteria: Jarvis answers from previously scraped knowledge without re-scraping. Memory is indefinite and bounded.

#### Sprint 5 — Additional Context Sources

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-050 | Journal entry context: pull trade notes + tags into retrieval | M | pending |
| JRV-051 | User doc upload API: `POST /api/jarvis/upload` for PDF + plain text | L | pending |
| JRV-052 | Upload UI: file drop zone, upload status, manage uploaded docs | M | pending |
| JRV-053 | Source attribution labels: `web_source`, `trade_journal`, `user_document`, `cached_headline` | S | pending |
| JRV-054 | UI: color-coded source badges on each citation | S | pending |

Exit criteria: Jarvis blends web + journal + uploaded doc context with explicit attribution per finding.

### Phase D — Orchestrated Jarvis (Sprint 6)

#### Sprint 6 — Orchestration Pipeline + Macro Summary

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-060 | Macro headline cron job: scrape allowlisted sources per region on schedule | L | pending |
| JRV-061 | Macro source allowlist: curated domains per region (US, EU, Asia, global) | M | pending |
| JRV-062 | Orchestration engine: plan -> retrieve -> summarize -> critique -> answer | L | pending |
| JRV-063 | Macro summary mode: new `macro-summary` JarvisMode with country-by-country output | M | pending |
| JRV-064 | UI: macro summary action card with region breakdown | S | pending |

Exit criteria: Jarvis produces a daily macro summary from cached headlines using multi-step reasoning. Pipeline is reusable.

### Phase E — Production-Ready (Sprint 7, parallel from Phase B onward)

#### Sprint 7 — Safety, Governance, and Cost Controls

| Ticket | Description | Size | Status |
|---|---|---|---|
| JRV-070 | Per-user rate limiting (target: 30 requests/hour) | M | pending |
| JRV-071 | Token budget tracking: log input/output tokens per request, aggregate per user/day | M | pending |
| JRV-072 | Circuit breaker: disable LLM on high error rate, fall back to deterministic | S | pending |
| JRV-073 | Robots.txt respect before scraping | S | pending |
| JRV-074 | Scrape cache layer: cache by URL + hash with configurable TTL | M | pending |
| JRV-075 | Observability endpoint: `/api/jarvis/stats` for latency, errors, tokens (admin only) | M | pending |
| JRV-076 | Eval harness: golden prompt set + automated quality scoring per release | L | pending |

Exit criteria: Safe to scale with predictable performance and cost. Regression quality tracked automatically.

## Build Order

| Phase | Sprints | Milestone |
|---|---|---|
| Phase A | Sprint 0 + Sprint 1 | Organized Sources |
| Phase B | Sprint 2 + Sprint 3 | High-Signal Scraping |
| Phase C | Sprint 4 + Sprint 5 | Memory Jarvis |
| Phase D | Sprint 6 | Orchestrated Jarvis |
| Phase E | Sprint 7 (parallel from Phase B) | Production-Ready |

## Progress Log

| Date | Update |
|---|---|
| 2026-03-07 | JRV-033 completed: added `JarvisStructuredResponse` renderer with visual section hierarchy (`TL;DR`, findings, action steps, risks), warning styling, and clickable source links with relevance/ticker badges; wired `JarvisTab` to use the new renderer and added UI-focused rendering tests. |
| 2026-03-07 | JRV-034 completed: improved deterministic fallback quality in `buildStructuredFallbackFromSources` (rank-aware findings, ticker-aware actions, confidence-aware risks) and made route-level fallback message schema-consistent via `formatStructuredMessage`. |
| 2026-03-07 | JRV-032 completed: added `parseJarvisLlmResponse` validation/parsing + structured fallback helpers, integrated route-level parser fallback, and added regression coverage in response/scrape/route tests with `scraped source` context ranking contracts. |
| 2026-03-07 | JRV-031 implemented in the route layer: consolidated strict system prompt for schema-only JSON output and added regression coverage asserting prompt contract shape. |
| 2026-03-07 | JRV-030 marked done; structured Jarvis response schema now enforced end-to-end with parser/fallback coverage and explicit contract tests in route handler. |
| 2026-03-07 | Jarvis LLM provider switched from GLM-4.7 to DeepSeek V3.2 via NVIDIA API. Updated `.env.example`, `CODEX_PROMPT.md`, `app/api/jarvis/route.ts` constants, and tests to reflect the change. |
| 2026-03-06 | Plan created. Current state documented. Sprint board defined. Locked decisions captured. |
