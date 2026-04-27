# Ask Edgar Buildout

Date: 2026-04-24

## Summary

Nexus Terminal should not treat this as a full Ask Edgar replacement. The safer path is to replace the low-interpretation, SEC-derived surfaces first, keep the current UI contract stable, and leave the high-interpretation Ask Edgar features behind an adapter until a first-party pipeline is mature.

Current Ask Edgar usage is centralized in [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:465), which fans a ticker into 17 endpoint calls and serves two downstream contracts:

- Normalized UI snapshot via [app/api/askedgar/snapshot/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/snapshot/route.ts:25)
- Raw per-endpoint payloads for TLDR and agent flows via [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:139) and the agent blueprints

That makes the server adapter layer the correct insertion point for any phased replacement.

## Current Ask Edgar Surface Used In Repo

Active fan-out in [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:481):

- `/v1/float-outstanding`
- `/v1/screener`
- `/v1/dilution-rating`
- `/v1/dilution-data`
- `/v1/offerings`
- `/v1/offerings` with `offering_type=NEW EQUITY LINE`
- `/v1/registrations`
- `/v1/news`
- `/v1/nasdaq-compliance`
- `/v1/pump-and-dump-tracker`
- `/v1/agreements`
- `/v1/historical-float-pro`
- `/v1/reverse-splits`
- `/v1/filing-titles`
- `/v1/gap-stats`
- `/v1/ownership`
- `/v1/split-status`

Primary dependencies:

- Research ticker UI via [components/trading/ResearchTickerView.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchTickerView.tsx:34)
- Snapshot route via [app/api/askedgar/snapshot/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/snapshot/route.ts:25)
- TLDR route via [app/api/askedgar/tldr/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/tldr/route.ts:31)
- Research blueprints via [lib/agents/blueprints/small-cap-research.ts](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts:808) and [lib/agents/blueprints/swing-trader-research.ts](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts:828)

## Recommended Replacement Order

### Key refinements from follow-up review

- `agreements` should not be treated as directly replaceable. It is SEC-sourceable, but reliable extraction depends on exhibit parsing and contract-clause classification.
- `registrations` should be split into two jobs: basic filing/effective-status metadata, then advanced capacity math such as baby-shelf limits, amount sold, ATM remaining, and raisable amount.
- `filing-titles` should be split into basic SEC filing metadata versus AI/human catalyst headlines. Metadata is easy; headline parity requires summarization or rules.
- `gap-stats` is replaceable in house, but not from SEC alone. It needs historical daily/intraday OHLC, premarket data, VWAP, market-cap snapshots, and catalyst tagging.
- `dilution-rating` should be a Nexus-owned risk model with evidence and confidence, not a clone of Ask Edgar's proprietary rating.
- Advanced endpoints from `docs/AE_API_DOCS.md` should be tracked separately even though they are not in the current 17-endpoint fan-out: `offerings-advanced`, `dilution-data-advanced`, `rofr`, `screener/options`, `ai-chart-analysis`, `research-reports`, `research-reports-short`, `research-reports-tldr`, and `market-strength`.

### Best first-wave candidates

- [ ] `reverse-splits`
- [ ] `split-status`
- [ ] Basic `offerings`
- [ ] Insider `ownership`
- [ ] Historical outstanding-share snapshots from `historical-float-pro`
- [x] Basic filing metadata now coming from `filing-titles` and filing feeds — shipped 2026-04-27 (`b4a3e73`) via `lib/sec/submissions.ts`

### Medium-complexity candidates

- `float-outstanding`
- Basic `registrations`
- Basic `nasdaq-compliance`
- Derived float/tradable-float snapshots
- `dilution-data` issuance terms and security ledgers
- `dilution-rating` as a new Nexus rating model, not a clone of Ask Edgar's proprietary score

### Later or narrower replacements

- `screener`
- `pump-and-dump-tracker`
- `news` summaries
- `filing-titles` if we still want high-quality human headlines without building our own summarization/extraction layer
- `gap-stats`
- `market-strength`
- `agreements`
- `rofr`
- `offerings-advanced`
- `dilution-data-advanced`
- `ai-chart-analysis`
- `research-reports`, `research-reports-short`, and `research-reports-tldr`

## SEC Coverage Matrix

### Directly replaceable enough for first wave

- `reverse-splits`
- `split-status` with a state machine and source evidence
- Basic `offerings`
- Insider `ownership` from structured ownership filings
- Basic filing metadata behind `filing-titles`

