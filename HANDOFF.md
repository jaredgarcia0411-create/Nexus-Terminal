# Build Spec — Sprint 8: Dilution Research Pack (AskEdgar Integration)

> Generated: 2026-03-10 | Agent: nexus-architect
> Status: IN PROGRESS — implementation largely complete, final fixes pending

## Sprint 8 Progress Snapshot

- [x] Step 1: JRV-081 — Dilution Research Types
- [x] Step 2: JRV-082 — Add `api_data` Source Type
- [x] Step 3: JRV-080 — AskEdgar API Client
- [x] Step 4: JRV-084 — Remove Earnings Pack, Add Dilution Research Pack
- [x] Step 5: JRV-083 — AskEdgar Data Aggregator
- [x] Step 6: JRV-085 — Dilution Orchestration Prompt
- [x] Step 7: JRV-086 — Route Handler
- [x] Step 8: JRV-087 — Dilution Report Renderer
- [x] Step 9: JRV-088 — Wire Renderer into Structured Response
- [~] Step 10: JRV-089 — JarvisTab UI (minor submit-path mismatch remains)
- [~] Step 11: JRV-090 — Tests implemented; runtime verification remains final gate

## Sprint 8 Remaining Items

1. Update Jarvis primary submit path to honor selected mode (currently hardcoded assistant mode in `components/trading/JarvisTab.tsx`).
2. Re-run and record final verification commands:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
3. Reconfirm manual dilution flow behavior with ticker-required submit UX.

---

## Objective

Replace the Jarvis earnings source pack with a Dilution Research pack powered by the AskEdgar API (`https://eapi.askedgar.io`). This produces an "Ultimate Research Report" for a single ticker on demand, focused on sub-$200M market cap companies. The report covers dilution risk, offering history, scam indicators, float changes, agreements, cash burn, and news — all from 12 AskEdgar endpoints. Results persist in `jarvis_knowledge_chunks` for future context. The feature runs through the existing orchestration pipeline.

**Tickets:** JRV-080 through JRV-090 (11 tickets)

**Full plan reference:** `JARVIS_PLAN.md` Phase F, `docs/SPRINT_8_SPEC.md`
**AskEdgar API reference:** `docs/AE_API_DOCS.md`

---

## What Changes

### New Files (3 source + 3 test)

| File | Purpose | Ticket |
|------|---------|--------|
| `lib/askedgar-client.ts` | Typed API client for 12 AskEdgar endpoints with auth, rate tracking, error handling | JRV-080 |
| `lib/askedgar-aggregator.ts` | Orchestrates 12 parallel API calls → unified `DilutionResearchReport` + knowledge chunks | JRV-083 |
| `components/trading/JarvisDilutionReport.tsx` | 14-section report renderer with risk color coding | JRV-087 |
| `__tests__/askedgar-client.test.ts` | Client unit tests | JRV-090 |
| `__tests__/askedgar-aggregator.test.ts` | Aggregator unit tests | JRV-090 |
| `__tests__/jarvis-dilution-route.test.ts` | Route integration tests | JRV-090 |

### Modified Files (9)

| File | What Changes | Ticket |
|------|-------------|--------|
| `lib/jarvis-types.ts` | Add `dilution-research` to `JarvisMode`, `api_data` to `JarvisSourceType`, `ticker` to `JarvisRequest`, `dilutionReport` to `JarvisResponse`, all `DilutionResearchReport` sub-types | JRV-081 |
| `lib/db/schema.ts` | Add `api_data` to `jarvisKnowledgeChunks.sourceType` enum array | JRV-082 |
| `lib/jarvis-knowledge.ts` | Add `api_data` to default sourceTypes in `retrieveKnowledgeChunks` | JRV-082 |
| `lib/jarvis-scrape-cache.ts` | Add 24h TTL branch for `api_data` source type | JRV-082 |
| `lib/jarvis-source-packs.ts` | Remove earnings pack, add dilution-research pack, update category union | JRV-084 |
| `lib/jarvis-orchestrator.ts` | Add dilution-specific system prompt, short-circuit plan step for dilution mode | JRV-085 |
| `app/api/jarvis/route.ts` | Add `dilution-research` mode branch with ticker validation, aggregator call, knowledge ingestion, orchestration | JRV-086 |
| `components/trading/JarvisStructuredResponse.tsx` | Import and conditionally render `JarvisDilutionReport`, add `api_data` source badge (cyan) | JRV-088 |
| `components/trading/JarvisTab.tsx` | Add Dilution Research mode card, ticker input field, wire submit with `ticker` param, remove earnings references | JRV-089 |

### Environment Variables (add to `.env.example`)

```
# AskEdgar API (optional — enables dilution research)
ASKEDGAR_API_KEY=
ASKEDGAR_DAILY_LIMIT=100
```

---

## What Does NOT Change

| File | Why |
|------|-----|
| `lib/jarvis-allowlist.ts` | AskEdgar is an API, not a scraped domain — no allowlist entry needed |
| `lib/jarvis-scrape.ts` | Scraping pipeline untouched — dilution uses API, not web scraping |
| `lib/jarvis-response.ts` | LLM response parsing unchanged — dilution report is a separate field, not parsed from LLM output |
| `lib/jarvis-embedding.ts` | Embedding pipeline unchanged — chunks from aggregator use existing ingest path |
| `lib/jarvis-robots.ts` | No robots.txt needed for API calls |
| `lib/jarvis-rate-limit.ts` | Existing per-user rate limiting applies as-is to the new mode |
| `lib/jarvis-circuit-breaker.ts` | Circuit breaker applies to LLM calls within orchestration, works unchanged |
| `lib/jarvis-token-tracking.ts` | Token tracking works unchanged — new mode logged like any other |
| `app/api/jarvis/cron/headlines/route.ts` | Macro cron unchanged |
| `app/api/jarvis/upload/route.ts` | Document upload unchanged |
| `app/api/jarvis/admin/*/route.ts` | Admin endpoints unchanged |
| `components/trading/JarvisMacroSummary.tsx` | Macro summary card unchanged |
| `components/trading/JarvisDocuments.tsx` | Document upload UI unchanged |
| All existing `__tests__/jarvis-*.test.ts` | Must continue to pass — no breaking changes |
| `middleware.ts` | No route changes |

---

## Report Section → API Endpoint Mapping

Each report uses **12 AskEdgar API calls** fired in parallel. The `dilution-rating` endpoint is the workhorse — it feeds 6 of the 14 report sections.

