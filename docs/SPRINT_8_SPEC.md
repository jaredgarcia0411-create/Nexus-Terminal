# Build Spec -- Sprint 8: Dilution Research Pack (AskEdgar Integration)

> Generated: 2026-03-09 | Agent: nexus-architect
> Status: PENDING REVIEW -- do not execute until approved

---

## Objective

Replace the Jarvis earnings source pack with a Dilution Research pack powered by the AskEdgar API (`https://eapi.askedgar.io`). This produces an "Ultimate Research Report" for a single ticker on demand, focused on sub-$200M market cap companies. The report covers dilution risk, offering history, scam indicators, float changes, agreements, cash burn, and news -- all from 12 AskEdgar endpoints. Results persist in `jarvis_knowledge_chunks` for future context. The feature runs through the existing orchestration pipeline.

**Tickets:** JRV-080 through JRV-090 (11 tickets)

---

## Sprint 8 Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Data source | AskEdgar API only (no SEC scraper) | Single API provides all needed data; scraping SEC directly is fragile and redundant |
| D2 | Trigger model | On-demand, one ticker at a time (NOT cron) | Dilution research is ticker-specific and user-initiated; cron does not apply |
| D3 | Pipeline path | Orchestration engine (plan -> retrieve -> summarize -> answer) | Reuse existing `runOrchestration` with a new dilution-specific system prompt; keeps architecture consistent |
| D4 | Knowledge persistence | Ingest AskEdgar results into `jarvis_knowledge_chunks` as `api_data` source type | Historical context for the same ticker surfaces automatically in future analyses |
| D5 | New source type | `api_data` added to `JarvisSourceType` union + DB enum | Distinguishes AskEdgar-sourced data from web scrapes, journals, and documents; requires migration |
| D6 | API rate budget | 100 calls/day tracked in-memory with env override `ASKEDGAR_DAILY_LIMIT` | Each report uses up to 12 calls; budget allows ~8 full reports/day; counter resets at midnight UTC |
| D7 | Earnings pack | Remove entirely from `sourcePacks` array | Replaced by dilution research; earnings URLs were unreliable scraped targets |
| D8 | Auth header | `API-KEY: ${process.env.ASKEDGAR_API_KEY}` | Matches AskEdgar API spec; key stored in env, never exposed to client |
| D9 | Error handling per endpoint | Graceful -- each of 12 endpoints called independently; failures logged as warnings, report shows "Data unavailable" for that section | One endpoint failure must not block the rest of the report |
| D10 | Screener usage | Use `/v1/screener?ticker=X` for price/gain data only (not the full screening feature) | Gets current price, gain fields, volume, short data in a single call |
| D11 | UI card placement | Remove earnings card, keep macro summary card, add Dilution Research card alongside it in the mode grid | Clean replacement; two action cards total (Macro + Dilution) in addition to the standard four mode cards |
| D12 | Risk color mapping | Low=emerald/green, Medium=amber/yellow, High=rose/red | Direct mapping matching the existing sentiment color system in `JarvisMacroSummary` |
| D13 | Skipped endpoints | `funds-underwriters` (institutional-only), `screener/options` (not needed) | Per locked decisions |
| D14 | Skipped report sections | PR History stats, Theme, Chart History, Historical Commentary, View Historical Charts | Per locked decisions |
| D15 | New JarvisMode | `dilution-research` added to `JarvisMode` union type | Distinct mode allows route handler to branch correctly into the dilution pipeline |
| D16 | Request payload | `{ mode: 'dilution-research', ticker: 'XXXX' }` -- new `ticker` field on `JarvisRequest` | Ticker is required for dilution research mode; validated server-side |

---

## Current State

### Files that exist and will be modified

| File | Current Purpose | Sprint 8 Impact |
|------|----------------|-----------------|
| `/home/jared/Nexus-Terminal/lib/jarvis-types.ts` | Shared Jarvis types (modes, request/response, source types) | Add `dilution-research` to `JarvisMode`, `api_data` to `JarvisSourceType`, `ticker` to `JarvisRequest`, new `DilutionResearchReport` and sub-types |
| `/home/jared/Nexus-Terminal/lib/jarvis-source-packs.ts` | Earnings + Macro Daily packs | Remove earnings pack, add dilution-research pack |
| `/home/jared/Nexus-Terminal/lib/jarvis-orchestrator.ts` | Orchestration engine (plan/retrieve/summarize/critique/answer) | Add dilution-specific system prompt, handle pre-assembled AskEdgar context |
| `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts` | Main Jarvis POST/GET handler | Add `dilution-research` mode branch, call aggregator, route through orchestration |
| `/home/jared/Nexus-Terminal/lib/jarvis-knowledge.ts` | Knowledge store: ingest, retrieve, evict | Support `api_data` source type in retrieval filters |
| `/home/jared/Nexus-Terminal/lib/db/schema.ts` | Drizzle schema (10 tables) | Add `api_data` to `jarvisKnowledgeChunks.sourceType` enum |
| `/home/jared/Nexus-Terminal/components/trading/JarvisTab.tsx` | Jarvis UI with mode cards and source input | Add dilution research card with ticker input, remove earnings references |
| `/home/jared/Nexus-Terminal/components/trading/JarvisStructuredResponse.tsx` | Response renderer | Render `dilutionReport` field when present |
| `/home/jared/Nexus-Terminal/.env.example` | Env var documentation | Add `ASKEDGAR_API_KEY`, `ASKEDGAR_DAILY_LIMIT` |

### Files that will be created

| File | Purpose |
|------|---------|
| `/home/jared/Nexus-Terminal/lib/askedgar-client.ts` | AskEdgar API client: typed fetch wrapper for all 12 endpoints with auth, error handling, rate tracking |
| `/home/jared/Nexus-Terminal/lib/askedgar-aggregator.ts` | Aggregates 12 endpoint responses into a unified `DilutionResearchReport` object |
| `/home/jared/Nexus-Terminal/components/trading/JarvisDilutionReport.tsx` | Dedicated renderer component for the dilution research report |

---

## Report Section -> API Endpoint Mapping

This is the critical reference for opencode. Each report section lists the AskEdgar endpoint(s) called, the response fields consumed, and how they map to the report output.

### Section 1: Header

**Purpose:** Price, Market Cap, Float/OS, Country, Industry, Gain

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Price | `/v1/screener?ticker=X` | `results[0].price` |
| Market Cap | `/v1/screener?ticker=X` | `results[0].market_cap` |
| Float | `/v1/float-outstanding?ticker=X` | `results[0].float` |
| Outstanding Shares | `/v1/float-outstanding?ticker=X` | `results[0].outstanding` |
| Country | `/v1/float-outstanding?ticker=X` | `results[0].country` |
| Industry | `/v1/float-outstanding?ticker=X` | `results[0].industry` |
| Sector | `/v1/float-outstanding?ticker=X` | `results[0].sector` |
| Is ADR | `/v1/float-outstanding?ticker=X` | `results[0].isadr` |
| 1d / 7d / 30d Gain | `/v1/screener?ticker=X` | `results[0].gain_1_day`, `.gain_7_day`, `.gain_30_day` |
| Volume / Avg Volume | `/v1/screener?ticker=X` | `results[0].today_volume`, `.averagevolume` |
| Short Interest | `/v1/screener?ticker=X` | `results[0].short_float`, `.short_interest`, `.feerate` |
| Insider / Affiliate / Institutional % | `/v1/float-outstanding?ticker=X` | `results[0].insider_percent`, `.affiliate_percent`, `.institutions_percent` |

