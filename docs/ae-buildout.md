# Ask Edgar Buildout

Updated: 2026-05-19

Purpose: this file is the current source of truth for Nexus Terminal's Ask Edgar usage, cost controls, and first-party replacement roadmap. It supersedes the April 2026 replacement plan, which assumed an older 17-endpoint fan-out and a mostly monolithic `lib/askedgar.ts`.

## Pricing Model

Ask Edgar bills per KB of data returned, not per request. Failed requests are free. Published rates (verified 2026-05): `screener` $0.007/KB, `dilution-rating` $0.004/KB, `dilution-data` $0.018/KB, `offerings` $0.019/KB, `news` $0.013/KB. Six endpoints have no published rate: `registrations`, `nasdaq-compliance`, `agreements`, `gap-stats`, `ownership`, `split-status`. There is a `/v1/estimate` endpoint that previews cost before a real call. Retail rate limit is 200 req/min; we batch 10 at a time, so rate limit is not the constraint.

Because billing is per-KB, the dominant levers are:

1. Call frequency (cache TTL per endpoint).
2. Payload size (filter requests so we do not pay for rows we discard).
3. Endpoint count in scope (do not request endpoints we will not render).

The free-tier daily 50 unique-ticker cap is a free-account guard; paid accounts have no daily ticker cap. The repo currently enforces this cap via `ASKEDGAR_DAILY_LIMIT`; it should be removed or set very high on paid plans.

Invoice attribution gap: because six endpoints lack a public rate, the only authoritative way to know which endpoint dominates the bill is the Ask Edgar dashboard/invoice. Priority 0 telemetry should be designed to reconcile against that invoice.

## Current Status

Nexus Terminal should not try to clone every Ask Edgar product surface. The useful target is narrower: keep the current Research UI and agent contracts stable while replacing low-interpretation, SEC-derived data with first-party parsers, and keep high-interpretation endpoints behind an adapter until Nexus has better evidence, confidence, and history.

The live code now has a split Ask Edgar adapter:

- Endpoint registry: [lib/askedgar/endpoints.ts](/home/jared/Nexus-Terminal/lib/askedgar/endpoints.ts)
- Fan-out and cost log: [lib/askedgar/fanout.ts](/home/jared/Nexus-Terminal/lib/askedgar/fanout.ts)
- Shared cache and scanner summary cache: [lib/askedgar/cache.ts](/home/jared/Nexus-Terminal/lib/askedgar/cache.ts)
- Runtime daily ticker and rate-limit state: [lib/askedgar/runtime-state.ts](/home/jared/Nexus-Terminal/lib/askedgar/runtime-state.ts)
- Snapshot normalizer: [lib/askedgar/snapshot-normalizer.ts](/home/jared/Nexus-Terminal/lib/askedgar/snapshot-normalizer.ts)
- Compatibility barrel: [lib/askedgar.ts](/home/jared/Nexus-Terminal/lib/askedgar.ts)

The live registry has 16 logical endpoint keys. Eleven currently call Ask Edgar. Five are already first-party SEC-backed and do not create Ask Edgar usage cost:

- `offerings`
- `sec-filings`
- `historical-float-pro`
- `reverse-splits`
- `identity-events`

Legacy notes:

- `filing-titles` is no longer in `ENDPOINT_REGISTRY`. It remains only as a compatibility read in the small-cap blueprint and old tests.
- `float-outstanding` and `pump-and-dump-tracker` are not in the current live registry.
- `sec-filings` is the current first-party replacement for Research Filings metadata.

## Product Call Graph

Primary surfaces using the Ask Edgar adapter:

- Research snapshot UI: [app/api/askedgar/snapshot/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/snapshot/route.ts) calls `getCachedTickerData(ticker)` and normalizes into `ResearchSnapshot`.
- Research ticker view: [components/trading/ResearchTickerView.tsx](/home/jared/Nexus-Terminal/components/trading/ResearchTickerView.tsx) loads `/api/askedgar/snapshot`.
- TLDR: [app/api/askedgar/tldr/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/tldr/route.ts) calls [lib/research.ts](/home/jared/Nexus-Terminal/lib/research.ts), which uses `getCachedTickerData`.
- Dashboard scanner summary: [app/api/askedgar/scanner-summary/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/scanner-summary/route.ts) calls `getCachedScannerSummary`.
- Site research report: [app/api/research-report/route.ts](/home/jared/Nexus-Terminal/app/api/research-report/route.ts) uses `generateSmallCapResearchReport`, which calls `getCachedTickerData(ticker, { scope: 'small-cap-research' })`.
- Agent research: [lib/agents/blueprints/small-cap-research.ts](/home/jared/Nexus-Terminal/lib/agents/blueprints/small-cap-research.ts) and [lib/agents/blueprints/swing-trader-research.ts](/home/jared/Nexus-Terminal/lib/agents/blueprints/swing-trader-research.ts) call scoped `getCachedTickerData`.

## Current Cache And Cost Controls

Shared cache:

- `askedgar_cache` is shared across users by `(cache_type, ticker)` in [lib/db/schema.ts](/home/jared/Nexus-Terminal/lib/db/schema.ts).
- `cacheType='ticker'` stores the merged raw endpoint payload for a ticker.
- Ticker cache TTL is 16 hours.
- `news` has a 5-minute freshness window inside the ticker cache row.
- Fresh successful endpoint results merge into the cached superset. A transient error does not overwrite a previously good endpoint response.
- Fully rate-limited results are cached only for the retry window.

Runtime state:

- Daily unique ticker usage lives in `askedgar_daily_tickers`.
- Global rate-limit retry window lives in `askedgar_runtime_state`.
- Module memory is still used as a fast path, but the DB is the durable state across cold starts.
- `ASKEDGAR_DAILY_LIMIT` defaults to 50 when not configured.

Cost telemetry:

- [lib/askedgar/fanout.ts](/home/jared/Nexus-Terminal/lib/askedgar/fanout.ts) logs `[askedgar-fanout]` with requested count, successful count, total `usage.cost_microdollars`, and duration.
- This log is useful but not durable enough for product decisions.
- `scanner-summary` bypasses the fan-out wrapper and directly calls four Ask Edgar-backed helper functions. It is cached for 24 hours but does not participate in the main fan-out cost log or daily ticker guard.

Cost control gaps to fix first:

- Persist endpoint-level telemetry: caller surface, scope, ticker, endpoint, cache hit/miss, cost, duration, and failure kind.
- Route `scanner-summary` through the same metered path, or add equivalent persistent telemetry and daily ticker accounting there.
- Split broad scopes so Research does not fetch every endpoint before the user opens every tab.
- Add source-aware cache metadata so first-party SEC rows, Ask Edgar rows, market rows, and LLM-derived rows do not share ambiguous freshness semantics.

### Recommended Per-Endpoint TTL Tuning

The current 16h blanket TTL is conservative for endpoints whose underlying data only changes on filing events. Recommended TTLs once endpoint-level cache control is in place:

| Endpoint | Current TTL | Proposed TTL | Reason |
| --- | --- | --- | --- |
| `news` | 5 min | 15 min | Headlines refresh through the trading day; 15 min is short enough for catalyst awareness without bursty re-fetches. In-flight coalescing already covers concurrent viewers. |
| `dilution-rating` | 16 hr | 7 days | Composite score recomputed on new filings, not intraday. |
| `dilution-data` | 16 hr | 7 days | Warrants/converts terms change on amendments only. |
| `ownership` | 16 hr | 7 days | 13F/13D/13G are quarterly; Form 4 events bursty but rare per ticker. |
| `historical-float-pro` | 16 hr | 7 days | XBRL outstanding-share series updates on 10-Q/10-K cadence. |
| `gap-stats` | 16 hr | 24 hr | New trading day = new gap; daily refresh is enough. |
| `screener` | 16 hr | 16 hr | Header/cash context; keep as-is. |
| `registrations` | 16 hr | 24 hr | Active shelves rarely change intraday; new S-1/424B5 lands as an event. |
| `nasdaq-compliance` | 16 hr | 7 days | Compliance status updates on 8-K Item 3.01 events. |
| `split-status` | 16 hr | 24 hr | Vote / approval / effective events fire as filings. |