| # | Endpoint Call | Report Sections Fed |
|---|-------------|-------------------|
| 1 | `GET /v1/float-outstanding?ticker=X` | Header (float, OS, country, industry, ownership %) |
| 2 | `GET /v1/screener?ticker=X` | Header (price, market cap, gains, volume, short data) |
| 3 | `GET /v1/dilution-rating?ticker=X` | Dilution, Offering Frequency, Offering Ability, Cash Need, Commentary, Overall Risk |
| 4 | `GET /v1/dilution-data?ticker=X` | Dilution (warrants + convertibles detail) |
| 5 | `GET /v1/offerings?ticker=X&limit=20` | Offering Frequency (offering history) |
| 6 | `GET /v1/registrations?ticker=X&effective_status=true` | Offering Ability (active shelves, ATMs) |
| 7 | `GET /v1/news?ticker=X&limit=20` | News / Why It's Running, Other Catalysts |
| 8 | `GET /v1/nasdaq-compliance?ticker=X` | Other Catalysts |
| 9 | `GET /v1/pump-and-dump-tracker?ticker=X` | Scam Risk |
| 10 | `GET /v1/agreements?ticker=X` | Agreements & Lock-ups |
| 11 | `GET /v1/historical-float-pro?ticker=X&limit=20` | Historical Float (OS change over time) |
| 12 | `GET /v1/reverse-splits?ticker=X` | Reverse Splits |

**Budget:** 100 calls/day ÷ 12 calls/report = ~8 full reports/day.

---

## Report Sections (14 total)

Each section has a risk indicator: Low=emerald/green, Medium=amber/yellow, High=rose/red.

1. **Header** — Price, Market Cap, Float/OS, Country, Industry, Gain badges, Short Interest
2. **Data Sources** — Checklist of 12 endpoints showing green check / red X
3. **News / Why It's Running** — Recent news articles + SEC filing summaries
4. **Other Catalysts** — Nasdaq compliance issues + catalyst-tagged news (FDA, Contracts, Partnerships, etc.)
5. **Dilution** — Dilution rating + warrant table + convertible table
6. **Offering Frequency** — Rating + offering history list
7. **Offering Ability** — Rating + active registrations/ATMs table
8. **Cash Need** — Rating + cash/burn/months/debt stats
9. **Commentary on Financial Condition** — Management commentary text
10. **Overall Offering Risk** — Composite risk rating + RegSHO + Nasdaq compliance
11. **Scam Risk** — Country/Float/Underwriter/Scam risk grid with descriptions
12. **Agreements & Lock-ups** — Registration rights, equity restrictions, participation rights
13. **Historical Float** — Table showing OS/float changes over time from SEC filings
14. **Reverse Splits** — Date and ratio table

Sections with no data show "No data available" (not hidden).

---

## Execution Order

Execute in this exact sequence. Each ticket lists every file to create or modify.

---

### Step 1: JRV-081 — Dilution Research Types

**Complexity:** S (30-60 min) | **Dependencies:** None

**File:** MODIFY `lib/jarvis-types.ts`

Add to `JarvisMode` union: `'dilution-research'`

Add to `JarvisSourceType` union: `'api_data'`

Add to `JarvisRequest`: `ticker?: string`

Add to `JarvisResponse`: `dilutionReport?: DilutionResearchReport`

Define and export all new types:

```
DilutionResearchReport {
  ticker: string
  generatedAt: string
  header: DilutionReportHeader
  dataSources: DilutionDataSourceCheck[]
  news: DilutionNewsItem[]
  catalysts: DilutionCatalystItem[]
  dilution: DilutionSection
  offeringFrequency: OfferingFrequencySection
  offeringAbility: OfferingAbilitySection
  cashNeed: CashNeedSection
  managementCommentary: string
  overallOfferingRisk: OverallRiskSection
  scamRisk: ScamRiskSection
  agreements: AgreementItem[]
  historicalFloat: HistoricalFloatEntry[]
  reverseSplits: ReverseSplitEntry[]
}

DilutionReportHeader {
  price: number | null
  marketCap: number | null
  float: number | null
  outstanding: number | null
  country: string
  industry: string
  sector: string
  isAdr: boolean
  gain1d: number | null
  gain7d: number | null
  gain30d: number | null
  volume: number | null
  avgVolume: number | null
  shortFloat: number | null
  shortInterest: number | null
  feeRate: number | null
  insiderPercent: number | null
  affiliatePercent: number | null
  institutionsPercent: number | null
}

DilutionDataSourceCheck { endpoint: string; label: string; hasData: boolean; error?: string }

DilutionNewsItem { title: string; summary: string; body: string; filedAt: string; formType: string; author: string; tags: string[]; documentUrl: string; isNews: boolean }

DilutionCatalystItem { type: string; description: string; date: string; risk?: string; source: 'news' | 'compliance' }

RiskRating = 'High' | 'Medium' | 'Low' | ''

RiskLevel = 'high' | 'medium' | 'low' | ''

DilutionSection {
  rating: RiskRating
  description: string
  warrantExercise: RiskRating
  warrantExerciseDesc: string
  warrants: WarrantItem[]
  convertibles: ConvertibleItem[]
}

WarrantItem { details: string; amount: number | null; remaining: number | null; exercisePrice: number | null; registered: string; exercisableDate: string; expirationDate: string; filedAt: string }

ConvertibleItem { details: string; conversionPrice: number | null; registered: string; convertibleDate: string; maturityDate: string; offeringAmount: number | null; debtRemaining: number | null; sharesRemaining: number | null; filedAt: string }

OfferingFrequencySection { rating: RiskRating; description: string; offerings: OfferingItem[] }

OfferingItem { headline: string; filedAt: string; formType: string; offeringType: string; sharesAmount: number | null; warrantsAmount: number | null; sharePrice: number | null; offeringAmount: number | null; conversionPrice: number | null }

OfferingAbilitySection { rating: RiskRating; description: string; registrations: RegistrationItem[] }

RegistrationItem { headline: string; filedAt: string; effectiveDate: string; expirationDate: string; effectiveStatus: boolean; offeringAmount: number | null; isAtm: boolean; bank: string; amountRemainingAtm: number | null; totalRaised: number | null; overBabyShelf: boolean }

CashNeedSection { rating: RiskRating; description: string; estimatedCash: number | null; cashBurn: number | null; cashRemainingMonths: number | null; totalDebt: number | null }

OverallRiskSection { rating: RiskRating; regsho: boolean; nasdaqCompliance: RiskRating; nasdaqComplianceDesc: string }

ScamRiskSection { countryRisk: RiskLevel; floatRisk: RiskLevel; underwriterRisk: RiskLevel; scamRisk: RiskLevel; scamDescription: string; liquidationHistory: string; numberOfLiquidations: number; lastLiquidationDate: string; ipoDate: string; lockUpExpiration: string; underwriters: string }

AgreementItem { agreementType: string; investorNames: string; filedAt: string; registrationDeadline: number | null; effectiveDeadline: number | null; penalties: string; restrictionDate: string; durationInDays: number | null; participationPercentage: string; details: string }

HistoricalFloatEntry { reportedDate: string; outstandingShares: number | null; float: number | null; tradableFloat: number | null; affiliatePercent: number | null; insiderPercent: number | null; institutionsPercent: number | null; formType: string }

ReverseSplitEntry { executionDate: string; splitFrom: number; splitTo: number }
```