**API calls:** 2 (`float-outstanding`, `screener`)

### Section 2: Data Sources Checklist

**Purpose:** Show which of the 12 AskEdgar endpoints returned data vs returned empty/error.

**Implementation:** Built programmatically from the aggregator results. Each endpoint gets a boolean `hasData` flag based on whether `results.length > 0`. No additional API call needed.

### Section 3: News / Why It's Running

**Purpose:** Recent news explaining price movement.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| News articles | `/v1/news?ticker=X&hide_filings=true&limit=10` | `results[].title`, `.body`, `.summary`, `.filed_at`, `.author`, `.tags` |
| SEC filing summaries | `/v1/news?ticker=X&hide_news=true&limit=10` | `results[].summary`, `.form_type`, `.filed_at`, `.document_url` |

**API calls:** 2 (news-only + filings-only, to separate them cleanly)

**Note:** Alternatively this can be a single call without `hide_news`/`hide_filings` and filtered client-side to save one API call. Decision: Use a single call (`/v1/news?ticker=X&limit=20`), then partition results by `form_type === 'news'` vs SEC types. Saves 1 API call from the budget.

**Revised API calls:** 1 (`news`)

### Section 4: Other Catalysts

**Purpose:** Non-news catalysts like compliance issues, tag-based news filtering.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Compliance deficiencies | `/v1/nasdaq-compliance?ticker=X` | `results[].deficiency`, `.date`, `.risk`, `.notes`, `.status` |
| Tagged catalysts (FDA, Contracts, etc.) | Already fetched in Section 3 `/v1/news` | Filter `results[].tags` for catalyst-related tags: `FDA`, `Contracts`, `Partnerships`, `Mergers`, `Acquisitions`, `Clinical Trials`, `Product Launches` |

**API calls:** 1 (`nasdaq-compliance`; news data reused from Section 3)

### Section 5: Dilution

**Purpose:** Current warrant and convertible exposure.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Dilution rating | `/v1/dilution-rating?ticker=X` | `results[0].dilution`, `.dilution_desc` |
| Warrants outstanding | `/v1/dilution-data?ticker=X` | Filter results where `warrants_amount` exists: `.details`, `.warrants_amount`, `.warrants_remaining`, `.warrants_exercise_price`, `.expiration_date`, `.registered` |
| Convertibles outstanding | `/v1/dilution-data?ticker=X` | Filter results where `conversion_price` exists: `.details`, `.conversion_price`, `.convertible_debt_remaining`, `.underlying_shares_remaining`, `.maturity_date`, `.registered` |
| Warrant exercise risk | `/v1/dilution-rating?ticker=X` | `results[0].warrant_exercise`, `.warrant_exercise_desc` |

**API calls:** 2 (`dilution-rating`, `dilution-data`)

### Section 6: Offering Frequency

**Purpose:** How often the company raises capital.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Offering frequency rating | `/v1/dilution-rating?ticker=X` | `results[0].offering_frequency`, `.offering_frequency_desc` (already fetched in Section 5) |
| Offering history | `/v1/offerings?ticker=X&limit=20` | `results[].headline`, `.filed_at`, `.offering_type`, `.shares_amount`, `.warrants_amount`, `.share_price`, `.offering_amount` |

**API calls:** 1 (`offerings`; `dilution-rating` reused from Section 5)

### Section 7: Offering Ability

**Purpose:** Does the company have legal mechanisms to issue shares?

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Offering ability rating | `/v1/dilution-rating?ticker=X` | `results[0].offering_ability`, `.offering_ability_desc` (reused from Section 5) |
| Active registrations | `/v1/registrations?ticker=X&effective_status=true` | `results[].headline`, `.effective_date`, `.expiration_date`, `.offering_amount`, `.is_atm`, `.bank`, `.amount_remaining_atm`, `.total_raised`, `.over_baby_shelf` |

**API calls:** 1 (`registrations`; `dilution-rating` reused)

### Section 8: Cash Need

**Purpose:** Cash position and burn rate.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Cash need rating | `/v1/dilution-rating?ticker=X` | `results[0].cash_need`, `.cash_need_desc` (reused) |
| Estimated cash | `/v1/dilution-rating?ticker=X` | `results[0].estimated_cash` |
| Cash burn (quarterly) | `/v1/dilution-rating?ticker=X` | `results[0].cash_burn` |
| Cash remaining months | `/v1/dilution-rating?ticker=X` | `results[0].cash_remaining_months` |
| Total debt | `/v1/dilution-rating?ticker=X` | `results[0].total_debt_final` |

**API calls:** 0 (all reused from `dilution-rating`)

### Section 9: Commentary on Financial Condition

**Purpose:** Management's own commentary.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Management commentary | `/v1/dilution-rating?ticker=X` | `results[0].mgmt_commentary` (reused) |

**API calls:** 0 (reused)

### Section 10: Overall Offering Risk

**Purpose:** The summary risk rating.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Overall risk | `/v1/dilution-rating?ticker=X` | `results[0].overall_offering_risk` (reused) |
| RegSHO status | `/v1/dilution-rating?ticker=X` | `results[0].regsho` (reused) |
| Nasdaq compliance rating | `/v1/dilution-rating?ticker=X` | `results[0].nasdaq_compliance`, `.nasdaq_compliance_desc` (reused) |

**API calls:** 0 (reused)

### Section 11: Scam Risk

**Purpose:** Pump-and-dump indicators.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Country risk | `/v1/pump-and-dump-tracker?ticker=X` | `results[0].country_risk` |
| Float risk | `/v1/pump-and-dump-tracker?ticker=X` | `results[0].float_risk` |
| Underwriter risk | `/v1/pump-and-dump-tracker?ticker=X` | `results[0].underwriter_risk` |
| Scam risk | `/v1/pump-and-dump-tracker?ticker=X` | `results[0].scam_risk`, `.scam_description` |
| Liquidation history | `/v1/pump-and-dump-tracker?ticker=X` | `results[0].number_liquidations`, `.last_liquidation_date`, `.liquidation_history` |
| IPO / lock-up info | `/v1/pump-and-dump-tracker?ticker=X` | `results[0].ipo_date`, `.lock_up_expiration`, `.underwriters` |

**API calls:** 1 (`pump-and-dump-tracker`)

### Section 12: Agreements and Lock-ups

**Purpose:** Registration rights, participation rights, equity restrictions.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| All agreements | `/v1/agreements?ticker=X` | `results[].agreement_type`, `.investor_names`, `.filed_at`, `.registration_deadline`, `.penalties`, `.restriction_date`, `.duration_in_days`, `.participation_percentage`, `.details` |

