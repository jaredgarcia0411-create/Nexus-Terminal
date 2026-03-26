# AskEdgar Public Surface and Likely SEC-Data Pipeline
**Researched**: 2026-03-25
**Sources**: Public website pages, public OpenAPI/endpoint behavior, SEC docs, third-party reviews, and codebase usage evidence
**Context**: Public-source inference about how AskEdgar likely gets, organizes, and analyzes SEC filing data

---

## Concept Overview
AskEdgar appears to be a filing-intelligence product focused on small-cap and micro-cap equities, especially financing, dilution, compliance, and catalyst detection. The public surface suggests the real value is not raw SEC access itself, but a layer that normalizes entity/ticker data, extracts structured terms from messy narrative filings, computes proprietary risk heuristics, and then packages that into screeners, alerts, and AI summaries.

The strongest signals point to a hybrid pipeline: SEC ingestion + market/reference data joins + rule-based extraction + analyst/manual QA on share-structure fields + AI labeling/summarization on top.

## How It Works
The SEC already exposes real-time submissions and XBRL APIs without auth or API keys: `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`. That means AskEdgar almost certainly does **not** pay for raw filing access as its moat. Instead, it likely:

1. Pulls new SEC filings from EDGAR in near real time.
2. Maps filings to issuers/tickers/CIKs and security context.
3. Classifies filings into domain-specific events like offerings, registrations, reverse splits, ROFRs, compliance notices, ownership updates, and catalysts.
4. Extracts structured fields from exhibits, footnotes, and prose that raw EDGAR does not normalize.
5. Joins filing-derived data with market/reference/news data.
6. Computes risk scores and screening fields.
7. Publishes those outputs through a UI, alerts, API, Discord/email feeds, and AI copilot/report layers.

## Public Findings

### 1. Value-add beyond raw EDGAR is explicit on their own site
- `https://www.askedgar.io/` says AskEdgar "monitors every SEC filing in real time," extracts strategy-specific data points, and delivers instant alerts.
- `https://www.askedgar.io/platform/api` says it offers "audited, filing-sourced datasets and proprietary intelligence," including analyst-audited float/share data, dilution event records, pump-and-dump intelligence, registration-rights data, and enriched news signals.
- `https://www.askedgar.io/platform/dilution` emphasizes color-coded offering/dilution risk, warrant/convertible monitoring, and Nasdaq compliance tracking.

Confidence: **High**. This is first-party positioning and matches the exposed endpoints.

### 2. The public API surface is unusually specific to small-cap financing workflows
Publicly reachable docs and endpoint discovery show these routes:
- `https://eapi.askedgar.io/endpoints`
- `https://eapi.askedgar.io/v1/docs`

Observed public endpoint families include:
- share structure: `float-outstanding`, `historical-float-pro`, `ownership`
- financing/dilution: `dilution-rating`, `dilution-data`, `offerings`, `registrations`, `agreements`, `rofr`
- risk/compliance: `nasdaq-compliance`, `pump-and-dump-tracker`
- enrichment/AI: `news`, `filing-titles`, `ai-chart-analysis`, `research-reports*`, `market-strength`
- distribution/screening: `screener`, `screener/options`, `gap-stats`

That endpoint mix strongly implies AskEdgar is organized around **event/entity intelligence**, not document retrieval alone.

Confidence: **High**. This comes from live public endpoint discovery plus public Swagger.

### 3. They likely use a normalized entity/security master with ticker-history support
The public OpenAPI schema for `historical-float-pro` includes fields like `cik`, `oldtickers`, `is_adr`, `ads_ratio`, `number_classes`, and `classes_details`. That suggests a normalization layer that resolves:
- ticker <-> CIK mappings
- ticker changes over time
- ADR/ADS adjustments
- multiple share classes
- issuer-level vs security-level quantities

Without that layer, historical float and ownership would be noisy or wrong, especially in micro-caps with ticker changes, foreign issuers, and dual-class structures.

Confidence: **High**. Those fields are visible in the public OpenAPI schema.

### 4. Their float/share data is likely a hybrid of rules + manual QA
First-party marketing says: "Every share count is manually audited by our analyst team" and "our research team manually audits every share count" on `https://www.askedgar.io/platform/api`.

That is believable because float/tradable-float is one of the hardest values to compute automatically from SEC text. AskEdgar also distinguishes:
- `float`
- `tradable_float`
- `outstanding`

