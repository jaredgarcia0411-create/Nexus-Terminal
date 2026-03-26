# SEC EDGAR vs AskEdgar Migration Crash Course
**Researched**: 2026-03-25
**Sources**: SEC official docs, public AskEdgar pages/docs, open-source repo research, codebase analysis
**Context**: Evaluating how to phase out AskEdgar and replace it with a first-party SEC EDGAR ingestion + analysis pipeline for Nexus Terminal.

---

## Concept Overview

You can replace AskEdgar's **data transport** with SEC EDGAR fairly easily. You cannot replace AskEdgar's **normalized intelligence layer** nearly as easily. The SEC gives you filings, filing metadata, and XBRL facts; AskEdgar appears to add issuer normalization, filing/event classification, share-structure QA, dilution heuristics, and trader-friendly summaries.

For your app, the real migration question is not “can I fetch SEC filings?” It is “can I recreate the specific structured outputs my UI and Jarvis prompts already expect?”

## How It Works

### What the SEC gives you directly

1. **Company submissions JSON**  
   `https://data.sec.gov/submissions/CIK##########.json`  
   Per-company filing history, form types, accession numbers, and issuer metadata.

2. **Company facts / XBRL APIs**  
   `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`  
   Standardized financial facts like cash, debt, and shares outstanding when tagged.

3. **EDGAR archive + indexes**  
   `https://www.sec.gov/Archives/edgar/full-index/`  
   Raw filing documents, detail pages, exhibits, daily indexes, and bulk archives.

4. **Bulk datasets**  
   `submissions.zip`, `companyfacts.zip`, DERA financial statement datasets.

### What AskEdgar likely adds on top

1. Ticker/CIK/security normalization, including old tickers and share-class quirks.
2. Filing categorization into product concepts like offerings, registrations, agreements, equity lines, reverse splits, and compliance notices.
3. Term extraction from narrative filings/exhibits: warrant exercise prices, baby shelf status, ATM capacity, conversion terms, lockups, etc.
4. Derived scoring: dilution risk, offering ability, offering frequency, cash need, warrant pressure.
5. Analyst/manual QA for difficult share-structure cases.
6. Alerting, screener joins, and AI summaries.

## How It Applies Here

Your current Research flow depends on AskEdgar as a **structured SEC intelligence provider**, not a raw filing fetcher.

## Codebase Evidence

- `lib/jarvis/askedgar.ts`: fetches 14 AskEdgar endpoint payloads in parallel, including `dilution-rating`, `dilution-data`, `offerings`, `registrations`, `agreements`, `historical-float-pro`, `reverse-splits`, and `filing-titles`.
- `components/trading/ResearchReportSections.tsx`: UI logic expects normalized fields like `over_baby_shelf`, `baby_shelf_raisable_amount`, `is_atm`, `warrants_exercise_price`, `offering_type`, and reverse split metadata.
- `lib/jarvis/prompts.ts`: Jarvis prompt wording explicitly says “Analyze this AskEdgar data”, meaning prompt design assumes pre-normalized endpoint arrays instead of raw SEC documents.
- `app/api/askedgar/gainers/route.ts`: current Research sidebar depends on AskEdgar screener-style market data, which SEC EDGAR does not provide.

## SEC Official Sources

### Official source 1: EDGAR API docs
URL: `https://www.sec.gov/search-filings/edgar-application-programming-interfaces`

Key takeaways:
- SEC documents `submissions`, `companyfacts`, `companyconcept`, and `frames` APIs.
- SEC updates live APIs in near real time and republishes bulk ZIPs nightly.
- SEC does **not** offer AskEdgar-style dilution/event summaries.

### Official source 2: EDGAR data access guidance
URL: `https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data`

Key takeaways:
- Use a descriptive `User-Agent` with contact info.
- Stay at or below roughly `10 requests/second`.
- `data.sec.gov` is server-side only for you anyway; no browser CORS support.
- Archives/indexes are the canonical source for filing packages and exhibits.

## Public AskEdgar Evidence

### Non-official/public source 1: AskEdgar API/docs
URLs: `https://eapi.askedgar.io/endpoints`, `https://eapi.askedgar.io/v1/docs`

Key takeaways:
- Public endpoint families match your app usage: float/share structure, dilution, offerings, registrations, compliance, agreements, news, reverse splits, filing titles.
- The API wrapper shape (`status`, `count`, `results`) matches your client code exactly.
- Their domain model is already organized around trader questions, not EDGAR raw documents.

### Non-official/public source 2: AskEdgar product pages
URLs: `https://www.askedgar.io/platform/api`, `https://www.askedgar.io/platform/dilution`

Key takeaways:
- AskEdgar markets “audited” filing intelligence, dilution scoring, compliance tracking, and manually audited share counts.
- That strongly suggests a hybrid pipeline: SEC ingestion + normalization + heuristics + human QA.

## Open-Source Patterns

### Best practical TS-first pattern

1. SEC official APIs for discovery and source-of-truth metadata.
2. Store raw filing documents locally in Postgres/object storage.
3. Parse HTML with `cheerio` and XML with `fast-xml-parser`.
4. Build deterministic extractors per form/exhibit type.
5. Compute derived signals after extraction, not during fetch.