**API calls:** 1 (`agreements`)

### Section 13: Historical Float

**Purpose:** Outstanding shares change over time.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Historical float entries | `/v1/historical-float-pro?ticker=X&limit=20` | `results[].reported_date`, `.outstanding_shares`, `.float`, `.tradable_float`, `.affiliate_percent`, `.insider_percent`, `.institutions_percent`, `.form_type` |

**API calls:** 1 (`historical-float-pro`)

### Section 14: Reverse Splits

**Purpose:** Reverse split history.

| Data Point | Endpoint | Response Field |
|-----------|----------|---------------|
| Reverse splits | `/v1/reverse-splits?ticker=X` | `results[].execution_date`, `.split_from`, `.split_to` |

**API calls:** 1 (`reverse-splits`)

### Total API Calls Per Report: 11

| # | Endpoint | Sections Served |
|---|----------|----------------|
| 1 | `/v1/float-outstanding?ticker=X` | Header (1) |
| 2 | `/v1/screener?ticker=X` | Header (1) |
| 3 | `/v1/dilution-rating?ticker=X` | Dilution (5), Offering Frequency (6), Offering Ability (7), Cash Need (8), Commentary (9), Overall Risk (10) |
| 4 | `/v1/dilution-data?ticker=X` | Dilution (5) |
| 5 | `/v1/offerings?ticker=X&limit=20` | Offering Frequency (6) |
| 6 | `/v1/registrations?ticker=X&effective_status=true` | Offering Ability (7) |
| 7 | `/v1/news?ticker=X&limit=20` | News (3), Other Catalysts (4) |
| 8 | `/v1/nasdaq-compliance?ticker=X` | Other Catalysts (4) |
| 9 | `/v1/pump-and-dump-tracker?ticker=X` | Scam Risk (11) |
| 10 | `/v1/agreements?ticker=X` | Agreements (12) |
| 11 | `/v1/historical-float-pro?ticker=X&limit=20` | Historical Float (13) |
| 12 | `/v1/reverse-splits?ticker=X` | Reverse Splits (14) |

With 100 calls/day budget, this allows ~9 full reports per day (12 calls per report including the 12th endpoint), with 1 call of margin. However, note the mapping above shows 12 individual endpoint calls per report. Corrected: 12 calls per report, so 100/12 = ~8 full reports per day. If an endpoint returns an error/empty, the call still counts toward budget.

---

## Ticket Table

| Ticket | Description | Size | Dependencies | Files Created | Files Modified |
|--------|-------------|------|-------------|--------------|----------------|
| JRV-080 | AskEdgar API client with rate tracking | M | None | `lib/askedgar-client.ts` | `.env.example` |
| JRV-081 | Dilution research types and mode registration | S | None | -- | `lib/jarvis-types.ts` |
| JRV-082 | Add `api_data` source type to schema + migration | S | JRV-081 | Migration file | `lib/db/schema.ts`, `lib/jarvis-knowledge.ts`, `lib/jarvis-scrape-cache.ts` |
| JRV-083 | AskEdgar data aggregator | L | JRV-080, JRV-081 | `lib/askedgar-aggregator.ts` | -- |
| JRV-084 | Remove earnings pack, add dilution-research pack | XS | JRV-081 | -- | `lib/jarvis-source-packs.ts` |
| JRV-085 | Dilution research system prompt for orchestration | M | JRV-081, JRV-083 | -- | `lib/jarvis-orchestrator.ts` |
| JRV-086 | Route handler: dilution-research mode | M | JRV-080, JRV-082, JRV-083, JRV-085 | -- | `app/api/jarvis/route.ts` |
| JRV-087 | Dilution report renderer component | L | JRV-081 | `components/trading/JarvisDilutionReport.tsx` | -- |
| JRV-088 | Wire dilution report into structured response | S | JRV-087 | -- | `components/trading/JarvisStructuredResponse.tsx` |
| JRV-089 | JarvisTab UI: dilution research card + ticker input | M | JRV-084, JRV-088 | -- | `components/trading/JarvisTab.tsx` |
| JRV-090 | Tests: client, aggregator, route integration | M | JRV-080, JRV-083, JRV-086 | `__tests__/askedgar-client.test.ts`, `__tests__/askedgar-aggregator.test.ts`, `__tests__/jarvis-dilution-route.test.ts` | -- |

---

## Detailed Ticket Specifications

### JRV-080: AskEdgar API Client with Rate Tracking

**File:** CREATE `/home/jared/Nexus-Terminal/lib/askedgar-client.ts`
**File:** MODIFY `/home/jared/Nexus-Terminal/.env.example`

**Description:** Build a typed API client for the AskEdgar API. The client wraps `fetch()` with the `API-KEY` header, validates ticker format, handles the standard `{ status, count, results }` response wrapper, and tracks daily API call count in-memory (resetting at midnight UTC).

**Implementation details:**

- Base URL: `https://eapi.askedgar.io`
- Auth: `API-KEY` header with value from `process.env.ASKEDGAR_API_KEY`
- If `ASKEDGAR_API_KEY` is not set, all methods return `{ status: 'error', count: 0, results: [], error: 'ASKEDGAR_API_KEY not configured' }`
- Rate tracking: Module-level `let callCount = 0; let resetDate = ''` -- check against `ASKEDGAR_DAILY_LIMIT` (default 100) before each call. Return error result if budget exhausted.
- Ticker validation: uppercase letters, numbers, dots, hyphens, carets only (regex: `/^[A-Z0-9.\-^]+$/`)
- Timeout: 15 seconds per request (AbortController)
- Each method returns a typed result: `AskEdgarResponse<T>` where `T` is the specific result type
- Export one function per endpoint:
  - `fetchFloatOutstanding(ticker: string)`
  - `fetchScreenerByTicker(ticker: string)`
  - `fetchDilutionRating(ticker: string)`
  - `fetchDilutionData(ticker: string)`
  - `fetchOfferings(ticker: string, limit?: number)`
  - `fetchRegistrations(ticker: string)`
  - `fetchNews(ticker: string, limit?: number)`
  - `fetchNasdaqCompliance(ticker: string)`
  - `fetchPumpAndDumpTracker(ticker: string)`
  - `fetchAgreements(ticker: string)`
  - `fetchHistoricalFloatPro(ticker: string, limit?: number)`
  - `fetchReverseSplits(ticker: string)`
- Export `getAskEdgarCallCount()` and `getAskEdgarDailyLimit()` for observability
- On non-200 response, return `{ status: 'error', count: 0, results: [], error: '<status code> <message>' }`

**Env vars to add to `.env.example`:**
```
# AskEdgar API (optional -- enables dilution research)
ASKEDGAR_API_KEY=
ASKEDGAR_DAILY_LIMIT=100
```

**Acceptance Criteria:**
- [ ] All 12 fetch functions exported with correct TypeScript return types
- [ ] API key read from `ASKEDGAR_API_KEY` env var only; never hardcoded
- [ ] Daily call counter increments on each successful request and rejects when limit reached
- [ ] Missing API key returns structured error, does not throw
- [ ] Request timeout after 15 seconds with clean error
- [ ] Ticker validation rejects lowercase and special characters
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** MEDIUM (1-2 hours) -- 12 typed endpoint wrappers + rate counter + error handling

