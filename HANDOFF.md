# Build Spec — Sprint 8: Dilution Research Pack (AskEdgar Integration)

> Generated: 2026-03-10 | Agent: nexus-architect
> Status: PENDING REVIEW — do not execute until approved

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