### Replaceable with SEC plus market data plus derived logic

- `float-outstanding`
- `historical-float-pro`
- `registrations`
- `gap-stats`
- `market-strength`
- `screener` as a bounded Nexus subset
- `nasdaq-compliance`

### SEC-sourceable but extraction-heavy

- `dilution-data`
- `agreements`
- `rofr`
- `offerings-advanced`
- `dilution-data-advanced`
- high-quality filing headlines and summaries

### Nexus-native AI/reporting surfaces

- `dilution-rating`
- `ai-chart-analysis`
- `research-reports`
- `research-reports-short`
- `research-reports-tldr`

These should be generated from first-party evidence packets and current market context. Do not preserve Ask Edgar wording or scoring semantics unless the output is explicitly marked as vendor-sourced.

### Not worth full parity replacement

- `pump-and-dump-tracker`
- full `screener` parity, especially borrow availability and fee-rate fields
- proprietary `news` commentary sources such as analyst/social content not owned by Nexus
- off-platform social/coordination evidence inside `pump-and-dump-tracker`

## Official SEC Sources Worth Building Around

- `data.sec.gov` EDGAR APIs: submissions and XBRL/companyfacts
- SEC filing indexes and raw filing directories
- SEC full-text search for filing and exhibit discovery
- Ownership technical specs and structured ownership filings
- 13F datasets
- Form D datasets
- Regulation A datasets
- Fails-to-deliver data

## Non-SEC Sources Needed

The target is an accurate dilution and capital-structure view, not an SEC-only clone. These data classes need external feeds or a deliberate no-parity decision:

- Market data: daily and intraday OHLCV, premarket high/volume, VWAP, live/delayed quotes, market cap snapshots, top gainers, and multi-day performance. The repo already has Massive/Polygon-compatible helpers in [lib/massive-market.ts](/home/jared/Nexus-Terminal/lib/massive-market.ts:139) and TradingView gainers in [app/api/tradingview/gainers/route.ts](/home/jared/Nexus-Terminal/app/api/tradingview/gainers/route.ts:17).
- Corporate actions and listings: Nasdaq Daily List or equivalent corporate-action data for split/effective-date validation, ticker changes, delistings, and market-tier changes.
- Compliance data: Nasdaq noncompliance list plus issuer filings/press releases for deficiency and cure details.
- Short/settlement data: FINRA short-interest files/API for periodic short interest, SEC fails-to-deliver files for FTD history, and threshold lists where available. These do not replace live borrow availability or fee rates.
- News: Massive/Polygon news or another licensed news source for non-SEC news; SEC filings can be first-party.
- Queue/cache infrastructure: Vercel Cron can trigger lightweight syncs, but larger ingestion should use a durable queue or worker path such as QStash, a dedicated worker, or another background job system. Upstash Redis is useful for rate-limit state, dedupe locks, and short-lived extraction queues.
- Raw document storage: Postgres should own metadata, normalized facts, and extracted terms. Full raw filing text and exhibits may belong in object storage such as S3/R2/Vercel Blob if volume grows.

## Storage Model

Use a three-layer model: raw source records, extracted facts/events, and point-in-time state snapshots.

### Raw SEC layer

- `sec_entities`
- `sec_filings_raw`
- `sec_facts_raw`
- `sec_dataset_ingests`
- `sec_filing_documents`
- `sec_exhibits_raw`

Each record should preserve source metadata, ingestion time, accession number, and the raw upstream payload or extracted filing text.

### Extracted facts and events layer

- `sec_split_events`
- `sec_offering_events`
- `sec_registration_states`
- `sec_agreement_terms`
- `sec_ownership_positions`
- `sec_share_structure_snapshots`
- `sec_security_terms`
- `sec_security_balance_events`
- `sec_compliance_events`
- `sec_filing_summaries`
- `market_price_snapshots`
- `market_gap_events`
- `ticker_risk_snapshots`

Keep raw SEC facts separate from Nexus inferences. Do not collapse extracted facts and scored opinions into the same fields.

### As-of state layer

To answer "what is the active dilution and company structure right now?" or "how has the story changed?", the app needs point-in-time state, not just latest rows.

Recommended state tables:

- `capital_structure_states`: one row per ticker/CIK/as-of timestamp with outstanding shares, authorized shares, public float, tradable float, market cap, source freshness, and confidence.
- `dilution_overhang_states`: active warrants, prefunded warrants, convertibles, equity lines, ATM capacity, shelf capacity, registration effectiveness, shares underlying derivative securities, and dollar/share overhang.
- `registration_capacity_states`: effective registrations, expiration dates, baby-shelf status, amount registered, amount sold, amount remaining, and evidence.
- `ticker_story_events`: narrative timeline events such as offering announced, EFFECT filed, ATM used, reverse split approved, compliance deficiency, warrant repricing, or major holder disposal.
- `risk_model_snapshots`: Nexus risk score, inputs, evidence IDs, model version, and confidence.

Do store the data needed to reconstruct history. Do not rely only on latest cache rows. The value of this buildout is the ability to ask "as of this date, what could they sell, what was already registered, what derivative overhang existed, and what changed since the last run?"

## Pipeline Shape

### Ingestion

- Poll `submissions/CIK##########.json` for watched names
- Nightly backfill from SEC bulk archives
- Import slower datasets like `13F`, `Form D`, `Reg A`, and FTD on their own schedule
- Pull raw filing documents and exhibits only for forms/classes that matter to dilution, registrations, splits, ownership, agreements, and compliance
- Keep a CIK/ticker/exchange identity map with former tickers and symbol changes

### Parsing

- Filing metadata parser
- Filing text/exhibit extraction
- Event extraction for offerings, splits, agreements, and ownership
- Stateful security ledger for warrants, convertibles, and registration usage
- XBRL fact extraction for cash, debt, shares outstanding, burn-rate inputs, and financial runway
- Clause extraction for registration rights, participation rights, equity restrictions, ROFR, tail financing, anti-dilution, reset, and price-protection terms
- Market-data enrichment for price, market cap, gap history, VWAP, premarket levels, and volume context

### Serving

- Preserve current `rawData` section keys where practical so existing TLDR and blueprint flows keep working
- Normalize into the current `ResearchSnapshot` contract from [lib/types.ts](/home/jared/Nexus-Terminal/lib/types.ts:222)
- Include source, freshness, parser version, and confidence metadata in internal server-side packets even if the first UI pass only displays a subset
- Support `asOf` reads for agents and future UI views so reports can explain how structure changed over time

## Site and Agent Integration

### Adapter boundary

Do not start by changing every UI component and blueprint. Add a provider layer behind [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:465) or a new sibling module that can return the same `rawData` keys from mixed sources.

Recommended shape:

- `getResearchData(ticker, { asOf, sources })` returns `{ rawData, normalizedSnapshot, evidence, freshness, warnings }`.
- `rawData['offerings']`, `rawData['registrations']`, `rawData['dilution-data']`, and similar keys remain available while their source changes from Ask Edgar to Nexus tables.
- Each endpoint section gets a `source` field internally: `askedgar`, `nexus-sec`, `nexus-market`, `nexus-llm`, or `mixed`.
- Cache keys include source and parser/model versions so stale Ask Edgar semantics do not mix with first-party semantics.

### Site surfaces

Initial UI work should preserve the existing Research view, then add confidence and history where it matters.

- Keep [app/api/askedgar/snapshot/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/snapshot/route.ts:25) returning the client-safe `ResearchSnapshot` contract until the replacement is stable.
- Add a server-only evidence packet for TLDR and specialist agents; do not send raw filings or full raw endpoint payloads to the browser.
- Add a "Capital Structure Timeline" section later: outstanding/float changes, active registrations, offerings, warrant/convertible changes, reverse splits, compliance events, and source links.
- Add freshness badges: "SEC filing parsed 4h ago", "market data delayed", "Ask Edgar fallback", "low confidence extraction", or "manual review needed".
- Keep the current `gap-stats` mapping issue in mind: canonical Ask Edgar raw rows use `high_price`, while the normalized mapper currently reads `intraday_high` first.

### Research blueprints

The blueprints currently read raw `rawData[...]` sections directly, so source swaps need compatibility.

- Replace direct Ask Edgar fetches in `fetch-filings` steps with the new provider only after it can emit the old raw keys.
- For `small-cap:research`, provide a structured dilution packet: active registrations, offering history, security ledger, current overhang, cash runway, compliance events, recent filings/news, and evidence IDs.
- For `swing:research`, provide a lighter packet: recent filings/news, dilution rating, market theme context, gap/runner history, ownership/float context, and evidence IDs.
- For autonomous scans, use the Nexus screener subset plus Massive/TradingView for candidates. Do not require full Ask Edgar screener parity before replacing filing/dilution context.
- Prompt contracts should require agents to cite evidence IDs and mark `insufficientEvidence` when a registration capacity, remaining warrant balance, or market-data field is not reliable.
- Report outputs should preserve deterministic facts from the provider. LLMs can interpret risk, but should not recalculate share counts, overhang, or registration capacity from raw prose.