---

### JRV-081: Dilution Research Types and Mode Registration

**File:** MODIFY `/home/jared/Nexus-Terminal/lib/jarvis-types.ts`

**Description:** Add the `dilution-research` mode to `JarvisMode`, `api_data` to `JarvisSourceType`, `ticker` to `JarvisRequest`, and define all TypeScript types for the dilution research report structure.

**Implementation details:**

- Add `'dilution-research'` to `JarvisMode` union
- Add `'api_data'` to `JarvisSourceType` union
- Add optional `ticker?: string` to `JarvisRequest`
- Add optional `dilutionReport?: DilutionResearchReport` to `JarvisResponse`
- Define new types (all exported):

```
DilutionResearchReport {
  ticker: string;
  generatedAt: string;
  header: DilutionReportHeader;
  dataSources: DilutionDataSourceCheck[];
  news: DilutionNewsItem[];
  catalysts: DilutionCatalystItem[];
  dilution: DilutionSection;
  offeringFrequency: OfferingFrequencySection;
  offeringAbility: OfferingAbilitySection;
  cashNeed: CashNeedSection;
  managementCommentary: string;
  overallOfferingRisk: OverallRiskSection;
  scamRisk: ScamRiskSection;
  agreements: AgreementItem[];
  historicalFloat: HistoricalFloatEntry[];
  reverseSplits: ReverseSplitEntry[];
}
```

- `DilutionReportHeader`: `{ price, marketCap, float, outstanding, country, industry, sector, isAdr, gain1d, gain7d, gain30d, volume, avgVolume, shortFloat, shortInterest, feeRate, insiderPercent, affiliatePercent, institutionsPercent }`
- `DilutionDataSourceCheck`: `{ endpoint: string; label: string; hasData: boolean; error?: string }`
- `DilutionNewsItem`: `{ title, summary, body, filedAt, formType, author, tags, documentUrl, isNews: boolean }`
- `DilutionCatalystItem`: `{ type: string; description: string; date: string; risk?: string; source: 'news' | 'compliance' }`
- `RiskRating`: `'High' | 'Medium' | 'Low' | ''` (empty string for missing)
- `RiskLevel`: `'high' | 'medium' | 'low' | ''` (lowercase variant used by pump-and-dump)
- `DilutionSection`: `{ rating: RiskRating; description: string; warrantExercise: RiskRating; warrantExerciseDesc: string; warrants: WarrantItem[]; convertibles: ConvertibleItem[] }`
- `WarrantItem`: `{ details, amount, remaining, exercisePrice, registered, exercisableDate, expirationDate, filedAt }`
- `ConvertibleItem`: `{ details, conversionPrice, registered, convertibleDate, maturityDate, offeringAmount, debtRemaining, sharesRemaining, filedAt }`
- `OfferingFrequencySection`: `{ rating: RiskRating; description: string; offerings: OfferingItem[] }`
- `OfferingItem`: `{ headline, filedAt, formType, offeringType, sharesAmount, warrantsAmount, sharePrice, offeringAmount, conversionPrice }`
- `OfferingAbilitySection`: `{ rating: RiskRating; description: string; registrations: RegistrationItem[] }`
- `RegistrationItem`: `{ headline, filedAt, effectiveDate, expirationDate, effectiveStatus, offeringAmount, isAtm, bank, amountRemainingAtm, totalRaised, overBabyShelf }`
- `CashNeedSection`: `{ rating: RiskRating; description: string; estimatedCash: number | null; cashBurn: number | null; cashRemainingMonths: number | null; totalDebt: number | null }`
- `OverallRiskSection`: `{ rating: RiskRating; regsho: boolean; nasdaqCompliance: RiskRating; nasdaqComplianceDesc: string }`
- `ScamRiskSection`: `{ countryRisk: RiskLevel; floatRisk: RiskLevel; underwriterRisk: RiskLevel; scamRisk: RiskLevel; scamDescription: string; liquidationHistory: string; numberOfLiquidations: number; lastLiquidationDate: string; ipoDate: string; lockUpExpiration: string; underwriters: string }`
- `AgreementItem`: `{ agreementType, investorNames, filedAt, registrationDeadline, effectiveDeadline, penalties, restrictionDate, durationInDays, participationPercentage, details }`
- `HistoricalFloatEntry`: `{ reportedDate, outstandingShares, float, tradableFloat, affiliatePercent, insiderPercent, institutionsPercent, formType }`
- `ReverseSplitEntry`: `{ executionDate: string; splitFrom: number; splitTo: number }`

**Acceptance Criteria:**
- [ ] `JarvisMode` union includes `'dilution-research'`
- [ ] `JarvisSourceType` union includes `'api_data'`
- [ ] `JarvisRequest` has optional `ticker` field
- [ ] `JarvisResponse` has optional `dilutionReport` field
- [ ] All sub-types exported
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** MEDIUM (30-60 min) -- many types but straightforward definitions

---

### JRV-082: Add `api_data` Source Type to Schema + Migration

**File:** MODIFY `/home/jared/Nexus-Terminal/lib/db/schema.ts`
**File:** MODIFY `/home/jared/Nexus-Terminal/lib/jarvis-knowledge.ts`
**File:** MODIFY `/home/jared/Nexus-Terminal/lib/jarvis-scrape-cache.ts`
**File:** CREATE new Drizzle migration file

**Description:** Extend the `jarvisKnowledgeChunks.sourceType` enum to include `'api_data'`. Update retrieval and cache logic to recognize the new type.

**Implementation details:**

- In `schema.ts`, change the `sourceType` enum array from `['web_source', 'trade_journal', 'user_document', 'cached_headline']` to `['web_source', 'trade_journal', 'user_document', 'cached_headline', 'api_data']`
- In `jarvis-knowledge.ts`, add `'api_data'` to the default sourceTypes array in `retrieveKnowledgeChunks` (line ~326): `['web_source', 'trade_journal', 'user_document', 'cached_headline', 'api_data']`
- In `jarvis-scrape-cache.ts`, add a TTL for `api_data` -- 24 hours (86400000ms), configurable via `JARVIS_SCRAPE_CACHE_TTL_API_MS`
- Migration: `ALTER TABLE jarvis_knowledge_chunks DROP CONSTRAINT ... ADD CONSTRAINT ... CHECK (source_type IN (...))` -- or if the enum is enforced at the Drizzle level only (which it is -- Drizzle `text` with enum is application-level, not a PostgreSQL enum type), then no SQL migration is needed, only the schema file change. **Verify:** The schema uses `text('source_type', { enum: [...] })` which is a Drizzle-level constraint only. No DB migration needed -- just the schema file change. However, generate a migration anyway (`npx drizzle-kit generate`) to keep the migration history in sync.
- Add `JARVIS_SCRAPE_CACHE_TTL_API_MS=86400000` to `.env.example`

