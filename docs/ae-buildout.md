# Ask Edgar Buildout

Date: 2026-04-23

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

### Best first-wave candidates

- `reverse-splits`
- `split-status`
- `offerings`
- `ownership`
- Historical outstanding/public-float snapshots from `historical-float-pro`
- Basic filing metadata now coming from `filing-titles` and filing feeds

### Medium-complexity candidates

- `float-outstanding`
- `registrations`
- `dilution-rating` as a new Nexus rating model, not a clone of Ask Edgar's proprietary score
- `agreements`

### Leave with Ask Edgar for now

- `screener`
- `pump-and-dump-tracker`
- `news` summaries
- `filing-titles` if we still want high-quality human headlines without building our own summarization/extraction layer
- `gap-stats`
- `market-strength`

## SEC Coverage Matrix

### Directly replaceable from SEC data

- `reverse-splits`
- `split-status`
- `offerings`
- `agreements`
- `ownership`

### Replaceable with SEC plus market data plus derived logic

- `float-outstanding`
- `historical-float-pro`
- `registrations`
- `gap-stats`
- `market-strength`

### Partially replaceable

- `dilution-rating`
- `dilution-data`
- `news/filings`
- `filing-titles`
- `nasdaq-compliance`

### Not realistically replaceable from SEC alone

- `screener`
- `pump-and-dump-tracker`

## Official SEC Sources Worth Building Around

- `data.sec.gov` EDGAR APIs: submissions and XBRL/companyfacts
- SEC filing indexes and raw filing directories
- SEC full-text search for filing and exhibit discovery
- Ownership technical specs and structured ownership filings
- 13F datasets
- Form D datasets
- Regulation A datasets
- Fails-to-deliver data

## Storage Model

Use a two-layer model in Postgres.

### Raw SEC layer

- `sec_entities`
- `sec_filings_raw`
- `sec_facts_raw`
- `sec_dataset_ingests`

Each record should preserve source metadata, ingestion time, accession number, and the raw upstream payload or extracted filing text.

### Derived analytics layer

- `sec_split_events`
- `sec_offering_events`
- `sec_registration_states`
- `sec_agreement_terms`
- `sec_ownership_positions`
- `sec_share_structure_snapshots`
- `ticker_risk_snapshots`

Keep raw SEC facts separate from Nexus inferences. Do not collapse extracted facts and scored opinions into the same fields.

## Pipeline Shape

### Ingestion

- Poll `submissions/CIK##########.json` for watched names
- Nightly backfill from SEC bulk archives
- Import slower datasets like `13F`, `Form D`, `Reg A`, and FTD on their own schedule

### Parsing

- Filing metadata parser
- Filing text/exhibit extraction
- Event extraction for offerings, splits, agreements, and ownership
- Stateful security ledger for warrants, convertibles, and registration usage

### Serving

- Preserve current `rawData` section keys where practical so existing TLDR and blueprint flows keep working
- Normalize into the current `ResearchSnapshot` contract from [lib/types.ts](/home/jared/Nexus-Terminal/lib/types.ts:222)

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

## Key Risks

- Many Ask Edgar endpoints are interpretation layers, not raw SEC transport
- `registrations`, `agreements`, and `dilution-data` require stateful parsing across messy filings and exhibits
- `gap-stats`, `screener`, and `market-strength` need non-SEC market data
- Current raw payload consumers in [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:98) and the blueprints mean source swaps need adapter compatibility
- Cache/versioning should become source-aware to avoid mixing incompatible semantics

## Recommended Phase Plan

1. Build raw SEC ingestion plus derived tables for `reverse-splits`, `split-status`, `offerings`, and `ownership`.
2. Add historical share-structure snapshots and a first registration-state model.
3. Introduce an adapter that can serve the existing `rawData` keys from mixed sources.
4. Build a Nexus dilution/risk model only after the underlying fact pipeline is stable.
5. Decide later whether filing headlines, filing summaries, and agreement extraction justify NLP/extraction cost.

## Sources

Repo grounding:

- [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts:465)
- [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts:139)
- [lib/types.ts](/home/jared/Nexus-Terminal/lib/types.ts:222)
- [app/api/askedgar/snapshot/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/snapshot/route.ts:25)
- [docs/AE_API_DOCS.md](/home/jared/Nexus-Terminal/docs/AE_API_DOCS.md:169)

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