Implementing this needs per-endpoint TTLs in `lib/askedgar/cache.ts` (currently only `news` has a custom window). Build it alongside Priority 0 telemetry so we can measure the cache-hit improvement.

## Scope Inventory

Current scopes in `ENDPOINT_SCOPES`:

- `snapshot`: all 16 registry keys.
- `tldr`: all 16 registry keys.
- `lookup`: all 16 registry keys, but no live `/api/askedgar/lookup` route exists.
- `small-cap-research`: all 16 registry keys.
- `swing-trader-research`: `dilution-data`, `dilution-rating`, `offerings`, `registrations`, `news`, `historical-float-pro`, `gap-stats`, `ownership`.

Recommended scope changes:

- Split `snapshot` into smaller route scopes: overview/header, dilution, news, filings, and history.
- Keep `sec-filings`, `historical-float-pro`, `reverse-splits`, and `identity-events` available to the UI, but do not include them in agent scopes unless the agent actually consumes them.
- Remove the legacy `lookup` scope if no route or caller is restored.
- Remove the dead `filing-titles` compatibility read from small-cap after prompt/tests stop expecting it.
- Consider a cheap `scanner-summary` scope that goes through the main fan-out/cache path.

## Endpoint Matrix

| Registry key | Current backing | Main consumers | Current status | Recommendation |
| --- | --- | --- | --- | --- |
| `screener` | Ask Edgar `/v1/screener` | Research header; small-cap cash fallback | Required for header; fallback-only for agent cash context | Keep short term. Replace with a bounded Nexus header subset using Massive/TradingView for market data plus SEC companyfacts for shares. Do not chase full screener parity. |
| `dilution-rating` | Ask Edgar `/v1/dilution-rating` | Rating tile, cash/runway, management commentary, scanner cash months, agents | Required | Keep until Nexus has an evidence-backed risk model. Build a Nexus score with evidence/confidence rather than cloning Ask Edgar labels. |
| `dilution-data` | Ask Edgar `/v1/dilution-data` | Warrants, convertibles, cash fallback, scanner warrants, agents | Required | Keep for quality now. Replace incrementally with a first-party securities ledger for warrants, prefunded warrants, convertibles, amendments, exercises, conversions, and remaining balances. |
| `offerings` | First-party SEC parser | Past offerings table; agents | Required conceptually; not Ask Edgar-billed | Keep first-party. Continue improving parser coverage and confidence metadata. |
| `sec-filings` | First-party SEC submissions | Filings tab preferred source | Required; not Ask Edgar-billed | Keep first-party. This should fully own filing metadata. |
| `equity-lines` | Ask Edgar `/v1/offerings?offering_type=NEW EQUITY LINE` | Equity Lines panel; scanner `hasEl`; small-cap prompt | Required for flags; optional as a visible row set | Medium-priority replacement from SEC registration/prospectus/8-K/SPAs. Cache longer than 16h unless a new filing lands. |
| `registrations` | Ask Edgar `/v1/registrations` | Active shelves, S-1/F-1, ATM, baby shelf, scanner ATM/S-1/EL flags, agents | Required | High-priority replacement. Start with SEC metadata/effective status, then add capacity math, amount sold, amount remaining, ATM remaining, and baby-shelf rules. |
| `news` | Ask Edgar `/v1/news?limit=40` | News tab, TLDR latest headline, agent catalyst feed; filing fallback | Required for non-SEC catalyst/news; fallback-only for filings | Short term: filter to `news`/`8-K`/`S-1` form types to drop payload (we already prefer `sec-filings` for the Filings tab). Evaluate `/v1/news-basic` as a smaller-payload drop-in. Long term: Polygon or another licensed news vendor for non-SEC news; keep `sec-filings` as the filing source. |
| `nasdaq-compliance` | Ask Edgar `/v1/nasdaq-compliance` | Reg SHO/compliance fields; overview tile; small-cap prompt | Optional but active | First-pass replacement is cheap: parse 8-K Item 3.01 (deficiency notice) and Item 3.02 (cure) from submissions; surface the most recent event as `status`. Full lifecycle (lawsuit, hearing, granted extension) is a Priority 2 follow-up. |
| `agreements` | Ask Edgar `/v1/agreements` | Agreements table; small-cap prompt | Optional but active | Keep for now. SEC-sourceable but extraction-heavy; needs exhibit parsing for registration rights, ROFR, participation rights, tail fees, restrictions, and price protection. |
| `historical-float-pro` | First-party SEC companyfacts | Historical Float table; agents | Optional but active; not Ask Edgar-billed | Keep first-party. Treat current output as outstanding-share history, not true tradable float. Add methodology/confidence if displayed as float context. |
| `reverse-splits` | First-party SEC parser | Reverse Splits table; small-cap prompt | Optional but active; not Ask Edgar-billed | Keep first-party. Fold into a broader `split-status` lifecycle. |
| `identity-events` | First-party SEC parser | Former Symbols UI | Optional UI; not consumed by agents | Keep for UI. Remove from `small-cap-research` scope unless agent prompts start using former-symbol identity evidence. |
| `gap-stats` | Ask Edgar `/v1/gap-stats?limit=50` | Gap Up Days table, chart date selection, small-cap and swing prompts | Required | Keep until Nexus owns market-derived history. Concrete replacement path: Polygon `/v2/aggs` for OHLCV history (Starter $29/mo includes 2 years daily, intraday, and premarket), then derive gap %, gap-fill, volume vs. avg, and tag with our `sec-filings` events. Reuses the Massive/Polygon helpers already in the repo. |
| `ownership` | Ask Edgar `/v1/ownership` | Owners table; holder-overhang in agents | Optional but active | High-medium priority replacement. Start with Forms 3/4/5 and SC 13D/G. Treat 13F/institutional coverage as a separate tradeoff. |
| `split-status` | Ask Edgar `/v1/split-status` | Split Status table; small-cap prompt | Optional but active | Best next replacement. Extend current reverse-split parser into lifecycle states: proposed, vote pending, approved, announced/effective, completed. |
| `filing-titles` | Not in current registry | Legacy small-cap compatibility read only | Dead/legacy | Remove compatibility read/tests, or map explicitly to `sec-filings` if prompt wording still expects it. |