and publicly defines tradable float as float minus restricted shares, lock-ups, and other non-tradable shares. That usually requires reading filing prose/exhibits, not just XBRL facts.

Confidence: **High** that manual QA exists; **Medium-High** that it focuses on the hardest share-structure names and exceptions rather than every row equally.

### 5. Dilution scoring is probably a composite heuristic, not a pure ML model
The public schema for `dilution-rating` breaks the overall output into components:
- `offering_ability`
- `dilution`
- `offering_frequency`
- `cash_need`
- `nasdaq_compliance`
- `warrant_exercise`
- `overall_offering_risk`
- `estimated_cash`, `cash_burn`, `cash_remaining_months`, `total_debt_final`

This looks like a weighted rules engine over normalized filing and financial features. The wording on `https://www.askedgar.io/platform/dilution` also supports this: monitor offering frequency, cash positions, shelf capacity, warrants, and compliance to assess risk.

Likely inputs:
- active/effective shelf registrations and ATM capacity
- recent offering cadence
- warrants/convertibles in the money
- cash runway and debt pressure
- compliance/delisting stress
- recent resale registrations and selling shareholder setups

Confidence: **High** that scoring is heuristic/composite; **Medium** on exact weighting.

### 6. Filing categorization likely mixes form-type rules with clause extraction
Public endpoints split related concepts into separate datasets:
- `offerings`
- `registrations`
- `agreements`
- `rofr`
- `nasdaq-compliance`
- `filing-titles`

That implies they are not just storing the SEC form type. They appear to classify at a finer level such as:
- shelf vs ATM vs equity line vs direct offering
- resale registration vs primary issuance
- registration rights / participation rights / equity restrictions
- ROFR and tail-financing clauses in underwriting agreements
- deficiency notices and compliance status

Those are usually buried in exhibits, underwriting agreements, prospectus supplements, and narrative 8-K/S-1/S-3 text. Their own homepage explicitly says the edge lives in "footnotes, exhibits, and narrative disclosures."

Confidence: **High**.

### 7. News is probably a unified event feed, not just external headlines
The public `news` schema includes `form_type`, `summary`, `body`, `tags`, `channels`, `title`, `author`, `url`, plus filters like `hide_news` and `hide_filings` and many semantic tags. That suggests a merged feed combining:
- filing-derived event summaries
- external news/press releases
- AI-tagged catalyst categories

The tag list is broad: offerings, dilution, FDA, legal disputes, payment defaults, buybacks, executive comp, AI, cash runway, etc. That looks like an internal event taxonomy used across UI, alerts, and screening.

Confidence: **High** that a unified normalized event layer exists; **Medium** on exactly which external news vendors feed it.

### 8. Pump-and-dump tracking likely joins SEC, market, and social-promo evidence
AskEdgar markets "pump-and-dump intelligence sourced from encrypted messaging channels" on `https://www.askedgar.io/platform/api`. The public schema includes:
- `lock_up_expiration`
- `underwriters`
- liquidation history
- country/underwriter/float/scam risk
- `relevant_url`

The API docs also define `scam_risk` using evidence on WhatsApp, Telegram, or Discord. That implies a multi-source risk model with inputs from:
- IPO/de-SPAC and lock-up data
- underwriter history
- low tradable float
- liquidation/resale patterns
- promotion signals from chat/social sources

Confidence: **Medium-High**. Public docs are explicit about the feature, but external-source coverage depth is not independently verifiable.

### 9. AI is layered on top of structured data, not replacing it
The public product and third-party reviews consistently describe:
- filing summaries
- transcript summaries
- question-answering across filings/transcripts
- AI-generated filing titles
- AI research reports and market-strength analysis

But the core API is mostly structured tables. That suggests AI sits downstream of ingestion/extraction, likely for:
- summarization
- headline generation
- semantic tagging
- copilot retrieval/Q&A
- narrative report generation

Confidence: **High**.

## Likely Internal Pipeline Architecture

### Ingestion
- SEC real-time submissions/XBRL + bulk archives: `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`
- likely full-text filing HTML/exhibit fetches from SEC archives
- additional market/reference/news/social inputs for price, volume, short metrics, news, and promotion evidence

### Normalization
- issuer/security master keyed by CIK, ticker, historical tickers, ADR ratios, share classes
- document store for filing metadata, raw filing text, exhibits, extracted tables/sections
- canonical event taxonomy for offerings, registrations, agreements, compliance, ownership, splits, catalysts