### Strong adjacent ecosystem tools

- `dgunning/edgartools` — best open-source EDGAR/XBRL toolkit, but Python-first.  
  URL: `https://github.com/dgunning/edgartools`
- `Arelle/Arelle` — standards-heavy XBRL engine for hard cases.  
  URL: `https://github.com/Arelle/Arelle`
- `alphanome-ai/sec-parser` — useful idea for semantic filing parsing, Python-first.  
  URL: `https://github.com/alphanome-ai/sec-parser`

## Best Practices

1. **Keep a compatibility layer first.**  
   Preserve your current `rawData[endpointKey] = { status, count, results, error? }` contract so the UI does not break immediately.

2. **Split ingestion from interpretation.**  
   SEC fetches should only discover and store filings. A separate layer should classify offerings, registrations, agreements, and risk signals.

3. **Make every derived field traceable.**  
   Store accession number, source document URL, section/exhibit, and extracted snippet for every derived record.

4. **Use XBRL only where it is strong.**  
   Great for cash, debt, and some shares data. Weak for narrative financing terms and dilution event detection.

5. **Mirror nightly, poll intraday.**  
   Use SEC bulk files for efficient backfills and indexes/submissions for intraday updates.

## Common Pitfalls

**Pitfall**: Treating EDGAR as a drop-in AskEdgar replacement.  
**Solution**: Assume SEC replaces transport only. You still need normalization and scoring.

**Pitfall**: Building around undocumented full-text search browser calls.  
**Solution**: Build on `submissions`, archive indexes, and raw filing documents instead.

**Pitfall**: Letting LLMs be the only extractor.  
**Solution**: Use rule-based extraction first, then LLMs only for hard classification/summarization.

## Recommended Default Approach

### Phase 1 — Keep current app contract
- Keep `/api/askedgar/*` routes temporarily.
- Swap backend implementation from AskEdgar API calls to your own SEC-backed service.
- Return the same endpoint keys and wrapper shape.

### Phase 2 — Rebuild the minimum viable endpoint set
Start with the highest-value, most cloneable AskEdgar concepts:
- `filing-titles`
- `reverse-splits`
- `registrations`
- `offerings`
- `agreements`
- `historical-float-pro` (rougher first version)

Delay harder composite endpoints until later:
- `dilution-rating`
- `dilution-data`
- `nasdaq-compliance`
- `pump-and-dump-tracker`

### Phase 3 — Redesign prompts/UI after backend parity
- Once SEC-backed normalized outputs are stable, then decide whether the AskEdgar-shaped schema should remain permanent or evolve.

## Action Checklist

- [ ] Build a server-side SEC client with shared throttling, retries, caching, and a proper `User-Agent`.
- [ ] Create issuer master tables for ticker ↔ CIK ↔ old tickers ↔ share classes.
- [ ] Ingest `submissions` JSON plus EDGAR archive/index metadata.
- [ ] Persist raw filing text, detail pages, and key exhibits.
- [ ] Implement form/exhibit parsers for `S-1`, `S-3`, `F-1`, `F-3`, `424B*`, `8-K`, and financing agreements.
- [ ] Build normalized tables for `registrations`, `offerings`, `agreements`, `reverse_splits`, and `derived_signals`.
- [ ] Add source-linked heuristics for baby shelf, ATM detection, warrant pressure, and offering cadence.
- [ ] Replace gainers/screener dependence with a separate market-data source, because SEC will not cover that.

## Known Unknowns

- How much of AskEdgar’s share-structure data is fully automated vs manually audited is not public.
- Some financing terms may only exist in messy exhibits, PDFs, or inconsistent prose, which increases parsing complexity.
- Historical float/tradable float accuracy is one of the hardest categories to fully automate.

## Follow-up Questions

1. Which AskEdgar endpoints are easiest to clone first for your exact UI?
2. What would a minimal SEC-backed schema look like in your Postgres/Drizzle setup?
3. Which parts should stay rules-based vs use LLM extraction?

### Q: How does each current AskEdgar endpoint map to likely SEC sources?
**Asked**: 2026-03-25
**Answer**:

The strongest evidence is your codebase plus the AIFF AskEdgar page sample you shared. That page links its dilution data mostly to `S-1`, `S-3`, `424B5`, `8-K`, and occasionally `10-K`, which strongly supports the theory that AskEdgar is built on SEC filing discovery + internal extraction/classification.

#### Endpoint mapping table