## Endpoints Evaluated And Skipped

Ask Edgar offers additional endpoints we have evaluated and intentionally do not adopt. Documented so future-us does not re-evaluate from scratch.

| Endpoint | Why we skip |
| --- | --- |
| `/v1/float-outstanding` | Overlaps `historical-float-pro` (first-party) plus market-cap from Massive/TradingView. Adding it would be paying for a derivation we already compose. |
| `/v1/historical-float`, `/v1/historical-float-market-cap` | Same reason as above. `historical-float-pro` (SEC companyfacts) covers outstanding-share history; we can compose market cap. |
| `/v1/historical-dilution-rating` | We are explicitly avoiding cloning the Ask Edgar score (Priority 3 calls for our own evidence-backed model with versioning). Buying historical points of a score we plan to replace is wasted spend. |
| `/v1/dilution-data-funds-underwriters` | Counterparty breakdown is nice-to-have, not load-bearing for any current UI/agent. Revisit if a fund-overlap feature is built. |
| `/v1/market-strength`, `/v1/market-strength-analysis` | Composite "market strength" overlaps with our own chart/relative-volume work; out of scope for now. |
| `/v1/pump-and-dump` | Heuristic flag with unclear methodology; we prefer our own filing+price-action signals once Priority 2 lands. |
| `/v1/right-of-first-refusal` | Overlapping with `agreements`, which itself is being dropped from the fanout (see immediate-action plan). |
| `/v1/research-report` | LLM-generated DD report; we already generate our own via `lib/research.ts` + `lib/agents/blueprints/*` so this would be duplicate AI cost. |
| `/v1/historical-tickers` | `identity-events` already covers former tickers/company names from SEC submissions. |
| `/v1/news-basic` | NOT YET EVALUATED — same per-KB rate as `/v1/news` but documented as a smaller payload. Worth a one-off test if `/v1/news` cost remains high after the form-type filter and 15-min TTL changes. |