**Acceptance criteria:**
- [ ] All types exported
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 2: JRV-082 — Add `api_data` Source Type

**Complexity:** S (< 30 min) | **Dependencies:** JRV-081

**File:** MODIFY `lib/db/schema.ts`
- Add `'api_data'` to `jarvisKnowledgeChunks.sourceType` text enum array: `['web_source', 'trade_journal', 'user_document', 'cached_headline', 'api_data']`

**File:** MODIFY `lib/jarvis-knowledge.ts`
- Add `'api_data'` to the default `sourceTypes` array in `retrieveKnowledgeChunks`

**File:** MODIFY `lib/jarvis-scrape-cache.ts`
- Add a TTL branch for `api_data`: 24 hours (86400000ms), configurable via `JARVIS_SCRAPE_CACHE_TTL_API_MS`

**File:** MODIFY `.env.example`
- Add `ASKEDGAR_API_KEY=` and `ASKEDGAR_DAILY_LIMIT=100`

Run `npx drizzle-kit generate` to keep migration history in sync (Drizzle text enums are app-level only, so the DB migration may be a no-op).

**Acceptance criteria:**
- [ ] Schema enum includes `'api_data'`
- [ ] Knowledge retrieval includes `'api_data'` in defaults
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 3: JRV-080 — AskEdgar API Client

**Complexity:** M (1-2 hr) | **Dependencies:** None (can parallel with Steps 1-2)

**File:** CREATE `lib/askedgar-client.ts`

Build a typed API client for `https://eapi.askedgar.io`:

- Auth: `API-KEY` header from `process.env.ASKEDGAR_API_KEY`
- If key is not set, all methods return `{ status: 'error', count: 0, results: [] }`
- Rate tracking: module-level `callCount` and `resetDate` (YYYY-MM-DD UTC). Check against `ASKEDGAR_DAILY_LIMIT` (default 100) before each call. Return error if budget exhausted.
- Ticker validation: `/^[A-Z0-9.\-^]+$/` — reject invalid tickers
- Timeout: 15 seconds per request via AbortController
- Response type: `AskEdgarResponse<T> = { status: string; count: number; results: T[]; error?: string }`
- Use `URLSearchParams` for query building (prevents injection)

Export one function per endpoint:

```typescript
fetchFloatOutstanding(ticker: string): Promise<AskEdgarResponse<FloatOutstandingResult>>
fetchScreenerByTicker(ticker: string): Promise<AskEdgarResponse<ScreenerResult>>
fetchDilutionRating(ticker: string): Promise<AskEdgarResponse<DilutionRatingResult>>
fetchDilutionData(ticker: string): Promise<AskEdgarResponse<DilutionDataResult>>
fetchOfferings(ticker: string, limit?: number): Promise<AskEdgarResponse<OfferingResult>>
fetchRegistrations(ticker: string): Promise<AskEdgarResponse<RegistrationResult>>
fetchNews(ticker: string, limit?: number): Promise<AskEdgarResponse<NewsResult>>
fetchNasdaqCompliance(ticker: string): Promise<AskEdgarResponse<NasdaqComplianceResult>>
fetchPumpAndDumpTracker(ticker: string): Promise<AskEdgarResponse<PumpAndDumpResult>>
fetchAgreements(ticker: string): Promise<AskEdgarResponse<AgreementResult>>
fetchHistoricalFloatPro(ticker: string, limit?: number): Promise<AskEdgarResponse<HistoricalFloatResult>>
fetchReverseSplits(ticker: string): Promise<AskEdgarResponse<ReverseSplitResult>>
```

Also export `getAskEdgarCallCount()` and `getAskEdgarDailyLimit()` for observability.

Define all `*Result` types to match the AskEdgar API response shapes documented in `docs/AE_API_DOCS.md`. Use snake_case field names matching the API (conversion to camelCase happens in the aggregator).

**Acceptance criteria:**
- [ ] All 12 fetch functions exported with correct TypeScript return types
- [ ] Missing API key returns structured error, does not throw
- [ ] Daily call counter rejects when limit reached
- [ ] Request timeout after 15 seconds
- [ ] Ticker validation rejects lowercase / special chars
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 4: JRV-084 — Remove Earnings Pack, Add Dilution Research Pack

**Complexity:** XS (< 15 min) | **Dependencies:** JRV-081

**File:** MODIFY `lib/jarvis-source-packs.ts`

- Remove the `earnings` object from `sourcePacks` array
- Update `SourcePack.category` to `'macro' | 'dilution'`
- Add new pack:
  ```
  {
    id: 'dilution-research',
    name: 'Dilution Research',
    description: 'SEC filings, dilution risk, scam indicators, and float analysis for a single ticker.',
    icon: 'Search',
    category: 'dilution',
    urls: [],
    promptTemplate: 'Generate a comprehensive dilution research report for the specified ticker.',
  }
  ```
- Keep `macro-daily` pack unchanged

**Acceptance criteria:**
- [ ] `getSourcePack('dilution-research')` returns the pack
- [ ] `getSourcePack('earnings')` returns undefined
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 5: JRV-083 — AskEdgar Data Aggregator

**Complexity:** L (2-3 hr) | **Dependencies:** JRV-080, JRV-081

**File:** CREATE `lib/askedgar-aggregator.ts`

Export:
```typescript
async function aggregateDilutionReport(ticker: string): Promise<{
  report: DilutionResearchReport;
  chunks: ScrapedChunk[];
  warnings: string[];
}>
```

Implementation:

1. Call all 12 endpoint functions from `askedgar-client.ts` via `Promise.allSettled`
2. For each endpoint: if error or empty results, set `hasData: false` in `dataSources`, add warning, populate section with defaults
3. Assemble `DilutionResearchReport` by mapping API response fields (snake_case) to report types (camelCase)

Key transformations:
- **News partitioning:** Split `/v1/news` results: `form_type === 'news' | 'grok' | 'jmt415'` → `isNews: true`, SEC filing types → `isNews: false`
- **Catalyst extraction:** Filter news items whose `tags` include: `FDA`, `Contracts`, `Partnerships`, `Mergers`, `Acquisitions`, `Clinical Trials`, `Product Launches`, `Expansion Plans`, `License Agreements`. Each `nasdaq-compliance` result → catalyst with `source: 'compliance'`
- **Warrant vs Convertible:** In `dilution-data` results, warrants have `warrants_amount`, convertibles have `conversion_price`
- **Historical Float:** Map to `HistoricalFloatEntry[]`, sorted by `reported_date` descending

Chunk generation:
- Convert each report section to a text chunk for knowledge ingestion
- Use `sourceUrl: 'askedgar://<ticker>/<section-name>'`, `sourceHost: 'askedgar.io'`, `sourceType: 'api_data'`
- ~14 chunks per report (one per section)

**Acceptance criteria:**
- [ ] All 12 endpoints called; any single failure does not block others
- [ ] `dataSources` has 12 entries with correct `hasData` flags
- [ ] Warrant/convertible items correctly separated
- [ ] News/filing items correctly partitioned
- [ ] Returns `ScrapedChunk[]` suitable for `ingestKnowledgeChunks`
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 6: JRV-085 — Dilution Orchestration Prompt

**Complexity:** M (30-60 min) | **Dependencies:** JRV-081, JRV-083

**File:** MODIFY `lib/jarvis-orchestrator.ts`

1. In `stepPlan`: when `mode === 'dilution-research'`, return a fixed plan (no LLM call):
   ```
   { keywords: [ticker], tickers: [ticker], sourceTypes: ['api_data'], focusRegions: [] }
   ```

2. Add `DILUTION_SUMMARIZE_SYSTEM_PROMPT` constant. Instruct the LLM to:
   - Analyze AskEdgar data for dilution risk to short-term traders
   - Call out warrant exercise prices near current price
   - Highlight imminent cash need (under 6 months runway)
   - Flag high scam risk indicators
   - Note active shelf registrations or ATM programs
   - Quantify total potential dilution from warrants + convertibles
   - Output standard structured format: `{ tldr, findings, actionSteps, risks }`

3. In `stepSummarize`: if `mode === 'dilution-research'`, use the dilution-specific system prompt

**Acceptance criteria:**
- [ ] Plan step short-circuits (no LLM call) for dilution mode
- [ ] Summarize uses dilution-specific prompt
- [ ] Fallback to deterministic response works if LLM fails
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 7: JRV-086 — Route Handler

**Complexity:** M (1-2 hr) | **Dependencies:** JRV-080, JRV-082, JRV-083, JRV-085

**File:** MODIFY `app/api/jarvis/route.ts`

Add a new mode branch after the `macro-summary` block:

```
if (mode === 'dilution-research') {
  // 1. Validate body.ticker: non-empty string, uppercase, matches /^[A-Z0-9.\-^]+$/
  //    Return 400 if missing or invalid
  // 2. Call aggregateDilutionReport(body.ticker)
  // 3. Ingest returned chunks into jarvis_knowledge_chunks with sourceType 'api_data', userId
  // 4. Build text prompt from report data (flatten key sections into readable context)
  // 5. Call runOrchestration with mode 'dilution-research', assembled prompt, tradeTickers: [ticker]
  // 6. Return { message, structured, dilutionReport, warnings, sources }
  // 7. Log via logJarvisRequest with mode 'dilution-research'
}
```

The `dilutionReport` field contains the aggregator's full report (raw data). The `structured` field contains the LLM's analysis (tldr/findings/actionSteps/risks).

**Acceptance criteria:**
- [ ] Missing/invalid ticker returns 400
- [ ] Aggregator called, report returned in `dilutionReport`
- [ ] Chunks ingested into knowledge store
- [ ] Orchestration produces structured analysis
- [ ] Rate limiting and token tracking apply
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 8: JRV-087 — Dilution Report Renderer

**Complexity:** L (2-3 hr) | **Dependencies:** JRV-081 (can parallel with Steps 5-7)

**File:** CREATE `components/trading/JarvisDilutionReport.tsx`

`'use client'` component. Props: `{ report: DilutionResearchReport }`

Risk color mapping:
- `'Low'` / `'low'` → `border-emerald-500/30 bg-emerald-500/10 text-emerald-300`
- `'Medium'` / `'medium'` → `border-amber-500/30 bg-amber-500/10 text-amber-300`
- `'High'` / `'high'` → `border-rose-500/30 bg-rose-500/10 text-rose-300`
- Empty/missing → `border-zinc-500/30 bg-zinc-500/10 text-zinc-300`

14 sections (in order):
1. **Header card** — Ticker, price, market cap, float/OS, country, industry. Gain badges (green/red). Short interest row. Ownership breakdown.
2. **Data sources checklist** — Grid of 12 items with green check / red X icons
3. **News** — Collapsible list of news items + filing summaries. Tags as small badges.
4. **Other Catalysts** — Cards for compliance issues and catalyst-tagged news
5. **Dilution** — Rating badge, warrant table, convertible table
6. **Offering Frequency** — Rating badge + offering history list
7. **Offering Ability** — Rating badge + active registrations table (highlight ATMs, baby shelf)
8. **Cash Need** — Rating badge + 4-column stat grid (cash, burn, months, debt)
9. **Management Commentary** — Quoted text block (or "No commentary available")
10. **Overall Offering Risk** — Large rating badge + RegSHO flag + Nasdaq compliance
11. **Scam Risk** — 4-indicator grid (country, float, underwriter, scam) each with risk badge
12. **Agreements** — Cards per agreement with type badge, investor names, deadlines, penalties
13. **Historical Float** — Table: date, OS, float, tradable float over time
14. **Reverse Splits** — Table: date and ratio

If a section has no data, show muted "No data available" (do NOT hide the section).

Follow design patterns from `JarvisMacroSummary.tsx` (dark theme cards, border styling).

**Acceptance criteria:**
- [ ] All 14 sections rendered
- [ ] Risk ratings show correct colors
- [ ] Empty sections show "No data available"
- [ ] `'use client'` directive present
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 9: JRV-088 — Wire Renderer into Structured Response