**Acceptance Criteria:**
- [ ] Schema enum includes `'api_data'`
- [ ] Knowledge retrieval includes `'api_data'` in default source type list
- [ ] Scrape cache recognizes `'api_data'` with 24h TTL
- [ ] `npx drizzle-kit generate` produces a clean migration (or no-op if enum is app-level only)
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** LOW (under 30 min)

---

### JRV-083: AskEdgar Data Aggregator

**File:** CREATE `/home/jared/Nexus-Terminal/lib/askedgar-aggregator.ts`

**Description:** Orchestrates all 12 AskEdgar API calls for a single ticker and assembles the results into a `DilutionResearchReport`. Each endpoint call is independent -- failures are captured as warnings, not thrown. The aggregator also converts the report into `ScrapedChunk[]` for knowledge ingestion.

**Implementation details:**

- Export `async function aggregateDilutionReport(ticker: string): Promise<{ report: DilutionResearchReport; chunks: ScrapedChunk[]; warnings: string[] }>`
- Call all 12 endpoints concurrently via `Promise.allSettled` (not `Promise.all` -- must not fail if one endpoint errors)
- For each endpoint, if the fetch returns an error or empty results: set `hasData: false` in `dataSources`, add a warning string, and populate the corresponding report section with empty/default values
- News partitioning: Split `/v1/news` results into `isNews: true` (where `form_type === 'news'` or `form_type === 'grok'` or `form_type === 'jmt415'`) and `isNews: false` (SEC filings)
- Catalyst extraction from news: Filter news items whose `tags` array includes any of: `FDA`, `Contracts`, `Partnerships`, `Mergers`, `Acquisitions`, `Clinical Trials`, `Product Launches`, `Expansion Plans`, `License Agreements`
- Catalyst extraction from compliance: Each `nasdaq-compliance` result becomes a catalyst with `source: 'compliance'`
- Warrant vs Convertible detection in `dilution-data`: Warrants have `warrants_amount` field, convertibles have `conversion_price` field
- Chunk generation: Convert each report section to a text chunk for knowledge ingestion. Use `sourceUrl: 'askedgar://<ticker>/<section>'`, `sourceHost: 'askedgar.io'`, `sourceType: 'api_data'`. Generate ~1 chunk per report section (14 sections -> ~14 chunks). Each chunk text is a human-readable summary of that section's data.

**Acceptance Criteria:**
- [ ] All 12 endpoints called; any single failure does not block others
- [ ] `dataSources` array has 12 entries with correct `hasData` flags
- [ ] Warrant/convertible items correctly separated
- [ ] News/filing items correctly partitioned
- [ ] Risk ratings preserved as-is from API (not re-mapped -- mapping is UI-only)
- [ ] Returns `ScrapedChunk[]` suitable for `ingestKnowledgeChunks`
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** HIGH (2+ hours) -- 12 endpoint responses to normalize and assemble

---

### JRV-084: Remove Earnings Pack, Add Dilution Research Pack

**File:** MODIFY `/home/jared/Nexus-Terminal/lib/jarvis-source-packs.ts`

**Description:** Remove the `earnings` source pack from the `sourcePacks` array. Add a `dilution-research` pack. The `dilution-research` pack does not use `urls` (it uses the AskEdgar API client directly), but the pack entry is needed for the UI card system.

**Implementation details:**

- Remove the earnings object from `sourcePacks`
- Add `'dilution-research'` to the `SourcePack.category` union: `'earnings' | 'macro' | 'research' | 'dilution'` -- or simply change to `'macro' | 'dilution'` since earnings is gone
- Update `SourcePack.icon` union to include `'Search'` (for the dilution research icon from lucide)
- Add new pack:
  ```
  {
    id: 'dilution-research',
    name: 'Dilution Research',
    description: 'SEC filings, dilution risk, scam indicators, and float analysis for a single ticker.',
    icon: 'Search',
    category: 'dilution',
    urls: [],  // Not used -- AskEdgar API calls handled by aggregator
    promptTemplate: 'Generate a comprehensive dilution research report for the specified ticker. Analyze SEC filings, offering history, warrant exposure, cash burn, scam risk indicators, and float changes.',
  }
  ```
- Keep the `macro-daily` pack unchanged

**Acceptance Criteria:**
- [ ] Earnings pack removed
- [ ] Dilution research pack added with correct fields
- [ ] `sourcePackRegistry.getById('dilution-research')` returns the pack
- [ ] `sourcePackRegistry.getById('earnings')` returns undefined
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** LOW (under 15 min)

---

### JRV-085: Dilution Research System Prompt for Orchestration

**File:** MODIFY `/home/jared/Nexus-Terminal/lib/jarvis-orchestrator.ts`

**Description:** Add a dilution-research-specific system prompt to the orchestration engine. When mode is `dilution-research`, the summarize step uses this prompt and expects a `DilutionResearchReport` JSON object in the response, falling back to the structured format if LLM cannot parse the report.

**Implementation details:**

- Add `DILUTION_SUMMARIZE_SYSTEM_PROMPT` constant: instruct the LLM to analyze AskEdgar data and produce a JSON object with keys: `tldr`, `findings`, `actionSteps`, `risks`. The LLM does NOT generate the `DilutionResearchReport` structure -- that is already built by the aggregator. The LLM's job is to synthesize the aggregated data into the standard structured response (tldr, findings, actionSteps, risks) with intelligent commentary.
- In `stepSummarize`, add condition: `if (options.mode === 'dilution-research')` use the dilution-specific system prompt
- The dilution system prompt should instruct Jarvis to:
  - Focus on dilution risk for short-term traders
  - Call out specific warrant exercise prices near current price
  - Highlight imminent cash need (under 6 months of runway)
  - Flag high scam risk indicators
  - Note any active shelf registrations or ATM programs
  - Quantify total potential dilution from warrants + convertibles
- In `stepPlan`, when mode is `dilution-research`, return a fixed plan (no LLM call needed):
  ```
  { keywords: [ticker], tickers: [ticker], sourceTypes: ['api_data'], focusRegions: [] }
  ```
  This saves one LLM call per dilution request.
- Export a helper `isDilutionResearchMode(mode: JarvisMode): boolean` for use in the route handler

**Acceptance Criteria:**
- [ ] Dilution-specific system prompt defined
- [ ] Plan step short-circuits for dilution-research mode (no LLM call)
- [ ] Summarize step uses the dilution prompt for dilution-research mode
- [ ] Standard structured response (tldr/findings/actionSteps/risks) is the LLM output format
- [ ] Fallback to deterministic structured response works if LLM fails
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** MEDIUM (30-60 min)

---

### JRV-086: Route Handler -- Dilution Research Mode

**File:** MODIFY `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts`

**Description:** Add a `dilution-research` branch to the POST handler. This branch validates the ticker, calls the aggregator, ingests the results into knowledge, builds a prompt from the report data, runs orchestration, and returns the response with the `dilutionReport` field.

**Implementation details:**

- After the `macro-summary` mode block (line ~604), add a new block:
  ```
  if (mode === 'dilution-research') { ... }
  ```