| Endpoint | Likely SEC source(s) | Filing types involved | Extraction method | Confidence | SEC alone enough? |
| --- | --- | --- | --- | --- | --- |
| `float-outstanding` | `submissions`; `companyfacts` / `companyconcept`; raw filing docs | `10-K`, `10-Q`, `20-F`, `6-K`, `S-1`, `S-3` | Pull latest tagged shares outstanding; reconcile against cover pages / prospectus tables; normalize classes | Medium | Outstanding shares: often yes. True float/tradable float: no |
| `screener` | Very limited SEC role: `company_tickers.json`, `submissions`, optional XBRL fundamentals | Mainly periodic reports if used at all | Join non-SEC market data with optional SEC fundamentals/flags | High | No |
| `dilution-rating` | `companyfacts`; raw filings from archives; submissions history | `S-1`, `S-3`, `424B*`, `8-K`, `10-K`, `10-Q`, `F-1`, `F-3`, `6-K`, `20-F` | Normalize offerings/warrants/convertibles/compliance history, then run a rules engine | High | No |
| `dilution-data` | `submissions`; archive filing packages; exhibit indexes/detail pages | `S-1`, `S-3`, `424B*`, `8-K` | Parse prospectuses, 8-K summaries, purchase agreements, warrant terms, lockups, completed offerings | High | Not directly |
| `offerings` | `submissions`; archive filings; filing detail pages; effectiveness notices | `S-1`, `S-3`, `S-1/A`, `S-3/A`, `424B5`, `424B3`, `424B4`, `424B7`, `8-K`, `F-1`, `F-3` | Classify shelf / ATM / RDO / PIPE / resale / completed offering; extract amount, price, shares, warrants, bank | High | Mostly for discovery, not final normalization |
| `equity-lines` | Raw filing docs and exhibits; submissions | Usually `S-1`, `S-3`, `8-K`, exhibit contracts | Detect ELOC/SEPA structures from agreements and prospectus language | Medium-High | No |
| `registrations` | `submissions`; archive filings; `EFFECT`/effectiveness-related records | `S-1`, `S-3`, `F-1`, `F-3`, amendments, `POS AM`, `424B*`, `EFFECT` | Track registration lifecycle; determine primary vs resale, shelf size, effective date/status | High | Mostly yes for a basic clone |
| `news` | Filing-derived events from SEC + optionally merged external news | `8-K`, `10-K`, `10-Q`, `S-1`, `S-3`, `424B*`, `6-K` | Summarize filing events into news-like cards and tags | High | No, not for a full news product |
| `nasdaq-compliance` | SEC filings disclosing deficiency/regain notices | Mostly `8-K`, sometimes `10-Q`, `10-K`, `6-K` | Search and classify delisting/compliance disclosures | High | Not fully |
| `pump-and-dump-tracker` | Partial SEC inputs only | `S-1`, `424B*`, `8-K`, resale-related filings | Combine low-float/unlock/resale signals with market/promotional heuristics | High | No |
| `agreements` | Archive filing packages and exhibit indexes | `8-K` Item 1.01 + exhibits, `S-1`/`S-3` exhibits, `10-K` exhibits, `6-K` | Parse SPA, underwriting, registration-rights, lock-up, ELOC, warrant, convertible, waiver/amendment terms | High | SEC is the source, but exhibit parsing is required |
| `historical-float-pro` | `companyfacts`; submissions history; archive filings; issuer mapping files | `10-K`, `10-Q`, `20-F`, `6-K`, `S-1`, `S-3`, reverse-split disclosures | Build split-adjusted shares history; estimate float/tradable float from restrictions and ownership language | Medium | Raw shares history: partly. Float/tradable float: no |
| `reverse-splits` | Submissions + archive filings; proxy materials; charter/amendment exhibits | `8-K`, `DEF 14A`, `PRE 14A`, `10-K`, `10-Q` | Detect split ratio/effective date from corp-action disclosures | High | Yes, usually |
| `filing-titles` | `submissions`; archive metadata; filing headers | Any filing type | Start with SEC metadata, then generate trader-friendly normalized titles | High | Raw titles: yes. Better titles: heuristics/LLM help |

#### What the AIFF sample suggests

Your sample file `/mnt/c/Users/jared/Downloads/SEC Filings Ask Edgar site.txt` is especially useful because it shows AskEdgar’s dilution page linking back to specific filing types:

- `S-3` for shelf registrations
- `424B5` for ATM/prospectus supplements
- `8-K` for warrant issuances, private placements, convertibles, lockups, and completed offerings
- `S-1` for equity lines and registration-style financing structures
- `10-K` for some warrant/reset disclosures

That means AskEdgar is probably not doing anything magical for raw data access. It is mostly:
1. finding the right SEC documents,
2. classifying them into financing event types,
3. extracting key terms,
4. presenting them in a trader-native schema.

#### Easiest vs hardest endpoints to clone

**Easiest**
- `filing-titles`
- `reverse-splits`
- `registrations`
- basic `offerings`

**Medium difficulty**
- `agreements`
- `equity-lines`
- basic `float-outstanding`

**Hardest**
- `historical-float-pro`
- `dilution-data`
- `dilution-rating`
- `nasdaq-compliance`
- `pump-and-dump-tracker`
- full `news`
- `screener`

#### Recommended endpoint build order

1. `filing-titles`
2. `reverse-splits`
3. `registrations`
4. `offerings`
5. `agreements`
6. `equity-lines`
7. `float-outstanding`
8. `historical-float-pro`
9. `dilution-data`
10. `dilution-rating`

This order matches both the likely SEC difficulty curve and the lowest-risk migration path for your existing UI.

---
*To continue learning, use: `/research more about SEC EDGAR offerings parsing` or ask follow-up questions*