**Complexity:** S (< 15 min) | **Dependencies:** JRV-087

**File:** MODIFY `components/trading/JarvisStructuredResponse.tsx`

- Import `JarvisDilutionReport` from `@/components/trading/JarvisDilutionReport`
- Add `dilutionReport?: DilutionResearchReport` to props
- After the macro summary conditional render, add: `{dilutionReport ? <JarvisDilutionReport report={dilutionReport} /> : null}`
- Add `'api_data'` to the source type badge function: `{ label: 'AskEdgar', className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200' }`

**Acceptance criteria:**
- [ ] Renders when `dilutionReport` present, hidden when undefined
- [ ] `api_data` gets cyan "AskEdgar" badge
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 10: JRV-089 — JarvisTab UI

**Complexity:** M (30-60 min) | **Dependencies:** JRV-084, JRV-088

**File:** MODIFY `components/trading/JarvisTab.tsx`

- Add state: `const [dilutionTicker, setDilutionTicker] = useState('')`
- Add `Search` to lucide-react imports
- In the mode cards array, add after macro-summary:
  ```
  { mode: 'dilution-research', label: 'Dilution Research', description: 'SEC dilution risk report via AskEdgar.', icon: Search }
  ```
- Update grid from `lg:grid-cols-4` to `lg:grid-cols-5` (or flex-wrap)
- Add ticker input row that appears when dilution-research mode is selected:
  ```
  <input value={dilutionTicker} onChange={...} placeholder="e.g. MULN" />
  ```