## Rating System Recommendation

Build a first-party Nexus score instead of trying to recreate Ask Edgar's proprietary ratings.

Suggested components:

- Share structure pressure
- Cash need
- Financing ability
- Warrant and convertible overhang
- Registration readiness
- Compliance and corporate-action risk

Suggested output:

- Numeric score `0-100`
- Mapped band: `Low`, `Medium`, `High`
- Confidence score
- Evidence payload showing which filings and facts drove the score

If evidence is weak or incomplete, return low confidence instead of a fake precise rating.

### Minimum facts for accurate active dilution

The rating is only as good as the state ledger. Minimum viable active-dilution inputs:

- Current and historical outstanding shares, authorized shares, and share classes
- Public float and tradable-float estimate with methodology version
- Active shelves, S-1/F-1 registrations, EFFECT notices, ATMs, equity lines, resale registrations, and expiration dates
- Amount registered, amount sold, amount remaining, and baby-shelf capacity when applicable
- Warrants, prefunded warrants, convertibles, notes, exercise/conversion prices, repricing terms, maturities, registration status, and remaining balances
- Recent offerings, warrant exercises, conversions, amendments, and share issuances
- Cash, debt, burn rate, cash runway, and financing pressure
- Nasdaq compliance status, reverse-split lifecycle, FTD/Reg SHO context, and short interest where available
- Source links, extraction confidence, and the date each fact became known

If a fact is not available, the UI and agents should say so. Guessing "remaining" warrant or ATM capacity from incomplete prose is worse than returning low confidence.

## Key Risks

- Many Ask Edgar endpoints are interpretation layers, not raw SEC transport
- `registrations`, `agreements`, and `dilution-data` require stateful parsing across messy filings and exhibits
- `gap-stats`, `screener`, and `market-strength` need non-SEC market data
- Current raw payload consumers in [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:98) and the blueprints mean source swaps need adapter compatibility
- Cache/versioning should become source-aware to avoid mixing incompatible semantics
- Backend cost is not just hosting. The largest cost is engineering, parser maintenance, data-quality review, and market-data/news/LLM usage.
- "Tradable float" and "remaining overhang" are derived estimates, not clean SEC fields. They need methodology and confidence, not false precision.
- Vendor parity can become a trap. Replace endpoints only where first-party evidence creates a better product or materially lowers ongoing cost.

## Recommended Phase Plan

### Phase 0 - Scope, measurement, and fallback contract

Goal: avoid a multi-month rebuild without knowing whether it beats Ask Edgar.

- Measure current Ask Edgar usage: endpoint calls, unique tickers/day, cache hit rate, failed endpoint rate, and which endpoint fields actually drive UI/agent decisions.
- Define the first target universe: watched tickers, current gainers, and recent agent report tickers. Do not ingest the whole market first.
- Keep Ask Edgar as a source fallback behind the adapter until Nexus facts are at least as useful for the chosen fields.
- Define source-aware response metadata: source, freshness, parser version, confidence, and evidence IDs.
- Acceptance: the app can compare Ask Edgar output and Nexus-derived output for the same ticker without changing the UI.

### Phase 1 - Raw SEC ingestion and identity layer

Goal: own the filing feed and entity mapping.

- Build a compliant SEC client with declared `User-Agent`, rate limiting, retries, and backoff.
- Ingest ticker/CIK/exchange mapping, submissions JSON, companyfacts JSON, filing indexes, and raw filing document metadata.
- Store raw metadata and relevant documents/exhibits by accession number.
- Track former names, former tickers, exchange, CIK, accession number, filing date, report date, form type, file number, primary document URL, and source hash.
- Acceptance: given a ticker, the app can list recent filings and source URLs without Ask Edgar.

### Phase 2 - First-wave event extraction

Goal: replace low-interpretation rows while keeping the current `rawData` contract.