- Validate `body.ticker`: must be a non-empty string, uppercase, matching AskEdgar ticker format. Return 400 if missing or invalid.
- Call `aggregateDilutionReport(body.ticker)` from `lib/askedgar-aggregator.ts`
- Ingest the returned chunks into `jarvis_knowledge_chunks` with `sourceType: 'api_data'` and `userId: authState.user.id`
- Build a text prompt from the report data (flatten key sections into a readable context string for the LLM)
- Call `runOrchestration` with mode `'dilution-research'`, the assembled prompt, `tradeTickers: [body.ticker]`, and the report chunks as `scrapeChunks`
- Return response:
  ```json
  {
    "message": "...",
    "structured": { ... },
    "dilutionReport": { ... },
    "warnings": [ ... ],
    "sources": [ ... ]
  }
  ```
- The `dilutionReport` field contains the full `DilutionResearchReport` from the aggregator (pre-LLM). The `structured` field contains the LLM's analysis (tldr/findings/actionSteps/risks).
- Log the request via `logJarvisRequest` with mode `'dilution-research'`

**Acceptance Criteria:**
- [ ] `mode: 'dilution-research'` with missing `ticker` returns 400
- [ ] `mode: 'dilution-research'` with invalid ticker format returns 400
- [ ] Aggregator is called, report is returned in `dilutionReport` field
- [ ] Chunks are ingested into knowledge store
- [ ] Orchestration produces structured analysis
- [ ] Rate limiting and token tracking apply as with other modes
- [ ] `requireUser()` is called (existing -- no change needed)
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** MEDIUM (1-2 hours)

---

### JRV-087: Dilution Report Renderer Component

**File:** CREATE `/home/jared/Nexus-Terminal/components/trading/JarvisDilutionReport.tsx`

**Description:** A dedicated React component that renders a `DilutionResearchReport` as a visual card layout. Follows the same design patterns as `JarvisMacroSummary.tsx` (card-based, dark theme, color-coded risk indicators).

**Implementation details:**

- `'use client'` directive
- Props: `{ report: DilutionResearchReport }`
- Imports from `@/lib/jarvis-types`
- Risk color mapping (used throughout):
  - `'Low'` / `'low'` -> emerald (border-emerald-500/30, bg-emerald-500/10, text-emerald-300)
  - `'Medium'` / `'medium'` -> amber (border-amber-500/30, bg-amber-500/10, text-amber-300)
  - `'High'` / `'high'` -> rose (border-rose-500/30, bg-rose-500/10, text-rose-300)
  - Empty / missing -> zinc (border-zinc-500/30, bg-zinc-500/10, text-zinc-300)
- Layout sections (in order, matching the report template):
  1. **Header card**: Ticker, price, market cap, float/OS ratio, country, industry. Gain badges (1d/7d/30d) with green/red coloring. Short interest row.
  2. **Data sources checklist**: Grid of 12 items with green check / red X icons per endpoint.
  3. **News section**: Collapsible list of news items and filing summaries. Show `tags` as small badges.
  4. **Other Catalysts**: Cards for compliance issues and catalyst-tagged news.
  5. **Dilution section**: Rating badge, warrant table, convertible table.
  6. **Offering Frequency**: Rating badge + offering history list.
  7. **Offering Ability**: Rating badge + active registrations table.
  8. **Cash Need**: Rating badge + cash/burn/months/debt stats in a 4-column grid.
  9. **Management Commentary**: Quoted text block (if available).
  10. **Overall Offering Risk**: Large rating badge + RegSHO flag + Nasdaq compliance.
  11. **Scam Risk**: 4-indicator grid (country, float, underwriter, scam) each with risk badge. Scam description if present.
  12. **Agreements**: Cards per agreement with type badge, investor names, deadlines, penalties.
  13. **Historical Float**: Simple table showing date, OS, float, tradable float over time.
  14. **Reverse Splits**: Table showing date and ratio.
- If a section has no data, show a muted "No data available" message for that section (do NOT hide the section).
- Use existing Tailwind classes and patterns from `JarvisMacroSummary.tsx` for consistency.

**Acceptance Criteria:**
- [ ] All 14 report sections rendered
- [ ] Risk ratings show correct colors (Low=green, Medium=amber, High=red)
- [ ] Empty sections show "No data available" rather than being hidden
- [ ] Data sources checklist shows 12 items with check/X icons
- [ ] Component is `'use client'`
- [ ] No direct API calls from this component
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** HIGH (2+ hours) -- 14 visual sections with tables, grids, and conditional rendering

---

### JRV-088: Wire Dilution Report into Structured Response

**File:** MODIFY `/home/jared/Nexus-Terminal/components/trading/JarvisStructuredResponse.tsx`

**Description:** Import and render `JarvisDilutionReport` when `dilutionReport` is present in the response, analogous to how `macroSummary` is handled.

**Implementation details:**

- Import `JarvisDilutionReport` from `@/components/trading/JarvisDilutionReport`
- Import `DilutionResearchReport` type from `@/lib/jarvis-types`
- Add `dilutionReport?: DilutionResearchReport` to `JarvisStructuredResponseProps`
- After the `{macroSummary ? <JarvisMacroSummary ... /> : null}` line, add:
  ```
  {dilutionReport ? <JarvisDilutionReport report={dilutionReport} /> : null}
  ```
- Add `'api_data'` to the `sourceTypeBadge` function:
  ```
  if (sourceType === 'api_data') {
    return { label: 'AskEdgar', className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200' };
  }
  ```

**Acceptance Criteria:**
- [ ] `JarvisDilutionReport` renders when `dilutionReport` prop is present
- [ ] Does not render when `dilutionReport` is undefined
- [ ] `api_data` source type gets a cyan "AskEdgar" badge
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** LOW (under 15 min)

---

### JRV-089: JarvisTab UI -- Dilution Research Card + Ticker Input

**File:** MODIFY `/home/jared/Nexus-Terminal/components/trading/JarvisTab.tsx`

**Description:** Replace the earnings source pack card with a dedicated Dilution Research mode card. Add a ticker input field that appears when dilution-research mode is selected. Wire the submit to call the API with `mode: 'dilution-research'` and the ticker.

**Implementation details:**

- Add state: `const [dilutionTicker, setDilutionTicker] = useState('')`
- Remove references to the `earnings` source pack (it will no longer exist in `sourcePacks`)
- Add `Search` to lucide-react imports (for dilution research icon)
- In the `cards` array, add a new entry AFTER the macro-summary card:
  ```
  {
    mode: 'dilution-research' as JarvisMode,
    label: 'Dilution Research',
    description: 'SEC dilution risk report for a single ticker via AskEdgar.',
    icon: Search,
  }
  ```
  This makes the cards grid: Daily Summary, Analyze Trades, Ask Jarvis, Macro Summary, Dilution Research (5 cards in a `lg:grid-cols-5` or wrap layout)
- When the Dilution Research card is clicked:
  - If `dilutionTicker` is empty, do NOT fire the request. Instead, focus the ticker input field.
  - If `dilutionTicker` is non-empty, call `runJarvis('dilution-research')`.