- When Dilution Research card clicked without a ticker → focus the input (don't fire request)
- When submitted with a ticker → POST with `{ mode: 'dilution-research', ticker: dilutionTicker.toUpperCase().trim() }`
- Pass `response.dilutionReport` to `JarvisStructuredResponse`
- Remove any references to the old earnings source pack

**Acceptance criteria:**
- [ ] Dilution Research card appears in mode grid
- [ ] Ticker input appears and is required
- [ ] Request includes `ticker` and `mode: 'dilution-research'`
- [ ] Earnings pack references gone
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 11: JRV-090 — Tests

**Complexity:** M (1-2 hr) | **Dependencies:** JRV-080, JRV-083, JRV-086

**Files:** CREATE 3 test files

**`__tests__/askedgar-client.test.ts`:**
- Mock `globalThis.fetch`
- Test: missing API key → error result
- Test: rate limit exceeded → error after N calls
- Test: invalid ticker rejected
- Test: successful response parsed for each endpoint
- Test: network error → structured error
- Test: 401 → auth error
- Test: timeout handling

**`__tests__/askedgar-aggregator.test.ts`:**
- Mock the client functions
- Test: all endpoints succeed → full report assembled
- Test: one endpoint fails → that section empty, warning added, others intact
- Test: all endpoints fail → all sections empty, 12 warnings
- Test: news partitioning (news vs filings)
- Test: warrant vs convertible detection
- Test: catalyst extraction from tags
- Test: chunk generation count and format

**`__tests__/jarvis-dilution-route.test.ts`:**
- Mock auth, aggregator, orchestration, knowledge store
- Test: missing ticker → 400
- Test: invalid ticker format → 400
- Test: successful request → dilutionReport + structured in response
- Test: rate limit applied
- Test: token tracking logged

**Acceptance criteria:**
- [ ] All test files pass with `npm test`
- [ ] `npm run lint && npx tsc --noEmit` passes

---

## Security Notes

1. **`ASKEDGAR_API_KEY`** must only be read server-side in `lib/askedgar-client.ts`. Never in client components. Verify no client import chain.
2. **Ticker injection:** User-supplied `ticker` flows into URL query strings. Validation regex + `URLSearchParams` prevents injection.
3. **Rate limiting:** Per-user Jarvis rate limit (30 req/hr) + AskEdgar daily budget (100 calls/day) both apply.
4. **Data sensitivity:** AskEdgar returns public SEC data only. Safe to store and display.
5. **ALLOWED_EMAILS:** Still not enforced (pre-existing, not Sprint 8 scope).

---

## Architectural Risks

1. **In-memory rate counter resets on cold start.** Vercel serverless functions restart frequently. 100 calls/day is best-effort. Acceptable for small user base.
2. **12 concurrent API calls per report.** If AskEdgar has undocumented per-second limits, `Promise.allSettled` may trigger 429s. Mitigation: add sequential fallback with 200ms delays only if 429s are observed.
3. **Type exhaustiveness.** Adding `'dilution-research'` to `JarvisMode` may cause TS exhaustiveness errors in existing switch/if-else chains. Check all mode handlers.
4. **Earnings pack removal.** Check `__tests__/` for references to `earnings` source pack — update or remove.

---

## Testing Requirements

After all changes:

```bash
npm run lint
npx tsc --noEmit
npm test
```

All three must pass. Verify:
- [ ] All existing `__tests__/jarvis-*.test.ts` continue to pass
- [ ] 3 new test files pass
- [ ] Manual test: enter `MULN` or `WNW` → report renders with all sections
- [ ] Manual test: enter a ticker with no data → "No data available" per section
- [ ] Manual test: macro summary still works unchanged
- [ ] Manual test: other modes (daily-summary, trade-analysis, assistant) unchanged
- [ ] `ASKEDGAR_API_KEY` missing → clean error in UI

---

## Rollback Plan

1. Revert all file changes via git
2. Remove `ASKEDGAR_API_KEY` and `ASKEDGAR_DAILY_LIMIT` from deployed env
3. Schema change is backward compatible (adding a value to text enum) — no DB rollback needed
4. Any `api_data` chunks in knowledge store are harmless orphans

---
---

# Build Spec — UI Layout Overhaul: Dashboard/Performance Redistribution

> Generated: 2026-03-09 | Agent: nexus-architect (Opus 4.6)
> Status: COMPLETE — implemented in codebase

## UI Overhaul Progress Snapshot

- [x] Step 1: Add `variant` prop to `PerformanceCharts`
- [x] Step 2: Create `WeeklyCalendar` component
- [x] Step 3: Create `PerformanceStatsTable` component
- [x] Step 4: Modify `DashboardTab` — title, summary charts, add calendars
- [x] Step 5: Modify `PerformanceTab` — remove calendar, add stats table, title border
- [x] Step 6: Move date range filter to `Toolbar`
- [x] Step 7: Remove date range from `TradesTab`
- [x] Step 8: Add title border for `JournalTab`
- [x] Step 9: Wire all new/removed props in `app/page.tsx`
- [~] Note: Weekly zero-PnL day styling is currently positive-colored instead of muted.

---

## Objective

Redistribute chart content between DashboardTab and PerformanceTab, add a weekly calendar to Dashboard, add a comprehensive stats table to Performance, move the date range filter to the global Toolbar, and standardize title styling across all tabs.

---

## Current State Summary

- **DashboardTab** (205 lines): No title, renders full `<PerformanceCharts>` (all 7 charts), stat cards, recent trades. No calendar.
- **PerformanceTab** (91 lines): Title without border, renders full `<PerformanceCharts>` (duplicate of Dashboard), `<TradingCalendar>`, Symbol Distribution, Risk Summary.
- **PerformanceCharts** (317 lines): 7 chart sections in 3 rows — Equity Curve, Daily Performance, Day of Week, Time of Day, Win/Loss Days, Drawdown, Tag Breakdown.
- **TradesTab** (177 lines): Title with border, has date range filter + tag filter.
- **Toolbar** (157 lines): Filter presets (All/30D/60D/90D), no date range picker.
- **TradingCalendar** (237 lines): Monthly calendar with daily P&L, standalone component.

### Title Styling Audit

| Tab | Has Title | Has Border | Consistent |
|-----|-----------|------------|------------|
| Dashboard | NO | NO | NO |
| Performance | YES | NO | NO |
| Journal | YES | YES (container border) | PARTIAL |
| Trades | YES | YES (container border) | YES |
| Jarvis | YES | YES | YES |

---

## Execution Steps

Execute in this exact sequence. Each step lists every file to create or modify.

---

### Step 1: Add `variant` prop to PerformanceCharts

**Complexity:** LOW | **Dependencies:** None

**File:** MODIFY `components/trading/PerformanceCharts.tsx`

1. Add prop: `variant?: 'summary' | 'full'` defaulting to `'full'`
2. When `variant === 'summary'`: render ONLY the first grid row (Equity Curve + Daily Performance). Skip rows 2-3 entirely.
3. When `variant === 'summary'`: wrap the `dayOfWeekData`, `timeOfDayData`, `winLossDayData`, `tagBreakdownData` useMemo hooks so they return empty arrays when variant is `'summary'` (avoids unnecessary computation).
4. When `variant === 'full'` (default): render ALL 7 chart sections unchanged. Backward compatible.

**Acceptance criteria:**
- [ ] `<PerformanceCharts trades={t} metric="$" variant="summary" />` renders only Equity Curve and Daily Performance
- [ ] `<PerformanceCharts trades={t} metric="$" />` renders all 7 charts (backward compatible)
- [ ] No computation of dayOfWeek/timeOfDay/winLoss/tag data when variant is `'summary'`
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 2: Create WeeklyCalendar component

**Complexity:** MEDIUM | **Dependencies:** None (can parallel with Step 1)

**File:** CREATE `components/trading/WeeklyCalendar.tsx`

A `'use client'` component showing the current week as 7 bordered day cards in a horizontal row.

**Props:** `{ trades: Trade[] }`

**Imports:**
- `date-fns`: `startOfWeek`, `endOfWeek`, `eachDayOfInterval`, `format`, `isSameDay`, `isToday`
- `@/lib/trading-utils`: `formatCurrency`
- `@/lib/types`: `Trade`

**Logic:**
- Compute `weekDays`: `eachDayOfInterval({ start: startOfWeek(new Date(), { weekStartsOn: 1 }), end: endOfWeek(new Date(), { weekStartsOn: 1 }) })` — gives Mon-Sun for current week
- Compute `dailyStats`: group trades by `format(tradeDate, 'yyyy-MM-dd')`, sum P&L, count trades per day

**Render:**
```tsx
<div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
  <h3 className="mb-4 text-lg font-semibold text-white">
    {format(weekDays[0], 'MMM yyyy')}
  </h3>
  <div className="grid grid-cols-7 gap-3">
    {weekDays.map(day => <DayCard />)}
  </div>
</div>
```

Each day card:
```tsx
<div className={`rounded-xl border p-4 flex flex-col gap-1 min-h-[120px] ${
  isToday(day) ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-white/[0.02]'
}`}>
  <div className="flex items-center justify-between">
    <span className="text-2xl font-bold text-white">{format(day, 'd')}</span>
    <span className="text-xs font-medium text-zinc-500">{format(day, 'EEE')}</span>
  </div>
  <div className="mt-auto">
    <span className={`text-sm font-bold ${pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
      {formatCurrency(pnl)}
    </span>
    <span className="text-[10px] text-zinc-500 block">{count} trades</span>
  </div>
</div>
```

**Design reference:** Match the screenshot layout — large day number top-left, day name top-right, P&L and trade count at bottom. Each card is a rounded bordered box. Days with $0 P&L and 0 trades show "$0" and "0 trades" in muted text.

**Acceptance criteria:**
- [ ] Shows exactly 7 day cards (Mon through Sun of current week)
- [ ] Today's card has emerald border highlight
- [ ] Days with trades show green/red P&L and trade count
- [ ] Days without trades show $0 and 0 trades in muted text
- [ ] Responsive: reduce padding on mobile
- [ ] TypeScript strict — no `any` types
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 3: Create PerformanceStatsTable component

**Complexity:** HIGH | **Dependencies:** None (can parallel with Steps 1-2)

**File:** CREATE `components/trading/PerformanceStatsTable.tsx`

A `'use client'` component displaying a comprehensive 3-column stats table.

**Props:** `{ trades: Trade[]; onTradeClick: (trade: Trade) => void }`

**Imports:**
- `react`: `useMemo`
- `@/lib/types`: `Trade`
- `@/lib/trading-utils`: `formatCurrency`
- `lucide-react`: `ArrowUpRight`, `Info`

**Stats to compute (single useMemo):**
- Total Gain/Loss, Largest Gain (with trade ref), Largest Loss (with trade ref)
- Average Daily Gain/Loss, Average Daily Volume, Average Per-Share Gain/Loss
- Average Trade Gain/Loss, Average Winning Trade, Average Losing Trade
- Total Number of Trades, Number of Winning Trades (with %), Number of Losing Trades (with %)
- Average Hold Time (scratch trades), Average Hold Time (winning trades), Average Hold Time (losing trades)
- Number of Scratch Trades, Max Consecutive Wins (with trade ref), Max Consecutive Losses (with trade ref)
- Trade P&L Standard Deviation, System Quality Number (SQN), Probability of Random Chance
- Kelly Percentage, K-Ratio, Profit Factor
- Total Commissions, Total Fees
- Average Position MAE, Average Position MFE

**Hold time formatting:** Convert minutes to human-readable ("about 4 hours", "0" for zero).

**erf helper** (needed for Probability of Random Chance):
```typescript
function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
```

**Clickable stats:** Largest Gain, Largest Loss, Max Consecutive Wins, Max Consecutive Losses each have an `<ArrowUpRight>` icon button that calls `onTradeClick(trade)`.

**Render:** 10 rows × 3 columns, bordered container:
```tsx
<div className="rounded-2xl border border-white/5 bg-[#121214] p-6">
  <div className="flex items-center gap-2 mb-6">
    <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Stats</h3>
    <Info className="h-3.5 w-3.5 text-zinc-600" />
  </div>
  <div className="divide-y divide-white/5">
    {rows.map(row => (
      <div className="grid grid-cols-3 gap-4 py-3">
        {row.map(cell => (
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">{cell.label}</span>
            <div className="flex items-center gap-1">
              <span className="font-mono text-sm font-medium text-white">{cell.value}</span>
              {cell.clickTrade && (
                <button onClick={() => onTradeClick(cell.clickTrade)} className="text-emerald-500 hover:text-emerald-400">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    ))}
  </div>
</div>
```

**Empty state:** When no trades, show "Import trades to see statistics" centered.

**Design reference:** Match the screenshot — 3-column grid with labels left-aligned and values right-aligned per cell, thin dividers between rows.

**Acceptance criteria:**
- [ ] 10 rows × 3 columns render correctly
- [ ] All stat values compute without NaN or errors on empty/partial data
- [ ] Clickable arrows on Largest Gain/Loss and Max Consecutive Wins/Losses
- [ ] Empty cells in last two rows render as blank space
- [ ] Handles 0 trades gracefully (empty state)
- [ ] No `any` types
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 4: Modify DashboardTab — title, summary charts, add calendars

**Complexity:** MEDIUM | **Dependencies:** Steps 1, 2

**File:** MODIFY `components/trading/DashboardTab.tsx`

1. **Add title row with border:** Add at the top of the dashboard content:
   ```tsx
   <div className="flex items-center justify-between border-b border-white/10 pb-4">
     <h2 className="text-2xl font-bold">Dashboard</h2>
     <div><!-- move existing Net/Gross toggle here --></div>
   </div>
   ```
   Remove the standalone Net/Gross toggle div and place it inside the title row (right-aligned).

2. **Use summary variant on PerformanceCharts:** Change:
   ```tsx
   <PerformanceCharts trades={filteredTrades} metric={performanceMetric} pnlMode={pnlMode} />
   ```
   to:
   ```tsx
   <PerformanceCharts trades={filteredTrades} metric={performanceMetric} pnlMode={pnlMode} variant="summary" />
   ```

3. **Add WeeklyCalendar:** After PerformanceCharts, before Recent Trades:
   ```tsx
   <WeeklyCalendar trades={filteredTrades} />
   ```

4. **Add TradingCalendar:** After WeeklyCalendar, before Recent Trades:
   ```tsx
   <TradingCalendar trades={filteredTrades} />
   ```

5. **Add imports:**
   ```tsx
   import WeeklyCalendar from '@/components/trading/WeeklyCalendar';
   import TradingCalendar from '@/components/trading/TradingCalendar';
   ```

**Final section order in DashboardTab:**
1. Title row (Dashboard + Net/Gross toggle)
2. Stat cards (Total PnL, Win Rate, Profit Factor, etc.)
3. Equity Curve + Daily Performance (summary variant)
4. Weekly Calendar (new)
5. Monthly Calendar (moved from Performance)
6. Recent Trades table

**Acceptance criteria:**
- [ ] Dashboard has "Dashboard" title with `border-b border-white/10 pb-4`
- [ ] Net/Gross toggle is in the title row (right-aligned)
- [ ] Only Equity Curve and Daily Performance charts render
- [ ] WeeklyCalendar appears after charts
- [ ] TradingCalendar (monthly) appears after weekly calendar
- [ ] Recent Trades section still at bottom
- [ ] Stat cards unchanged
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 5: Modify PerformanceTab — remove calendar, add stats table, title border

**Complexity:** LOW | **Dependencies:** Steps 3, 8 (page.tsx prop wiring)

**File:** MODIFY `components/trading/PerformanceTab.tsx`

1. **Update title styling:** Add border to the title container:
   ```tsx
   <div className="flex items-center justify-between border-b border-white/10 pb-4">
     <h2 className="text-2xl font-bold">Performance Analytics</h2>
   ```

2. **Remove TradingCalendar:** Delete `<TradingCalendar trades={filteredTrades} />` and remove the import.

3. **Add PerformanceStatsTable:** After `<PerformanceCharts>` and before Symbol Distribution / Risk Summary grid:
   ```tsx
   <PerformanceStatsTable trades={filteredTrades} onTradeClick={onTradeClick} />
   ```

4. **Update props interface — add `onTradeClick`:**
   ```tsx
   interface PerformanceTabProps {
     filteredTrades: Trade[];
     performanceMetric: '$' | 'R';
     onMetricChange: (metric: '$' | 'R') => void;
     onTradeClick: (trade: Trade) => void;  // NEW
   }
   ```

5. **Add import:**
   ```tsx
   import PerformanceStatsTable from '@/components/trading/PerformanceStatsTable';
   ```

**Acceptance criteria:**
- [ ] TradingCalendar no longer renders in PerformanceTab
- [ ] PerformanceStatsTable renders between charts and Symbol/Risk cards
- [ ] Title has `border-b border-white/10 pb-4`
- [ ] $/R metric toggle still works
- [ ] `onTradeClick` prop wired through
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 6: Move date range filter to Toolbar

**Complexity:** LOW | **Dependencies:** None (can parallel with Steps 1-5)

**File:** MODIFY `components/trading/Toolbar.tsx`

1. **Update ToolbarProps** — add:
   ```typescript
   startDate: string;
   endDate: string;
   onStartDateChange: (value: string) => void;
   onEndDateChange: (value: string) => void;
   ```

2. **Add date range inputs** after the filter preset buttons, before the right-side controls. Add a divider then the date inputs:
   ```tsx
   <div className="mx-1 hidden h-4 w-px bg-white/10 sm:block" />
   <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
     <CalendarIcon className="h-3.5 w-3.5 text-zinc-500" />
     <input
       type="date"
       value={startDate}
       onChange={(e) => onStartDateChange(e.target.value)}
       className="bg-transparent text-[10px] text-zinc-400 focus:outline-none"
       title="Start date"
     />
     <span className="text-[10px] text-zinc-600">—</span>
     <input
       type="date"
       value={endDate}
       onChange={(e) => onEndDateChange(e.target.value)}
       className="bg-transparent text-[10px] text-zinc-400 focus:outline-none"
       title="End date"
     />
   </div>
   ```

3. **Add import:** `Calendar as CalendarIcon` from `lucide-react` (existing imports: `Plus, Trash2, User` — add `Calendar`).

4. **Mobile:** Hide date range on mobile (same pattern as storage mode label): wrap in `{!isMobile && ...}`.

**Acceptance criteria:**
- [ ] Date range inputs appear in Toolbar after filter preset buttons
- [ ] Changing dates filters trades across ALL tabs
- [ ] Hidden on mobile
- [ ] Visual style matches existing toolbar (compact, dark)
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 7: Remove date range from TradesTab

**Complexity:** LOW | **Dependencies:** Step 6

**File:** MODIFY `components/trading/TradesTab.tsx`

1. **Remove from props interface:** Delete `startDate`, `endDate`, `onStartDateChange`, `onEndDateChange`
2. **Remove from destructured props** in function signature
3. **Remove the "Date Range" grid column** — delete the entire `<div className="space-y-4">` containing "Date Range" heading and the two date inputs
4. **Simplify the grid:** Since only tag filter remains, remove the `grid grid-cols-1 md:grid-cols-2` wrapper or keep as single column
5. **Remove `Calendar as CalendarIcon` import** from lucide-react (only `X` is still used)
6. **Update title styling** — add `border-b border-white/10 pb-4` to the title's flex container:
   ```tsx
   <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
     <h2 className="text-2xl font-bold">Trades Management</h2>
   ```

**Acceptance criteria:**
- [ ] No date range inputs in TradesTab
- [ ] Tag filter section still works
- [ ] Title has bottom border separator
- [ ] No TypeScript errors from removed props
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 8: Title border for JournalTab

**Complexity:** LOW | **Dependencies:** None

**File:** MODIFY `components/trading/JournalTab.tsx`

Add `border-b border-white/10 pb-4` to the title row (line ~157):
```tsx
<div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
  <div className="flex items-center gap-4">
    <h2 className="text-2xl font-bold">Trading Journal</h2>
```

**Acceptance criteria:**
- [ ] Journal title has bottom border separator matching other tabs
- [ ] `npm run lint && npx tsc --noEmit` passes

---

### Step 9: Wire all new/removed props in page.tsx

**Complexity:** LOW | **Dependencies:** Steps 4, 5, 6, 7 (do this LAST)

**File:** MODIFY `app/page.tsx`

1. **Add date props to Toolbar:**
   ```tsx
   <Toolbar
     ...existing props...
     startDate={startDate}
     endDate={endDate}
     onStartDateChange={setStartDate}
     onEndDateChange={setEndDate}
   />
   ```

2. **Remove date props from TradesTab:** Delete `startDate`, `endDate`, `onStartDateChange`, `onEndDateChange` from the TradesTab JSX.

3. **Add onTradeClick to PerformanceTab:**
   ```tsx
   <PerformanceTab
     filteredTrades={filteredTrades}
     performanceMetric={performanceMetric}
     onMetricChange={setPerformanceMetric}
     onTradeClick={(trade) => setSelectedTradeId(trade.id)}
   />
   ```

**Acceptance criteria:**
- [ ] Toolbar receives and renders date range inputs
- [ ] TradesTab no longer receives date range props (no TS errors)
- [ ] PerformanceTab receives onTradeClick
- [ ] Date filtering works globally from Toolbar across all tabs
- [ ] `npm run lint && npx tsc --noEmit` passes

---

## Files Summary

| File | Action | Complexity |
|------|--------|------------|
| `components/trading/PerformanceCharts.tsx` | MODIFY (add variant prop) | LOW |
| `components/trading/WeeklyCalendar.tsx` | CREATE | MEDIUM |
| `components/trading/PerformanceStatsTable.tsx` | CREATE | HIGH |
| `components/trading/DashboardTab.tsx` | MODIFY (title, summary charts, calendars) | MEDIUM |
| `components/trading/PerformanceTab.tsx` | MODIFY (remove calendar, add stats, title) | LOW |
| `components/trading/Toolbar.tsx` | MODIFY (add date range) | LOW |
| `components/trading/TradesTab.tsx` | MODIFY (remove date range, title border) | LOW |
| `components/trading/JournalTab.tsx` | MODIFY (title border) | LOW |
| `app/page.tsx` | MODIFY (prop wiring) | LOW |

**No changes to:** `TradingCalendar.tsx` (just moving where it's rendered), `useTrades` hook (filter state already exists), `lib/types.ts`, any API routes, any server code.

---

## Testing Requirements

After all changes:

```bash
npm run lint && npx tsc --noEmit
```

Visual verification:
- [ ] Dashboard shows: title + Net/Gross toggle, stat cards, Equity Curve + Daily Performance ONLY, weekly calendar, monthly calendar, recent trades
- [ ] Performance shows: title with border + $/R toggle, ALL 7 charts, stats table (30 cells), Symbol Distribution, Risk Summary
- [ ] Clicking ArrowUpRight on stats opens TradeDetailSheet for that trade
- [ ] Trades tab: title with border, tag filters only (no date range), trade table
- [ ] Journal tab: title with border
- [ ] Date range in Toolbar filters ALL tabs
- [ ] Weekly calendar shows current Mon-Sun, today highlighted in emerald
- [ ] All tabs have consistent title styling with `border-b border-white/10 pb-4`
- [ ] Mobile: date range hidden in toolbar, weekly calendar readable

---

## Rollback Plan

All changes are client-side components. Revert via git:
```bash
git checkout HEAD -- components/trading/PerformanceCharts.tsx components/trading/DashboardTab.tsx components/trading/PerformanceTab.tsx components/trading/Toolbar.tsx components/trading/TradesTab.tsx components/trading/JournalTab.tsx app/page.tsx
git rm components/trading/WeeklyCalendar.tsx components/trading/PerformanceStatsTable.tsx
```