## Replacement Priorities

### Priority 0 - Measurement and scope control

This should happen before more endpoint replacement work.

- Persist endpoint-level usage and cost telemetry.
- Add caller attribution: `snapshot`, `tldr`, `scanner-summary`, `site-report`, `small-cap-agent`, `swing-agent`.
- Account for `scanner-summary` direct calls.
- Add endpoint-level cache hit/miss reporting.
- Split broad scopes so visible tabs and agent jobs request only what they need.
- Add source-aware cache metadata: `askedgar`, `nexus-sec`, `nexus-market`, `nexus-llm`, or `mixed`.

### Priority 1 - Low-interpretation SEC replacements

These reduce cost while improving auditability.

- `split-status`: build on `reverse-splits` and maintain lifecycle state.
- Basic `registrations`: registration forms, amendments, EFFECT notices, prospectus supplements, ATM/equity-line detection.
- Basic `ownership`: Forms 3/4/5 and SC 13D/G.
- Continue hardening `offerings`, `sec-filings`, `historical-float-pro`, `reverse-splits`, and `identity-events`.

### Priority 2 - Capital structure and active dilution

These are high product value but require state.

- Registration capacity states.
- Warrant, prefunded warrant, convertible, and note ledger.
- Amendments, exercises, conversions, repricing, anti-dilution, remaining balances.
- Cash, debt, burn, and runway inputs from XBRL plus filings.

### Priority 3 - Nexus risk model

Replace `dilution-rating` only after Priority 2 can provide durable inputs.

The model should return:

- Numeric score, such as `0-100`.
- Band, such as `Low`, `Medium`, or `High`.
- Confidence.
- Missing-fact reasons.
- Evidence IDs and source links.
- Model version.

Do not present precise ratings when inputs are incomplete. Low confidence is better than false precision.

### Priority 4 - Market-derived replacement work

Replace only the parts worth owning:

- Bounded Nexus screener for fields the app and agents actually use.
- `gap-stats` from market data plus catalyst tagging.
- Filing/news catalyst timeline.

Avoid full parity for borrow availability, borrow fee, broad market filters, social risk, and proprietary commentary unless measured usage justifies another paid data source.

## First-Party Data Model Direction

Use a three-layer model: raw source records, extracted facts/events, and point-in-time state snapshots.

Raw source records:

- `sec_entities`
- `sec_filings_raw`
- `sec_facts_raw`
- `sec_dataset_ingests`
- `sec_filing_documents`
- `sec_exhibits_raw`

Extracted facts and events:

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

Point-in-time state:

- `capital_structure_states`
- `dilution_overhang_states`
- `registration_capacity_states`
- `ticker_story_events`
- `risk_model_snapshots`

Do not collapse raw SEC facts, extracted facts, and scored opinions into the same table fields. The app needs to answer as-of questions: what was active, what could be sold, what changed, and what evidence supports the answer.

## Minimum Facts For Accurate Active Dilution

The rating and agent conclusions are only as good as the ledger. Minimum durable inputs:

- Current and historical outstanding shares, authorized shares, and share classes.
- Public float and tradable-float estimates with methodology and confidence.
- Active shelves, S-1/F-1 registrations, EFFECT notices, ATMs, equity lines, resale registrations, and expirations.
- Amount registered, amount sold, amount remaining, and baby-shelf capacity where applicable.
- Warrants, prefunded warrants, convertibles, notes, exercise/conversion prices, repricing terms, maturities, registration status, and remaining balances.
- Recent offerings, warrant exercises, conversions, amendments, and share issuances.
- Cash, debt, burn rate, cash runway, and financing pressure.
- Nasdaq compliance status, reverse-split lifecycle, FTD/Reg SHO context, and short interest where available.
- Source links, parser confidence, and date each fact became known.

If a fact is missing, the UI and agents should say so. Do not infer remaining warrant, ATM, or registration capacity from incomplete prose without confidence and evidence.

## Non-SEC Sources Needed

SEC can replace many filing-derived rows, but not every Ask Edgar value.

- Market data: daily and intraday OHLCV, premarket high/volume, VWAP, live/delayed quotes, market cap snapshots, top gainers, and multi-day performance. The repo already has Massive/Polygon-compatible helpers and TradingView gainers.
- News: Massive/Polygon or another licensed source for non-SEC news. SEC filings should be first-party.
- Corporate actions and listings: Nasdaq Daily List or equivalent for split/effective-date validation, ticker changes, delistings, and market-tier changes.
- Compliance data: exchange compliance lists plus issuer filings and press releases.
- Short/settlement data: FINRA short-interest files/API, SEC fails-to-deliver files, and threshold lists. These do not replace live borrow availability or fee rates.
- Queue/cache infrastructure: Vercel Cron can trigger lightweight syncs, but larger ingestion should use a durable worker/queue path.
- Raw document storage: Postgres should own metadata and normalized facts. Large filing text and exhibits may belong in object storage if volume grows.

## Known Risks

- `registrations`, `agreements`, and `dilution-data` require stateful parsing across messy filings and exhibits.
- `gap-stats`, `screener`, and complete news coverage require non-SEC market/news data.
- Current raw payload consumers read `rawData[...]` keys directly, so source swaps must preserve compatibility or intentionally update agents and tests together.
- Source and parser versioning matter. A stale Ask Edgar row should not silently mix with a newer Nexus SEC row as if they had the same semantics.
- Parser maintenance is permanent. Financing language changes, foreign issuers vary, and multi-class/ADR cases will keep creating edge cases.
- Vendor parity can become a trap. Replace endpoints where first-party evidence improves product quality or materially lowers ongoing cost.

## Implementation Rules

- Keep [app/api/askedgar/snapshot/route.ts](/home/jared/Nexus-Terminal/app/api/askedgar/snapshot/route.ts) returning the client-safe `ResearchSnapshot` contract until replacement work is stable.
- Preserve `rawData` section keys where practical so TLDR and agent flows keep working.
- Add internal evidence packets for agents and TLDR, but do not send raw filings or full endpoint payloads to the browser.
- For any endpoint source swap, update the registry, cache behavior, snapshot normalizer, blueprint consumers, and route/client tests together.
- Track source, freshness, parser/model version, confidence, and evidence IDs internally.
- LLMs may interpret risk, but deterministic facts such as share counts, overhang, and capacity should come from parsed evidence, not from prompt prose.

## External References

- SEC EDGAR APIs: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEC EDGAR access guidance: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data
- SEC technical specs: https://www.sec.gov/submit-filings/technical-specifications
- SEC 13F datasets: https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets
- SEC Form D datasets: https://www.sec.gov/data-research/sec-markets-data/form-d-data-sets
- SEC Reg A datasets: https://www.sec.gov/data-research/sec-markets-data/regulation-data-sets
- SEC fails-to-deliver data: https://www.sec.gov/data-research/sec-markets-data/fails-deliver-data
- SEC company tickers exchange file: https://www.sec.gov/file/company-tickers-exchange
- FINRA short interest: https://www.finra.org/finra-data/browse-catalog/equity-short-interest
- Nasdaq Daily List: https://www.nasdaqtrader.com/trader.aspx/Trader.aspx?id=DailyListPD