- Add a ticker input row that appears when mode is `'dilution-research'` or when `dilutionTicker` is non-empty:
  ```
  <div> Ticker: <input value={dilutionTicker} onChange={...} placeholder="e.g. MULN" /> </div>
  ```
  Place this between the mode cards grid and the prompt input area.
- Modify `runJarvis` to include `ticker: dilutionTicker.toUpperCase().trim()` in the POST body when mode is `'dilution-research'`
- Pass `dilutionReport` from response to `JarvisStructuredResponse`:
  ```
  dilutionReport={response.dilutionReport}
  ```
- Update the grid from `lg:grid-cols-4` to `lg:grid-cols-5` (or use flex-wrap) to accommodate the 5th card

**Acceptance Criteria:**
- [ ] Dilution Research card appears in the mode grid
- [ ] Ticker input field appears and is required for dilution-research mode
- [ ] Clicking Dilution Research card without a ticker does not fire request
- [ ] Request includes `ticker` and `mode: 'dilution-research'`
- [ ] Response `dilutionReport` passed to renderer
- [ ] Earnings source pack no longer appears anywhere in UI
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** MEDIUM (30-60 min)

---

### JRV-090: Tests -- Client, Aggregator, Route Integration

**Files:** CREATE:
- `/home/jared/Nexus-Terminal/__tests__/askedgar-client.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/askedgar-aggregator.test.ts`
- `/home/jared/Nexus-Terminal/__tests__/jarvis-dilution-route.test.ts`

**Description:** Unit and integration tests for the AskEdgar client, aggregator, and route handler.

**Implementation details:**

- **askedgar-client.test.ts:**
  - Mock `fetch` globally
  - Test: missing API key returns error result
  - Test: rate limit exceeded returns error after N calls
  - Test: invalid ticker rejected
  - Test: successful response parsed correctly for each endpoint
  - Test: network error returns structured error
  - Test: 401 response returns auth error
  - Test: timeout handling

- **askedgar-aggregator.test.ts:**
  - Mock the client functions
  - Test: all endpoints succeed -> full report assembled
  - Test: one endpoint fails -> report has that section empty, warning added, other sections intact
  - Test: all endpoints fail -> report has all sections empty, 12 warnings
  - Test: news partitioning (news vs filings)
  - Test: warrant vs convertible detection
  - Test: catalyst extraction from tags
  - Test: chunk generation produces expected count and format

- **jarvis-dilution-route.test.ts:**
  - Mock auth, aggregator, orchestration, knowledge store
  - Test: missing ticker returns 400
  - Test: invalid ticker format returns 400
  - Test: successful request returns dilutionReport + structured
  - Test: rate limit applied
  - Test: token tracking logged

**Acceptance Criteria:**
- [ ] All test files pass with `npm test`
- [ ] Client tests cover all error paths
- [ ] Aggregator tests verify graceful degradation
- [ ] Route tests verify auth and validation
- [ ] `npm run lint && npx tsc --noEmit` passes

**Complexity:** MEDIUM (1-2 hours)

---

## Files Affected Summary

| File | Action | Risk Level | Ticket(s) |
|------|--------|------------|-----------|
| `lib/askedgar-client.ts` | CREATE | Medium (new external dependency) | JRV-080 |
| `lib/askedgar-aggregator.ts` | CREATE | Medium (complex data assembly) | JRV-083 |
| `components/trading/JarvisDilutionReport.tsx` | CREATE | Low (UI only) | JRV-087 |
| `__tests__/askedgar-client.test.ts` | CREATE | Low | JRV-090 |
| `__tests__/askedgar-aggregator.test.ts` | CREATE | Low | JRV-090 |
| `__tests__/jarvis-dilution-route.test.ts` | CREATE | Low | JRV-090 |
| `lib/jarvis-types.ts` | MODIFY | Medium (shared types -- changes ripple) | JRV-081 |
| `lib/db/schema.ts` | MODIFY | Medium (schema change) | JRV-082 |
| `lib/jarvis-knowledge.ts` | MODIFY | Low (add one entry to array) | JRV-082 |
| `lib/jarvis-scrape-cache.ts` | MODIFY | Low (add TTL branch) | JRV-082 |
| `lib/jarvis-source-packs.ts` | MODIFY | Low (remove/add pack) | JRV-084 |
| `lib/jarvis-orchestrator.ts` | MODIFY | Medium (new prompt + plan shortcut) | JRV-085 |
| `app/api/jarvis/route.ts` | MODIFY | High (core route, auth-gated) | JRV-086 |
| `components/trading/JarvisStructuredResponse.tsx` | MODIFY | Low (add conditional render) | JRV-088 |
| `components/trading/JarvisTab.tsx` | MODIFY | Medium (UI state + new card) | JRV-089 |
| `.env.example` | MODIFY | Low | JRV-080, JRV-082 |

---

## Testing Requirements

- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes (all existing + new tests)
- [ ] Manual test: enter a known ticker (e.g., `MULN`, `WNW`, `ASTC`) and verify report renders with all sections
- [ ] Manual test: enter a ticker with no AskEdgar data and verify graceful "No data available" on each section
- [ ] Manual test: verify macro summary still works unchanged
- [ ] Manual test: verify daily-summary, trade-analysis, and assistant modes still work unchanged
- [ ] Verify `ASKEDGAR_API_KEY` missing returns a clean error message in the UI
- [ ] Verify rate limit counter tracks calls across multiple requests within the same serverless instance

---

## Security Considerations

1. **API Key Exposure:** `ASKEDGAR_API_KEY` must only be read server-side in `lib/askedgar-client.ts`. It must never appear in client bundles. The client module must be server-only (it uses `process.env`, which is server-side by default in Next.js API routes, but verify no client import chain exists).

2. **ALLOWED_EMAILS:** Still not enforced in auth callbacks (pre-existing issue, not introduced by this sprint). Flag maintained.

3. **Ticker Injection:** User-supplied `ticker` parameter flows into URL query strings on AskEdgar API calls. The ticker validation regex (`/^[A-Z0-9.\-^]+$/`) prevents any injection. Additionally, use `URLSearchParams` to build query strings (encodes values automatically).

4. **Rate Limiting:** The 100 calls/day budget is enforced server-side. The per-user Jarvis rate limit (30 req/hr) also applies, so a single user cannot exhaust the AskEdgar budget.

5. **Data Sensitivity:** AskEdgar returns public SEC data only (no PII, no credentials). Safe to store in `jarvis_knowledge_chunks` and display in UI.

---

## Architectural Concerns and Risks

1. **In-memory rate counter resets on cold start.** Vercel serverless functions restart frequently. The 100 calls/day budget is best-effort, not guaranteed. For production, consider persisting the counter in the database or KV store. This is acceptable for now given the small user base.

2. **12 concurrent API calls per report.** AskEdgar may rate-limit per-second. If they enforce per-second limits (not documented), `Promise.allSettled` may trigger 429s. Mitigation: If 429s are observed, add a simple sequential fallback with 200ms delays between calls. Do NOT implement this preemptively -- only if needed.