- Implement `reverse-splits`, `split-status`, basic `offerings`, insider ownership, and basic filing metadata.
- Use explicit event tables keyed by CIK, ticker, accession, source document, and event date.
- Keep split status as a lifecycle: pending vote, vote approved, announced/effective, completed.
- Emit compatible raw keys: `reverse-splits`, `split-status`, `offerings`, `ownership`, and `filing-titles` metadata rows.
- Acceptance: Research UI and agent fetch steps can consume first-party rows for these sections with Ask Edgar fallback.

### Phase 3 - Share structure and registration lifecycle

Goal: start answering "what can this company sell now?"

- Build historical outstanding-share snapshots from XBRL/companyfacts, filing cover pages, and extracted share-count language.
- Add float/tradable-float estimates only with methodology and confidence.
- Parse registration statements, amendments, EFFECT notices, prospectus supplements, ATMs, equity lines, and resale registrations.
- Track registration effective status, expiration, registered amount, amount sold, amount remaining, baby-shelf constraints, bank/agent where available, and source evidence.
- Acceptance: the provider can return active registrations and a current share-structure snapshot as of a chosen date.

### Phase 4 - Securities ledger for active dilution

Goal: represent active overhang, not just historical offerings.

- Parse warrants, prefunded warrants, convertibles, notes, SPA terms, exercise/conversion prices, maturities, anti-dilution terms, registration status, amendments, exercises, and conversions.
- Store issuance events separately from balance events. Remaining balances must be stateful and time-aware.
- Reconcile changes from amendments, prospectus supplements, 8-Ks, 10-Q/10-K notes, and ownership filings.
- Emit compatible `dilution-data` rows plus a richer internal `dilution_overhang_state`.
- Acceptance: the app can show current active warrants/convertibles and explain which filings changed the balance.

### Phase 5 - Nexus risk model

Goal: replace `dilution-rating` with an evidence-backed Nexus score.

- Compute share-structure pressure, active overhang, registration readiness, offering frequency, cash need, compliance risk, reverse-split pressure, and market liquidity context.
- Include confidence and missing-fact reasons. A low-confidence score is valid; a precise unsupported score is not.
- Version the model and keep every input row/evidence ID used by each score.
- Feed the score into small-cap and swing research prompts as deterministic input, not as prose for the LLM to reinterpret.
- Acceptance: reports can cite the exact facts behind each dilution-risk conclusion.

### Phase 6 - Market-derived history and bounded screener

Goal: replace the market-dependent pieces that are worth owning.

- Build `gap-stats` from historical daily/intraday OHLCV, premarket data, VWAP, volume, market cap, and filing/news catalyst tags.
- Build a bounded Nexus screener around fields the agents actually need: market cap, price, volume, gain windows, float estimate, active registrations, overhang score, recent offering history, and compliance/split status.
- Keep borrow availability and borrow fee out of first-party parity unless a reliable licensed source is added.
- Acceptance: scans can find candidates and show gap history without Ask Edgar screener/gap-stats for the supported fields.

### Phase 7 - Agreement, ROFR, and advanced extraction

Goal: capture contract rights that materially affect dilution and future financing.

- Extract registration rights, participation rights, equity restrictions, lockups, ROFR, tail financing, bank/agent names, investor/fund names, and price-protection clauses from exhibits.
- Use LLM or NLP extraction only with source spans, confidence, schema validation, and regression fixtures.
- Keep manual-review flags for ambiguous clauses.
- Emit `agreements`, `rofr`, `offerings-advanced`, and `dilution-data-advanced` style rows only after precision is acceptable.
- Acceptance: the provider can identify clause-driven dilution risk with source snippets and confidence.

### Phase 8 - News, summaries, and Nexus-native reports

Goal: replace AI/reporting surfaces with Nexus-owned outputs where they add value.

- Replace SEC-filing parts of `news` with first-party filing feed and filing summaries.
- Keep non-SEC news on Massive/Polygon or another licensed provider.
- Generate `filing-titles` headlines, `ai-chart-analysis`, and research summaries from the same evidence packets used by agents.
- Treat `research-reports`, `research-reports-short`, and `research-reports-tldr` as Nexus-native report products, not vendor endpoints to clone.
- Acceptance: TLDR and specialist reports no longer need Ask Edgar for summaries once first-party evidence coverage is sufficient.

### Phase 9 - Cost and quality gate

Goal: decide whether to expand or stop.