### Extraction
- rule-based parsers for common filing families (S-1/S-3, 424B*, 8-K, prospectus supplements, underwriting agreements, registration-rights agreements)
- text extraction from exhibits/footnotes/narratives
- field extractors for offering amounts, share counts, warrant terms, conversion prices, ROFR/tail clauses, compliance notices
- fallback AI/LLM extraction for harder unstructured clauses

### QA and enrichment
- analyst review queue for hard names and share-structure exceptions
- joins to market data, exchange/compliance data, ownership sources, and outside news/social channels
- de-duplication across amended filings and repeated disclosures

### Derived intelligence
- dilution heuristic engine
- tradable-float calculator
- compliance risk/status tracker
- promoter/underwriter/country risk heuristics
- AI summaries, filing headlines, reports, and copilot retrieval indexes

### Delivery
- REST API, screener tables, ticker pages, real-time alerts, Discord/email feeds, and async report generation

## Observable Infra Signals
- `https://eapi.askedgar.io/health` returns healthy components for `api` and `redis`, so Redis is publicly confirmed.
- The generated OpenAPI and schema style strongly suggest a Python FastAPI/Pydantic backend.
- The report endpoints say to poll for completion and the marketing promises fast alerts, which implies background jobs/queues for extraction and AI generation.

Confidence: **High** on Redis + FastAPI-style API; **Medium-High** on background-worker architecture.

## How It Applies Here
Your codebase treats AskEdgar as a structured filing-intelligence provider, not a raw SEC fetcher:
- `lib/jarvis/askedgar.ts`: calls endpoints like `float-outstanding`, `dilution-rating`, `dilution-data`, `offerings`, `registrations`, `news`, `nasdaq-compliance`, `pump-and-dump-tracker`, `agreements`, `historical-float-pro`, and `filing-titles`.
- `app/api/askedgar/lookup/route.ts`: combines AskEdgar output with market snapshot data, which mirrors the likely AskEdgar internal pattern of joining filing intelligence with market/reference data.

## Known Unknowns
- Exact market/news/social vendors are not publicly documented.
- "Manual audit" scope is unclear: all names vs only complex/high-traffic names.
- The exact balance of deterministic extraction vs LLM extraction is not public.
- Some public docs mention "updated within 24 hours," while first-party marketing also says "real time" and "instant alerts." Likely explanation: raw filing detection is real time, but some deeper datasets are refreshed later or prioritized for in-play names.

## Recommended Default Mental Model
Treat AskEdgar as a **specialized SEC intelligence layer** built on top of public EDGAR, optimized for small-cap financing and risk workflows. Its moat is most likely:
- normalization of messy filing data
- share-structure QA
- financing/dilution event extraction
- proprietary heuristics and taxonomies
- workflow packaging into alerts, screeners, and AI summaries

## Source List
- SEC EDGAR APIs: `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`
- AskEdgar homepage: `https://www.askedgar.io/`
- AskEdgar API marketing page: `https://www.askedgar.io/platform/api`
- AskEdgar dilution page: `https://www.askedgar.io/platform/dilution`
- AskEdgar public endpoints index: `https://eapi.askedgar.io/endpoints`
- AskEdgar public Swagger docs: `https://eapi.askedgar.io/v1/docs`
- AskEdgar health endpoint: `https://eapi.askedgar.io/health`
- AskEdgar public app gainers page: `https://app.askedgar.io/gainers`
- AskEdgar public ticker page example: `https://app.askedgar.io/ticker/API/news`
- AskEdgar blog comparison with FlashSEC: `https://www.askedgar.io/blog/10`
- AskEdgar blog comparison with EdmundSEC: `https://www.askedgar.io/blog/11`
- AskEdgar blog comparison with AlphaSense: `https://www.askedgar.io/blog/12`
- Third-party review: `https://daytradereview.com/askedgar-review/`
- Third-party profile: `https://privateopinion.substack.com/p/po-co-1-askedgar`
- Podcast landing page: `https://www.friendlybearpodcast.com/1782340/episodes/15232542-askedgar-how-to-use-the-best-ai-sec-filings-tool`

## Follow-up Questions
- Which endpoints map most directly to a cloneable MVP?
- Which parts likely require analysts/humans versus automation?
- How would I build a cheaper internal version for one strategy only?

---
*To continue learning, use: `/research more about AskEdgar endpoint design` or ask follow-up questions.*