3. **Large response payload.** A full dilution report with all sections may produce a large JSON response (est. 20-50KB). This is within normal API response sizes but should be monitored. The knowledge chunks will also be sizeable (14 chunks per report per ticker). The existing per-user eviction system handles this.

4. **AskEdgar API stability.** This is a third-party API with no SLA documented. The graceful per-endpoint error handling (JRV-083) mitigates this, but extended outages will make the feature non-functional. There is no offline fallback beyond previously cached chunks in knowledge.

5. **Type exhaustiveness.** Adding `'dilution-research'` to `JarvisMode` may cause TypeScript exhaustiveness errors in existing switch/if-else chains that handle all modes. The route handler already uses if-else (not switch), so this is likely fine, but opencode should check for exhaustive type guards.

6. **Earnings pack removal.** Any existing UI tests or eval harness prompts that reference `earnings` source pack will break. Check `__tests__/` for references.

---

## Rollback Plan

1. Revert all file changes via git (single commit or branch revert)
2. Remove `ASKEDGAR_API_KEY` and `ASKEDGAR_DAILY_LIMIT` from deployed environment
3. The Drizzle migration (if any) adds a value to a text check -- this is backward compatible and does not need to be rolled back
4. No data migration is needed for rollback; any `api_data` chunks in `jarvis_knowledge_chunks` are harmless orphans

---

## Order of Operations

1. **JRV-081** -- Types first. All other tickets depend on the type definitions.
2. **JRV-082** -- Schema + migration. Unblocks knowledge persistence.
3. **JRV-080** -- API client. Unblocks aggregator and route.
4. **JRV-084** -- Source pack update (quick, no dependencies beyond JRV-081).
5. **JRV-083** -- Aggregator. Depends on JRV-080 (client) and JRV-081 (types).
6. **JRV-085** -- Orchestrator prompt. Depends on JRV-081 (types) and JRV-083 (aggregator data shape).
7. **JRV-086** -- Route handler. Depends on JRV-080, JRV-082, JRV-083, JRV-085.
8. **JRV-087** -- Dilution report renderer. Can parallelize with JRV-085/086 (only depends on JRV-081 types).
9. **JRV-088** -- Wire renderer into structured response. Depends on JRV-087.
10. **JRV-089** -- JarvisTab UI changes. Depends on JRV-084 (pack update) and JRV-088 (renderer wired).
11. **JRV-090** -- Tests. Run last after all code is in place.

**Critical path:** JRV-081 -> JRV-080 -> JRV-083 -> JRV-085 -> JRV-086 -> JRV-089

**Parallelizable:** JRV-087 can run in parallel with JRV-085/JRV-086. JRV-084 can run in parallel with JRV-080.

---

## Complexity Estimate

**Overall: HIGH** (estimated 10-14 hours total implementation time)

| Ticket | Estimate |
|--------|----------|
| JRV-080 | 1-2 hr |
| JRV-081 | 30-60 min |
| JRV-082 | < 30 min |
| JRV-083 | 2-3 hr |
| JRV-084 | < 15 min |
| JRV-085 | 30-60 min |
| JRV-086 | 1-2 hr |
| JRV-087 | 2-3 hr |
| JRV-088 | < 15 min |
| JRV-089 | 30-60 min |
| JRV-090 | 1-2 hr |

---

## JARVIS_PLAN.md Updates

After Sprint 8 is complete, the following should be appended to `/home/jared/Nexus-Terminal/JARVIS_PLAN.md`:

**Phase F -- Dilution Intelligence (Sprint 8):**

```
### Phase F -- Dilution Intelligence (Sprint 8)

#### Sprint 8 -- Dilution Research Pack (AskEdgar Integration)

| Ticket | Description | Size | Status |
|--------|-------------|------|--------|
| JRV-080 | AskEdgar API client with typed endpoints and daily rate tracking | M | pending |
| JRV-081 | Dilution research types: new mode, source type, report schema | S | pending |
| JRV-082 | Add `api_data` source type to DB schema + knowledge retrieval | S | pending |
| JRV-083 | AskEdgar data aggregator: 12 endpoints -> unified report + chunks | L | pending |
| JRV-084 | Remove earnings pack, add dilution-research pack | XS | pending |
| JRV-085 | Dilution-specific orchestration system prompt + plan shortcut | M | pending |
| JRV-086 | Route handler: dilution-research mode with validation and ingestion | M | pending |
| JRV-087 | Dilution report renderer component (14 visual sections) | L | pending |
| JRV-088 | Wire dilution report into structured response renderer | S | pending |
| JRV-089 | JarvisTab UI: dilution research card + ticker input | M | pending |
| JRV-090 | Tests: client, aggregator, route integration | M | pending |

Exit criteria: User can enter a ticker, receive a comprehensive dilution research report with 14 sections, risk color coding, and data source verification. Results persist in knowledge for future context. API budget tracked at 100 calls/day.
```

**Build Order update:**

```
| Phase | Sprints | Milestone |
|-------|---------|-----------|
| Phase F | Sprint 8 | Dilution Intelligence |
```

---

*End of Sprint 8 Build Spec*

---

This document covers all the planning details you requested. Here is a summary of the key files reviewed and relevant to this plan:

- `/home/jared/Nexus-Terminal/JARVIS_PLAN.md` -- format reference, sprint history, current baseline
- `/home/jared/Nexus-Terminal/docs/AE_API_DOCS.md` -- full AskEdgar API reference (12 endpoints detailed)
- `/home/jared/Nexus-Terminal/lib/jarvis-types.ts` -- current type definitions (JarvisMode, JarvisSourceType, JarvisRequest, JarvisResponse, etc.)
- `/home/jared/Nexus-Terminal/lib/jarvis-source-packs.ts` -- current source packs (earnings to be removed, macro-daily to be kept)
- `/home/jared/Nexus-Terminal/lib/jarvis-orchestrator.ts` -- orchestration engine (plan/retrieve/summarize/critique/answer pipeline)
- `/home/jared/Nexus-Terminal/lib/jarvis-knowledge.ts` -- knowledge store (ingest, retrieve, assemble, evict)
- `/home/jared/Nexus-Terminal/app/api/jarvis/route.ts` -- main Jarvis API route (712 lines, mode branching at line ~604)
- `/home/jared/Nexus-Terminal/components/trading/JarvisTab.tsx` -- Jarvis UI (529 lines, mode cards, source input, response display)
- `/home/jared/Nexus-Terminal/components/trading/JarvisStructuredResponse.tsx` -- response renderer (135 lines, conditional macro summary render pattern)
- `/home/jared/Nexus-Terminal/components/trading/JarvisMacroSummary.tsx` -- macro summary card (84 lines, reference for card pattern and risk coloring)
- `/home/jared/Nexus-Terminal/lib/db/schema.ts` -- Drizzle schema, `jarvisKnowledgeChunks.sourceType` text enum on line 149-151
- `/home/jared/Nexus-Terminal/.env.example` -- current env vars (ASKEDGAR vars to be added)

**Security note (standing):** ALLOWED_EMAILS remains unenforced in auth callbacks. This is a pre-existing issue and not impacted by Sprint 8, but it persists.