- Run a 30-60 day shadow comparison: Ask Edgar versus Nexus facts for active gainers and watched tickers.
- Track parser precision/recall for key facts, manual-review rate, endpoint fallback rate, DB/storage growth, queue volume, market-data calls, LLM extraction cost, and report quality.
- Expand only if the first-party pipeline either improves accuracy/evidence/history or materially reduces vendor dependency for the fields that matter.
- Keep or restore vendor calls for endpoints where full replacement is expensive and low leverage.

## Cost and Worth-It Assessment

This is worthwhile only if the goal is the one stated here: an accurate, explainable, point-in-time representation of active dilution and company structure. It is not worthwhile as a pure cost-cutting clone of every Ask Edgar endpoint.

Reasons it is likely worth building:

- The highest-value product is not a single latest API response. It is the historical capital-structure ledger: what changed, when it became known, what could be sold, and what evidence supports it.
- Owning raw filings, extracted terms, and state snapshots lets agents answer better questions than Ask Edgar parity: "what changed since last week?", "what is still active?", "what is stale?", and "what is low confidence?"
- SEC data is free, public, auditable, and source-linkable. That matters for reports and agent trust.

Reasons it can become unwise:

- Full replacement of `pump-and-dump-tracker`, full `screener`, advanced agreement extraction, high-quality news, and AI reports can cost more in engineering/LLM/vendor data than using Ask Edgar.
- Market data, news, borrow data, background workers, storage, and extraction evals are ongoing operating costs.
- Parser maintenance is permanent. Financing terms change, companies use inconsistent language, and ADR/multi-class/foreign issuer cases will keep producing edge cases.

Pragmatic rule:

- Build the SEC ingestion, event ledger, registration capacity, securities ledger, and Nexus risk model because they directly support accurate active dilution.
- Build `gap-stats` and a bounded screener only for fields your agents and trading workflow actually use.
- Do not chase full parity for endpoints that depend on proprietary social evidence, borrow data, or broad market/news infrastructure unless the measured value justifies it.

## Endpoints That May Not Be Worth Replacing

- `pump-and-dump-tracker`: keep vendor-backed or replace with a narrower Nexus risk model. Full scam-risk parity needs social/coordination evidence and underwriter/entity graphs that are expensive and legally/ethically sensitive.
- Full `screener`: build a Nexus subset, not full parity. Borrow fee, shares available, and all market/reference filters require separate licensed sources.
- `news` as a complete product: replace SEC-filing news in house; keep a licensed news provider for non-SEC news.
- `market-strength`: defer until the app owns daily gapper/runner history and catalyst tagging.
- `research-reports*`: do not buy or clone if Nexus agents already generate reports from better evidence packets.
- `offerings-advanced`, `dilution-data-advanced`, and `rofr`: defer until exhibit extraction is reliable; these are valuable, but not first-wave replacements.
- `screener/options`: implement only if a Nexus screener UI needs dropdown filters.

## Sources

Repo grounding:

- [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:465)
- [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:139)
- [lib/types.ts](/home/jared/Nexus-Terminal/lib/types.ts:222)
- [app/api/askedgar/snapshot/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/snapshot/route.ts:25)
- [docs/AE_API_DOCS.md](/home/jared/Nexus-Terminal/docs/AE_API_DOCS.md:169)
- [docs/AGENTIC_EXPANSIONV2.md](/home/jared/Nexus-Terminal/docs/AGENTIC_EXPANSIONV2.md:646)
- [lib/massive-market.ts](/home/jared/Nexus-Terminal/lib/massive-market.ts:139)
- [app/api/tradingview/gainers/route.ts](/home/jared/Nexus-Terminal/app/api/tradingview/gainers/route.ts:17)

External:

- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- https://www.sec.gov/edgar/search/efts-faq.html
- https://www.sec.gov/submit-filings/technical-specifications
- https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets
- https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets
- https://www.sec.gov/data-research/sec-markets-data/regulation-data-sets
- https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data
- https://www.sec.gov/file/company-tickers-exchange
- https://www.finra.org/finra-data/browse-catalog/equity-short-interest
- https://www.finra.org/finra-data/browse-catalog/otc-threshold
- https://www.nasdaqtrader.com/trader.aspx/Trader.aspx?id=DailyListPD
- https://www.nasdaq.com/market-activity/stocks/non-compliant-company-list
- https://polygon.io/pricing
- https://neon.com/pricing
- https://vercel.com/docs/functions/usage-and-pricing
- https://upstash.com/pricing/qstash
- https://upstash.com/docs/redis/overall/pricing
