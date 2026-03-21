# Nexus Terminal — HANDOFF.md

## Active Handoff Only

Historical completed sections (Scanner Realtime Data Pipeline, Tech Debt PRs 1-5, SSE Phases 0-2, Keyboard Shortcuts, Discord Research Report Extraction Phases 1-4) were removed to keep this file focused.
Use git history and the `specs/` directory for archived implementation detail.

### Session Maintenance Checklist

- [x] Refreshed `AGENTS.md` with current build/lint/test commands, single-test workflows, and coding conventions for agentic coding tools.
- [x] Verified command set and conventions against the current repository configuration (`package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.mjs`).
- [ ] Update `AGENTS.md` after Discord import feature ships — document new tables, API routes, parser module, env vars
- [x] Update `AGENTS.md` after relay WebSocket feature ships — document new relay WS endpoint, `use-relay-socket` hook, `/api/relay-token` route

---

## Schwab Relay Auth — Parallel Blocker

> Generated: 2026-03-16 | Status: OPEN

- Relay logs show repeated `Failed to load Schwab user preference (401)`.
- This keeps `realtime_quotes` stale or empty, which directly degrades Scanner results.
- Schwab refresh tokens expire every **7 days** — you need to re-login via the Schwab OAuth flow weekly.

### Next steps

1. Re-link Schwab account in the app (Markets tab → Schwab status)
2. After relinking, check Fly logs for `LOGIN successful, subscribing...` and quote-write activity
3. If 401 persists after fresh relink, investigate whether the relay is loading the correct tokens from the DB

---

## SSE Jarvis Streaming — Manual QA Remaining

> Generated: 2026-03-17 | Status: CODE COMPLETE — awaiting Jared manual QA

All code shipped (Phases 0-3). Lint, type-check, and tests pass. Manual QA items remaining:

- [ ] Send a chat message to Jarvis — tokens appear one by one
- [ ] Blinking cursor shows during streaming
- [ ] Send `/research AAPL` — works as before (non-streaming, full response)
- [ ] Send `/analyze` — works as before (non-streaming, full response)
- [ ] Close the tab mid-stream — no console errors on server
- [ ] Send rapid messages — each streams correctly

---

## Discord Research Report Extraction — Manual Schwab Validation

> Generated: 2026-03-17 | Status: CODE COMPLETE — manual Schwab validation pending

All 4 phases implemented and passing lint/type-check/tests. Remaining manual checks (after Schwab re-link):

- [ ] Relay startup logs show `subscribed N imported research tickers`
- [ ] Imported tickers appear in `realtime_quotes` table after relay runs for a few minutes
- [ ] Scanner shows imported tickers with quote data

---

## Research Tab Full Redesign — Dilution Research Terminal

> Generated: 2026-03-21 | Agent: claude-plan + nexus-architect
> Status: IN PROGRESS — CODE COMPLETE, manual visual QA pending
> Priority: HIGH — replaces $200/mo third-party report, surfaces orphaned Discord data
> Supersedes: "Custom Dilution Research Report" (see git history)

### Execution Status

- [x] Phase 1 backend foundation implemented (schema, parser, AskEdgar routes, historical summary, Discord sync wiring, TLDR route)
- [x] Phase 2 frontend redesign implemented (full-page layout + gainers + ticker view + chart + header + tabs + TLDR)
- [x] Phase 3 integration completed (`app/page.tsx` full-width treatment + lint/type-check/tests pass)
- [x] Pre-commit validation run (lint, type-check, tests, build all pass)
- [ ] Migration hygiene warning remains (`0003` duplicate prefix and missing `0002` in legacy Drizzle sequence)
- [ ] Dependency audit advisories remain (1 high, 5 moderate) and need a separate safe upgrade pass
- [ ] Manual visual QA checklist completed

### Goal

Redesign the Research tab from a simple two-view layout into a full-page dilution research terminal. Left panel shows top gainers from Ask Edgar. Clicking a ticker loads a chart, company info header with risk badges, tabbed report sections from live Ask Edgar API data (~2s, no LLM), and a Jarvis TLDR at the bottom. Discord-imported reports feed pre-computed historical summaries that enrich the TLDR with how a ticker's risk profile has evolved over time.

### Architecture Decisions (approved)

1. Top gainers from Ask Edgar `/v1/screener` with `min_gain_1_day` filter
2. Charts reuse `lightweight-charts` pattern from Charts tab with timeframe selector
3. Historical analysis via pre-computed summaries, updated on each Discord import
4. Enhanced parser extracts all ~15 sections from Discord reports into structured JSON
5. Full-page layout (same CSS treatment as Charts tab: `px-3 py-4` instead of `max-w-7xl`)
6. Jarvis TLDR at bottom uses live Ask Edgar data + historical summary — LLM only for TLDR
7. Direct Ask Edgar API route — no LLM for data display

### Workflow for opencode

**Execute phases in order: 1 → 2 → 3.**
After EVERY file change: `npm run lint && npx tsc --noEmit`
After Phase 1 schema change: `npm run db:generate && npm run db:migrate`

---

### Phase 1: Backend Foundation

> Risk: LOW-MEDIUM | Estimated changes: 6 new files, 4 modified files

#### Step 1.1: Add `tickerResearchSummaries` table

**File:** `lib/db/schema.ts`
**Action:** MODIFY

After the `importedResearchReports` table definition (after line 152, before the `dailyTickerSummaries` table), add:

```typescript
export const tickerResearchSummaries = pgTable('ticker_research_summaries', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  reportCount: integer('report_count').notNull().default(0),
  latestReportDate: timestamp('latest_report_date', { withTimezone: true }),
  historicalSummary: jsonb('historical_summary'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique().on(table.userId, table.ticker),
  index('ticker_research_summaries_user_idx').on(table.userId),
]);
```

The `historicalSummary` JSONB stores:
```typescript
{
  changes: Array<{ date: string; field: string; from: string | null; to: string | null; description: string }>;
  riskTimeline: Array<{ date: string; dilutionRisk: string | null; offeringRisk: string | null; scamRisk: string | null; cashBurnRisk: string | null }>;
  keyEvents: Array<{ date: string; event: string }>;
}
```

Then run:
```bash
npm run db:generate && npm run db:migrate
npm run lint && npx tsc --noEmit
```

**Acceptance criteria:**
- [ ] Migration generates and applies without errors
- [ ] `tickerResearchSummaries` is exported from schema.ts
- [ ] Table has unique constraint on (userId, ticker)
- [ ] Lint and type-check pass

#### Step 1.2: Enhanced Discord parser

**File:** `lib/discord/parser.ts`
**Action:** MODIFY

**1. Add new interfaces after the existing `ParseResult` interface (after line 22):**

```typescript
/** A named section from a Discord research report with optional risk level */
export interface ParsedReportSection {
  title: string;
  risk: 'high' | 'medium' | 'low' | null;
  content: string;
  bullets: string[];
}

/** Structured historical stats from the report footer */
export interface ParsedReportStats {
  prArticles: number | null;
  prMonths: number | null;
  prPerMonth: number | null;
  move20PctCount: number | null;
  move20PctPct: number | null;
  move50PctCount: number | null;
  move50PctPct: number | null;
  gapCount: number | null;
  gapRange: string | null;
  gapMedian: number | null;
  gapMean: number | null;
  openToHigh: number | null;
  openToLow: number | null;
  openToClose: number | null;
  fadeRate: number | null;
  closeBelowVwap: number | null;
  nhodAfter11am: number | null;
  brokePmh: number | null;
}

/** Full parsed report with all narrative sections — extends ParsedReportData for backward compat */
export interface ParsedReportFull extends ParsedReportData {
  newsWhyRunning: ParsedReportSection | null;
  theme: ParsedReportSection | null;
  otherCatalysts: ParsedReportSection | null;
  chartHistory: ParsedReportSection | null;
  dilutionDetails: ParsedReportSection | null;
  offeringFrequency: ParsedReportSection | null;
  offeringAbility: ParsedReportSection | null;
  cashNeedDetails: ParsedReportSection | null;
  managementCommentary: string | null;
  overallOfferingRisk: ParsedReportSection | null;
  jmt415Commentary: string | null;
  historicalStats: ParsedReportStats | null;
  dataSources: string[];
}
```

**2. Add section parsing helpers after the existing `parseRiskLevel` function (after line 50):**

```typescript
/** Known section headers in Discord research reports, in typical order */
const SECTION_MARKERS: Array<{ key: keyof Omit<ParsedReportFull, keyof ParsedReportData>; pattern: RegExp }> = [
  { key: 'newsWhyRunning', pattern: /^[\s*]*News\s*\/?\s*Why/im },
  { key: 'theme', pattern: /^[\s*]*Theme/im },
  { key: 'otherCatalysts', pattern: /^[\s*]*Other\s*Catalysts/im },
  { key: 'chartHistory', pattern: /^[\s*]*Chart\s*History/im },
  { key: 'dilutionDetails', pattern: /^[\s*]*Dilution(?!\s*Rating)/im },
  { key: 'offeringFrequency', pattern: /^[\s*]*Offering\s*Frequency/im },
  { key: 'offeringAbility', pattern: /^[\s*]*Offering\s*Ability/im },
  { key: 'cashNeedDetails', pattern: /^[\s*]*Cash\s*Need/im },
  { key: 'managementCommentary', pattern: /^[\s*]*(?:Commentary|Management\s*Commentary|Commentary\s*on)/im },
  { key: 'overallOfferingRisk', pattern: /^[\s*]*Overall\s*Offering\s*Risk/im },
  { key: 'jmt415Commentary', pattern: /^[\s*]*Jmt415/im },
  { key: 'historicalStats', pattern: /^[\s*]*Historical\s*Stats/im },
];

const DATA_SOURCES_REGEX = /Data\s*Sources:\s*\n((?:.*(?:Fundamental|Chart|Market|Technical|Sentiment).*\n?)+)/im;
const BULLET_REGEX = /^[\s]*[•\-\u2022\u2023\u25E6\u2043*]\s*/;

function parseSection(text: string): ParsedReportSection {
  const lines = text.split('\n');
  const titleLine = lines[0] ?? '';
  // Extract risk from emoji on title line
  let risk: 'high' | 'medium' | 'low' | null = null;
  if (titleLine.includes('\uD83D\uDD34') || titleLine.includes(':red_circle:')) risk = 'high';
  else if (titleLine.includes('\uD83D\uDFE1') || titleLine.includes(':yellow_circle:') || titleLine.includes('\uD83D\uDFE0')) risk = 'medium';
  else if (titleLine.includes('\uD83D\uDFE2') || titleLine.includes(':green_circle:')) risk = 'low';
  // Fallback: check for text keywords
  if (!risk) {
    const upper = titleLine.toUpperCase();
    if (upper.includes('HIGH')) risk = 'high';
    else if (upper.includes('MEDIUM') || upper.includes('MODERATE')) risk = 'medium';
    else if (upper.includes('LOW') || upper.includes('MINIMAL')) risk = 'low';
  }

  const contentLines = lines.slice(1).filter((l) => l.trim().length > 0);
  const bullets: string[] = [];
  const nonBulletLines: string[] = [];

  for (const line of contentLines) {
    if (BULLET_REGEX.test(line)) {
      bullets.push(line.replace(BULLET_REGEX, '').trim());
    } else {
      nonBulletLines.push(line.trim());
    }
  }

  // Clean title: remove markdown bold markers and emoji
  const title = titleLine.replace(/\*\*/g, '').replace(/[\u{1F534}\u{1F7E1}\u{1F7E0}\u{1F7E2}]/gu, '').trim();

  return {
    title,
    risk,
    content: nonBulletLines.join('\n').trim(),
    bullets,
  };
}

function parseHistoricalStats(text: string): ParsedReportStats {
  const num = (regex: RegExp, group = 1): number | null => {
    const m = text.match(regex);
    if (!m || !m[group]) return null;
    const val = parseFloat(m[group].replace(/,/g, ''));
    return Number.isFinite(val) ? val : null;
  };
  const str = (regex: RegExp, group = 1): string | null => {
    const m = text.match(regex);
    return m?.[group]?.trim() ?? null;
  };

  return {
    prArticles: num(/PR\s*History:\s*(\d+)\s*articles/i),
    prMonths: num(/PR\s*History:\s*\d+\s*articles\s*\/\s*(\d+)\s*months/i),
    prPerMonth: num(/PR\s*History:\s*\d+\s*articles\s*\/\s*\d+\s*months\s*\(([\d.]+)\/mo\)/i),
    move20PctCount: num(/20%\+\s*move\s*after\s*PR:\s*(\d+)/i),
    move20PctPct: num(/20%\+\s*move\s*after\s*PR:\s*\d+\s*\(([\d.]+)%?\)/i),
    move50PctCount: num(/50%\+\s*move\s*after\s*PR:\s*(\d+)/i),
    move50PctPct: num(/50%\+\s*move\s*after\s*PR:\s*\d+\s*\(([\d.]+)%?\)/i),
    gapCount: num(/Gap\s*History:\s*(\d+)\s*gaps/i),
    gapRange: str(/Range:\s*([\d.]+%\s*-\s*[\d.]+%)/i),
    gapMedian: num(/Median:\s*([\d.]+)%/i),
    gapMean: num(/Mean:\s*([\d.]+)%/i),
    openToHigh: num(/Open.{1,3}High:\s*([+-]?[\d.]+)%/i),
    openToLow: num(/Open.{1,3}Low:\s*([+-]?[\d.]+)%/i),
    openToClose: num(/Open.{1,3}Close:\s*([+-]?[\d.]+)%/i),
    fadeRate: num(/Fade\s*\(close\s*<\s*open\):\s*([\d.]+)%/i),
    closeBelowVwap: num(/Close\s*<\s*VWAP:\s*([\d.]+)%/i),
    nhodAfter11am: num(/NHOD\s*after\s*11am:\s*([\d.]+)%/i),
    brokePmh: num(/Broke\s*PMH:\s*([\d.]+)%/i),
  };
}

function parseSections(text: string): Partial<ParsedReportFull> {
  const result: Partial<ParsedReportFull> = {};
  // Find all section start positions
  const sectionPositions: Array<{ key: string; index: number }> = [];
  for (const marker of SECTION_MARKERS) {
    const match = text.match(marker.pattern);
    if (match?.index !== undefined) {
      sectionPositions.push({ key: marker.key, index: match.index });
    }
  }
  // Sort by position in text
  sectionPositions.sort((a, b) => a.index - b.index);

  for (let i = 0; i < sectionPositions.length; i++) {
    const start = sectionPositions[i].index;
    const end = i + 1 < sectionPositions.length ? sectionPositions[i + 1].index : text.length;
    const sectionText = text.slice(start, end).trim();
    const key = sectionPositions[i].key;

    if (key === 'managementCommentary' || key === 'jmt415Commentary') {
      // Plain text sections (no risk badge)
      const lines = sectionText.split('\n').slice(1).filter((l) => l.trim().length > 0);
      (result as Record<string, unknown>)[key] = lines.join('\n').trim() || null;
    } else if (key === 'historicalStats') {
      result.historicalStats = parseHistoricalStats(sectionText);
    } else {
      (result as Record<string, unknown>)[key] = parseSection(sectionText);
    }
  }

  // Parse data sources
  const dsMatch = text.match(DATA_SOURCES_REGEX);
  if (dsMatch) {
    result.dataSources = dsMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[\s✅✓☑]*/, '').trim())
      .filter((l) => l.length > 0);
  } else {
    result.dataSources = [];
  }

  return result;
}
```

**3. Update `parseReport()` to return `ParsedReportFull`:**

Change the return type of `parseReport` from `ParseResult` to `{ isReport: boolean; data: ParsedReportFull | null }`. The function body currently builds a `ParsedReportData` object — after building it, spread the section parsing on top:

Replace the existing `parseReport` function body (lines 59-93) so it builds `ParsedReportFull`:

```typescript
export function parseReport(messageContent: string): { isReport: boolean; data: ParsedReportFull | null } {
  const tickerMatch = messageContent.match(TICKER_REGEX);
  if (!tickerMatch) {
    return { isReport: false, data: null };
  }

  const ticker = tickerMatch[1].toUpperCase();
  const priceMatch = messageContent.match(PRICE_REGEX);
  const marketCapMatch = messageContent.match(MARKET_CAP_REGEX);
  const floatOsMatch = messageContent.match(FLOAT_OS_REGEX);
  const floatMatch = messageContent.match(FLOAT_REGEX);
  const osMatch = messageContent.match(OS_REGEX);
  const industryMatch = messageContent.match(INDUSTRY_REGEX);
  const gainMatch = messageContent.match(GAIN_REGEX);

  const dilutionRisk = parseRiskLevel(messageContent, 'dilution');
  const offeringRisk = parseRiskLevel(messageContent, 'offering');
  const scamRisk = parseRiskLevel(messageContent, 'scam');
  const cashBurnRisk = parseRiskLevel(messageContent, 'cash');

  const sections = parseSections(messageContent);

  const data: ParsedReportFull = {
    ticker,
    price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null,
    marketCap: marketCapMatch ? marketCapMatch[1].trim() : null,
    floatShares: floatOsMatch ? floatOsMatch[1].trim() : floatMatch ? floatMatch[1].trim() : null,
    outstandingShares: floatOsMatch ? floatOsMatch[2].trim() : osMatch ? osMatch[1].trim() : null,
    industry: industryMatch ? industryMatch[1].trim() : null,
    gainPercent: gainMatch ? parseFloat(gainMatch[1].replace(/,/g, '')) : null,
    dilutionRisk,
    offeringRisk,
    scamRisk,
    cashBurnRisk,
    newsWhyRunning: (sections.newsWhyRunning as ParsedReportSection) ?? null,
    theme: (sections.theme as ParsedReportSection) ?? null,
    otherCatalysts: (sections.otherCatalysts as ParsedReportSection) ?? null,
    chartHistory: (sections.chartHistory as ParsedReportSection) ?? null,
    dilutionDetails: (sections.dilutionDetails as ParsedReportSection) ?? null,
    offeringFrequency: (sections.offeringFrequency as ParsedReportSection) ?? null,
    offeringAbility: (sections.offeringAbility as ParsedReportSection) ?? null,
    cashNeedDetails: (sections.cashNeedDetails as ParsedReportSection) ?? null,
    managementCommentary: (sections.managementCommentary as string) ?? null,
    overallOfferingRisk: (sections.overallOfferingRisk as ParsedReportSection) ?? null,
    jmt415Commentary: (sections.jmt415Commentary as string) ?? null,
    historicalStats: sections.historicalStats ?? null,
    dataSources: sections.dataSources ?? [],
  };

  return { isReport: true, data };
}
```

**4. Update `ParseResult` interface** to use `ParsedReportFull`:

```typescript
export interface ParseResult {
  isReport: boolean;
  data: ParsedReportFull | null;
}
```

**5. Update `parseMessages()` return type** — change `ParsedReportData` to `ParsedReportFull` in the return type and internal array type (line 96-116). The function body should work without changes since `ParsedReportFull` extends `ParsedReportData`.

**Acceptance criteria:**
- [ ] All new interfaces are exported
- [ ] `parseReport()` returns `ParsedReportFull` with all sections populated when present
- [ ] `parseMessages()` returns `ParsedReportFull` in results
- [ ] Existing tests in `__tests__/` still pass (run `npm run test`)
- [ ] Lint and type-check pass

#### Step 1.3: Add `fetchTopGainers` to Ask Edgar client

**File:** `lib/jarvis/askedgar.ts`
**Action:** MODIFY

Add before the closing of the file (before line 307, after the `getAskEdgarDailyLimit` function):

```typescript
export async function fetchTopGainers(minGainPct = 20, limit = 25) {
  return requestAskEdgar<unknown>('/v1/screener', {
    min_gain_1_day: minGainPct,
    isactivelytrading: true,
    limit,
  });
}
```

**Acceptance criteria:**
- [ ] `fetchTopGainers` is exported
- [ ] Lint and type-check pass

#### Step 1.4: Direct Ask Edgar lookup API route

**File:** `app/api/askedgar/lookup/route.ts`
**Action:** CREATE

```typescript
import { fetchTickerData } from '@/lib/jarvis/askedgar';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

const TICKER_REGEX = /^[A-Z0-9.\-^]{1,10}$/;

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker')?.trim().toUpperCase();

  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return Response.json({ error: 'Valid ticker parameter required' }, { status: 400 });
  }

  try {
    const result = await fetchTickerData(ticker);
    return Response.json(result);
  } catch (error) {
    console.error('[askedgar-lookup]', error);
    return Response.json({ error: 'Ask Edgar lookup failed' }, { status: 500 });
  }
}
```

**Acceptance criteria:**
- [ ] `GET /api/askedgar/lookup?ticker=AAPL` returns Ask Edgar data (13 endpoints)
- [ ] Returns 401 without auth
- [ ] Returns 400 for missing/invalid ticker
- [ ] Lint and type-check pass

#### Step 1.5: Top gainers API route

**File:** `app/api/askedgar/gainers/route.ts`
**Action:** CREATE

```typescript
import { fetchTopGainers } from '@/lib/jarvis/askedgar';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

// Simple in-memory cache: { data, expiry }
let cache: { data: unknown; expiry: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const url = new URL(request.url);
  const minGain = Number(url.searchParams.get('min_gain') ?? '20');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '25'), 50);

  // Return cached data if fresh
  if (cache && Date.now() < cache.expiry) {
    return Response.json(cache.data);
  }

  try {
    const result = await fetchTopGainers(
      Number.isFinite(minGain) && minGain > 0 ? minGain : 20,
      limit,
    );

    const responseData = {
      gainers: result.results,
      count: result.count,
      fetchedAt: new Date().toISOString(),
    };

    cache = { data: responseData, expiry: Date.now() + CACHE_TTL_MS };

    return Response.json(responseData);
  } catch (error) {
    console.error('[askedgar-gainers]', error);
    return Response.json({ error: 'Failed to fetch gainers' }, { status: 500 });
  }
}
```

**Acceptance criteria:**
- [ ] `GET /api/askedgar/gainers` returns screener results
- [ ] Cached for 5 minutes (second call within 5min doesn't hit Ask Edgar API)
- [ ] `?min_gain=30&limit=10` params work
- [ ] Returns 401 without auth
- [ ] Lint and type-check pass

#### Step 1.6: Historical summary computation

**File:** `lib/jarvis/historical-summary.ts`
**Action:** CREATE

```typescript
import { getDb } from '@/lib/db';
import { importedResearchReports, tickerResearchSummaries } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { ParsedReportFull } from '@/lib/discord/parser';

export interface HistoricalChange {
  date: string;
  field: string;
  from: string | null;
  to: string | null;
  description: string;
}

export interface RiskSnapshot {
  date: string;
  dilutionRisk: string | null;
  offeringRisk: string | null;
  scamRisk: string | null;
  cashBurnRisk: string | null;
}

export interface HistoricalSummaryData {
  changes: HistoricalChange[];
  riskTimeline: RiskSnapshot[];
  keyEvents: Array<{ date: string; event: string }>;
}

const RISK_FIELDS = ['dilutionRisk', 'offeringRisk', 'scamRisk', 'cashBurnRisk'] as const;

function isFullReport(json: unknown): json is ParsedReportFull {
  return typeof json === 'object' && json !== null && 'ticker' in json;
}

/**
 * Compare two reports and return what changed.
 * Pure function — no DB or LLM calls.
 */
export function computeHistoricalSummary(
  newReport: ParsedReportFull,
  previousReports: Array<{ reportDate: string; parsedJson: unknown }>,
): HistoricalSummaryData {
  const changes: HistoricalChange[] = [];
  const riskTimeline: RiskSnapshot[] = [];
  const keyEvents: Array<{ date: string; event: string }> = [];

  // Build risk timeline from all previous reports
  for (const prev of previousReports) {
    if (!isFullReport(prev.parsedJson)) continue;
    riskTimeline.push({
      date: prev.reportDate,
      dilutionRisk: prev.parsedJson.dilutionRisk,
      offeringRisk: prev.parsedJson.offeringRisk,
      scamRisk: prev.parsedJson.scamRisk,
      cashBurnRisk: prev.parsedJson.cashBurnRisk,
    });
  }

  // Compare new report to the most recent previous report
  const lastPrev = previousReports.length > 0 ? previousReports[0] : null;
  if (lastPrev && isFullReport(lastPrev.parsedJson)) {
    const prev = lastPrev.parsedJson;
    for (const field of RISK_FIELDS) {
      const oldVal = prev[field];
      const newVal = newReport[field];
      if (oldVal !== newVal && (oldVal || newVal)) {
        changes.push({
          date: new Date().toISOString(),
          field,
          from: oldVal,
          to: newVal,
          description: `${field} changed from ${oldVal ?? 'unknown'} to ${newVal ?? 'unknown'}`,
        });
      }
    }

    // Detect key events from section content changes
    if (newReport.newsWhyRunning?.content && newReport.newsWhyRunning.content !== prev.newsWhyRunning?.content) {
      keyEvents.push({ date: new Date().toISOString(), event: `New catalyst: ${newReport.newsWhyRunning.content.slice(0, 100)}` });
    }
  }

  return { changes, riskTimeline, keyEvents };
}

/**
 * Update the pre-computed historical summary for a ticker.
 * Call this after each successful Discord report import.
 */
export async function updateTickerSummary(
  userId: string,
  ticker: string,
): Promise<void> {
  const db = getDb();
  if (!db) return;

  // Fetch all reports for this ticker, newest first
  const reports = await db.select({
    reportDate: importedResearchReports.reportDate,
    parsedJson: importedResearchReports.parsedJson,
  })
    .from(importedResearchReports)
    .where(and(
      eq(importedResearchReports.userId, userId),
      eq(importedResearchReports.ticker, ticker),
    ))
    .orderBy(desc(importedResearchReports.reportDate))
    .limit(50);

  if (reports.length === 0) return;

  const latest = reports[0];
  if (!isFullReport(latest.parsedJson)) return;

  const previousReports = reports.slice(1).map((r) => ({
    reportDate: r.reportDate.toISOString(),
    parsedJson: r.parsedJson,
  }));

  const summary = computeHistoricalSummary(latest.parsedJson, previousReports);

  // Upsert into ticker_research_summaries
  await db.insert(tickerResearchSummaries).values({
    id: crypto.randomUUID(),
    userId,
    ticker,
    reportCount: reports.length,
    latestReportDate: latest.reportDate,
    historicalSummary: summary,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [tickerResearchSummaries.userId, tickerResearchSummaries.ticker],
    set: {
      reportCount: reports.length,
      latestReportDate: latest.reportDate,
      historicalSummary: summary,
      updatedAt: new Date(),
    },
  });
}
```

**Note:** The `onConflictDoUpdate` target uses the unique constraint columns `(userId, ticker)`. If Drizzle requires the unique constraint name instead, use: `.onConflictDoUpdate({ target: tickerResearchSummaries.id, ... })` with a raw SQL upsert. Test and adjust.

**Acceptance criteria:**
- [ ] `computeHistoricalSummary` returns changes, riskTimeline, keyEvents
- [ ] `updateTickerSummary` reads from `imported_research_reports` and upserts into `ticker_research_summaries`
- [ ] Lint and type-check pass

#### Step 1.7: Wire Discord import routes to historical summaries

**File:** `app/api/discord/import/route.ts`
**Action:** MODIFY

Add import at the top:
```typescript
import { updateTickerSummary } from '@/lib/jarvis/historical-summary';
```

After the for loop that inserts reports (after the existing `for (const report of parsed)` loop, around line 68, before the `return Response.json({` line), add:

```typescript
    // Compute historical summaries for each affected ticker
    for (const t of tickers) {
      try {
        await updateTickerSummary(userId, t);
      } catch (err) {
        console.error(`[discord-import] Failed to update summary for ${t}:`, err);
      }
    }
```

**File:** `app/api/discord/sync/route.ts`
**Action:** MODIFY

Same pattern — add the import and call `updateTickerSummary` after each successful insert loop. Read the sync route first to find the exact insertion point (it follows the same pattern as the import route).

**Acceptance criteria:**
- [ ] `POST /api/discord/import` updates `ticker_research_summaries` for each imported ticker
- [ ] `POST /api/discord/sync` updates `ticker_research_summaries` for each synced ticker
- [ ] Errors in summary computation don't block the import
- [ ] Lint and type-check pass

#### Step 1.8: TLDR generation endpoint

**File:** `app/api/askedgar/tldr/route.ts`
**Action:** CREATE

```typescript
import { getDb } from '@/lib/db';
import { importedResearchReports, tickerResearchSummaries } from '@/lib/db/schema';
import { fetchTickerData } from '@/lib/jarvis/askedgar';
import { callJarvis } from '@/lib/jarvis/client';
import { requireUser } from '@/lib/server-db-utils';
import { and, desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TICKER_REGEX = /^[A-Z0-9.\-^]{1,10}$/;

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return Response.json({ error: 'Database not configured' }, { status: 503 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const ticker = String(body.ticker ?? '').trim().toUpperCase();

  if (!ticker || !TICKER_REGEX.test(ticker)) {
    return Response.json({ error: 'Valid ticker required' }, { status: 400 });
  }

  try {
    // Fetch live Ask Edgar data, historical summary, and latest Discord report in parallel
    const [askEdgarData, summaryRows, discordRows] = await Promise.all([
      fetchTickerData(ticker),
      db.select().from(tickerResearchSummaries)
        .where(and(eq(tickerResearchSummaries.userId, authState.user.id), eq(tickerResearchSummaries.ticker, ticker)))
        .limit(1),
      db.select({ rawText: importedResearchReports.rawText, reportDate: importedResearchReports.reportDate })
        .from(importedResearchReports)
        .where(and(eq(importedResearchReports.userId, authState.user.id), eq(importedResearchReports.ticker, ticker)))
        .orderBy(desc(importedResearchReports.reportDate))
        .limit(1),
    ]);

    const historicalSummary = summaryRows[0]?.historicalSummary ?? null;
    const latestDiscordReport = discordRows[0] ?? null;

    // Trim Ask Edgar data to save tokens — only first result from each endpoint
    const trimmedData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(askEdgarData.rawData)) {
      const endpoint = value as { results?: unknown[] };
      if (Array.isArray(endpoint.results) && endpoint.results.length > 0) {
        trimmedData[key] = endpoint.results.slice(0, 2);
      }
    }

    const systemPrompt = `You are a financial analyst specializing in small-cap dilution risk assessment. Given SEC filing data and historical context, produce a concise research TLDR. Return ONLY valid JSON with this structure:
{
  "tldr": "2-3 sentence summary of current dilution/offering risk state",
  "findings": ["key data point 1", "key data point 2", ...],
  "actionSteps": ["what to watch for 1", "what to watch for 2", ...],
  "risks": ["main risk 1", "main risk 2", ...],
  "historicalContext": "1-2 sentences on how the risk profile has evolved, or null if no history"
}
Never fabricate data. Use null for missing values. Be direct and actionable.`;

    const userPrompt = [
      `Ticker: ${ticker}`,
      `\nAsk Edgar Data:\n${JSON.stringify(trimmedData, null, 1)}`,
      historicalSummary ? `\nHistorical Summary:\n${JSON.stringify(historicalSummary, null, 1)}` : '',
      latestDiscordReport ? `\nLatest Discord Report (${latestDiscordReport.reportDate.toISOString().slice(0, 10)}):\n${latestDiscordReport.rawText.slice(0, 2000)}` : '',
    ].filter(Boolean).join('\n');

    const llmResponse = await callJarvis(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { responseFormat: 'json' },
    );

    const parsed = JSON.parse(llmResponse.content);

    return Response.json({
      ticker,
      ...parsed,
      generatedAt: new Date().toISOString(),
      hasHistoricalData: historicalSummary !== null,
    });
  } catch (error) {
    console.error('[askedgar-tldr]', error);
    return Response.json({ error: 'TLDR generation failed' }, { status: 500 });
  }
}
```

**Important:** The `callJarvis` import and signature may need adjustment — read `lib/jarvis/client.ts` to confirm the exact function signature. It may take `(messages, options)` or `(prompt, systemPrompt)`. Adapt the call accordingly.

**Acceptance criteria:**
- [ ] `POST /api/askedgar/tldr` with `{ "ticker": "AAPL" }` returns structured TLDR
- [ ] Response includes `tldr`, `findings`, `actionSteps`, `risks`, `historicalContext`
- [ ] Works with and without historical data in the DB
- [ ] Returns 401 without auth
- [ ] Lint and type-check pass

---

### Phase 2: Frontend — Full-Page Research Layout

> Risk: MEDIUM | Estimated changes: 6 new component files, 2 modified files

#### Step 2.1: Research page layout — complete rewrite

**File:** `components/trading/ResearchTab.tsx`
**Action:** REWRITE (delete all existing content, replace entirely)

This becomes the full-page layout container. Layout structure:

```
┌──────────────────────────────────────────────────────────┐
│  [ticker search input]                                    │
├───────────────┬──────────────────────────────────────────┤
│ Top Gainers   │  ResearchChart (40% height)              │
│ (scrollable)  │  [1m][5m][15m][30m][1h][1D]             │
│               ├──────────────────────────────────────────┤
│ AZTR +68%     │  ResearchCompanyHeader                   │
│ JDZG +34%     ├──────────────────────────────────────────┤
│ DRMA +27%     │  ResearchReportSections (tabbed)         │
│ ...           │  [Overview][Dilution][Offerings][News]   │
│               ├──────────────────────────────────────────┤
│               │  ResearchTldr                            │
│               │  [Generate TLDR]                         │
└───────────────┴──────────────────────────────────────────┘
```

```typescript
'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import ResearchGainersList from '@/components/trading/ResearchGainersList';
import ResearchTickerView from '@/components/trading/ResearchTickerView';

export default function ResearchTab() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerInput, setTickerInput] = useState('');

  const handleTickerSubmit = () => {
    const t = tickerInput.trim().toUpperCase();
    if (t) {
      setSelectedTicker(t);
      setTickerInput('');
    }
  };

  return (
    <motion.section
      key="research"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex h-[calc(100vh-80px)] flex-col gap-2"
    >
      {/* Top bar: ticker search */}
      <div className="flex items-center gap-2 px-1">
        <input
          value={tickerInput}
          onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleTickerSubmit()}
          placeholder="Search ticker..."
          className="w-48 rounded-lg border border-white/10 bg-[#121214] px-3 py-1.5 text-sm text-zinc-200 transition-colors focus:border-emerald-500/50 focus:outline-none"
        />
        <span className="text-xs text-zinc-500">
          {selectedTicker ? `Viewing: ${selectedTicker}` : 'Select a gainer or search a ticker'}
        </span>
      </div>

      {/* Main layout: left panel + right panel */}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* Left panel: Top Gainers */}
        <div className="w-56 shrink-0 overflow-y-auto rounded-lg border border-white/10 bg-[#121214]">
          <ResearchGainersList
            selectedTicker={selectedTicker}
            onSelectTicker={setSelectedTicker}
          />
        </div>

        {/* Right panel: Ticker view */}
        <div className="min-w-0 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-[#121214]">
          {selectedTicker ? (
            <ResearchTickerView ticker={selectedTicker} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Select a ticker from the gainers list or search above
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
```

**Acceptance criteria:**
- [ ] Full-page layout renders with left/right panels
- [ ] Ticker search input works (Enter key sets selected ticker)
- [ ] Clicking a gainer sets selected ticker
- [ ] Right panel shows ticker view or empty state
- [ ] Lint and type-check pass

#### Step 2.2: Top Gainers List

**File:** `components/trading/ResearchGainersList.tsx`
**Action:** CREATE

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';

interface GainerRow {
  ticker: string;
  price: number;
  gain_1_day: number;
  market_cap: number;
  float: number;
  today_volume: number;
  [key: string]: unknown;
}

interface Props {
  selectedTicker: string | null;
  onSelectTicker: (ticker: string) => void;
}

function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export default function ResearchGainersList({ selectedTicker, onSelectTicker }: Props) {
  const [gainers, setGainers] = useState<GainerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGainers = useCallback(async () => {
    try {
      const res = await fetch('/api/askedgar/gainers');
      if (!res.ok) return;
      const data = await res.json() as { gainers: GainerRow[] };
      setGainers(data.gainers ?? []);
    } catch {
      // Silently fail — list will be empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGainers();
    const interval = setInterval(() => void fetchGainers(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchGainers]);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 border-b border-white/10 bg-[#121214] px-3 py-2">
        <h3 className="text-xs font-medium text-zinc-400">Top Gainers</h3>
      </div>

      {loading ? (
        <p className="px-3 py-4 text-xs text-zinc-500">Loading gainers...</p>
      ) : gainers.length === 0 ? (
        <p className="px-3 py-4 text-xs text-zinc-500">No gainers found</p>
      ) : (
        <div className="flex flex-col">
          {gainers.map((g) => (
            <button
              key={g.ticker}
              type="button"
              onClick={() => onSelectTicker(g.ticker)}
              className={`flex items-center justify-between border-b border-white/5 px-3 py-2 text-left text-xs transition-colors hover:bg-white/5 ${
                selectedTicker === g.ticker ? 'border-l-2 border-l-emerald-500 bg-emerald-500/5' : ''
              }`}
            >
              <div>
                <span className="font-medium text-zinc-200">{g.ticker}</span>
                <span className="ml-2 text-zinc-500">${g.price?.toFixed(2) ?? '--'}</span>
              </div>
              <div className="text-right">
                <span className="text-emerald-400">+{g.gain_1_day?.toFixed(0) ?? '0'}%</span>
                <span className="ml-2 text-zinc-500">{formatCompact(g.today_volume)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Acceptance criteria:**
- [ ] Fetches from `/api/askedgar/gainers` on mount
- [ ] Auto-refreshes every 5 minutes
- [ ] Each row shows ticker, price, gain%, volume
- [ ] Clicking a row calls `onSelectTicker`
- [ ] Selected row has emerald left border highlight
- [ ] Lint and type-check pass

#### Step 2.3: Ticker View container

**File:** `components/trading/ResearchTickerView.tsx`
**Action:** CREATE

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import ResearchChart from '@/components/trading/ResearchChart';
import ResearchCompanyHeader from '@/components/trading/ResearchCompanyHeader';
import ResearchReportSections from '@/components/trading/ResearchReportSections';
import ResearchTldr from '@/components/trading/ResearchTldr';

interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

interface AskEdgarLookupData {
  ticker: string;
  fetchedAt: string;
  rawData: Record<string, AskEdgarEndpointResponse>;
  warnings: string[];
}

interface Props {
  ticker: string;
}

export default function ResearchTickerView({ ticker }: Props) {
  const [data, setData] = useState<AskEdgarLookupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/askedgar/lookup?ticker=${encodeURIComponent(t)}`);
      if (!res.ok) throw new Error(`Lookup failed: ${res.status}`);
      const result = await res.json() as AskEdgarLookupData;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(ticker);
  }, [ticker, fetchData]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading {ticker} data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-rose-400">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex flex-col gap-0">
      {/* Chart */}
      <div className="h-[300px] border-b border-white/10">
        <ResearchChart ticker={ticker} />
      </div>

      {/* Company header */}
      <ResearchCompanyHeader ticker={ticker} rawData={data.rawData} />

      {/* Report sections */}
      <div className="flex-1 overflow-y-auto">
        <ResearchReportSections ticker={ticker} rawData={data.rawData} />
      </div>

      {/* TLDR */}
      <div className="border-t border-white/10">
        <ResearchTldr ticker={ticker} />
      </div>
    </div>
  );
}
```

**Acceptance criteria:**
- [ ] Fetches `/api/askedgar/lookup?ticker=X` when ticker prop changes
- [ ] Shows loading, error, and data states
- [ ] Renders chart, header, sections, and TLDR in order
- [ ] Lint and type-check pass

#### Step 2.4: Chart component

**File:** `components/trading/ResearchChart.tsx`
**Action:** CREATE

Reuse the lightweight-charts pattern from the existing Charts tab. Read `components/trading/ChartsTab.tsx` to copy the exact dynamic import and chart initialization pattern. Key points:

- Dynamic import: `const { createChart } = await import('lightweight-charts')`
- SSR disabled: only runs in `useEffect`
- Use the `useCandleData` hook from `hooks/use-candle-data.ts` for data fetching
- Timeframe buttons: 1m, 5m, 15m, 30m, 1h, 1D
- Dark theme colors matching existing chart: `background: '#0A0A0B'`, `textColor: '#71717A'`
- Chart should fit the 300px container height

The component should accept `{ ticker: string }` and render a candlestick chart with timeframe selector.

**Note to opencode:** Read `components/trading/ChartsTab.tsx` thoroughly before implementing. Copy the chart setup pattern — don't reinvent it. The key differences from ChartsTab:
- No sidebar/trade markers needed
- Compact: no extra controls besides timeframe
- Fixed 300px height

**Acceptance criteria:**
- [ ] Candlestick chart renders for selected ticker
- [ ] Timeframe selector works (1m, 5m, 15m, 30m, 1h, 1D)
- [ ] Chart resizes properly within the container
- [ ] Dark theme matches existing charts
- [ ] Lint and type-check pass

#### Step 2.5: Company Info Header

**File:** `components/trading/ResearchCompanyHeader.tsx`
**Action:** CREATE

A compact horizontal bar showing key info + risk badges. Data comes from the Ask Edgar lookup response.

```typescript
'use client';

interface AskEdgarEndpointResponse {
  status: string;
  results: unknown[];
  error?: string;
}

interface Props {
  ticker: string;
  rawData: Record<string, AskEdgarEndpointResponse>;
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function getField(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== null && record[key] !== undefined && record[key] !== '') {
      return record[key];
    }
  }
  return null;
}

function formatCompact(value: unknown): string {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  if (!Number.isFinite(num)) return 'N/A';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(2);
}

function riskBadge(label: string, value: unknown) {
  const normalized = String(value ?? '').toLowerCase();
  let colorClass = 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300';
  if (normalized.includes('low') || normalized.includes('compliant')) {
    colorClass = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  } else if (normalized.includes('medium') || normalized.includes('moderate')) {
    colorClass = 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  } else if (normalized.includes('high') || normalized.includes('non-compliant')) {
    colorClass = 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${colorClass}`}>
      {String(value ?? 'N/A')} {label}
    </span>
  );
}

export default function ResearchCompanyHeader({ ticker, rawData }: Props) {
  const screener = toRecord(rawData['screener']?.results?.[0]);
  const dilutionRating = toRecord(rawData['dilution-rating']?.results?.[0]);
  const pumpDump = toRecord(rawData['pump-and-dump-tracker']?.results?.[0]);

  const companyName = getField(screener, ['companyName', 'company_name', 'name']);
  const marketCap = getField(screener, ['marketCap', 'market_cap', 'market_cap_final']);
  const outstanding = getField(screener, ['outstanding', 'outstandingShares', 'outstanding_shares']);
  const float = getField(screener, ['float', 'floatShares', 'tradable_float']);
  const exchange = getField(screener, ['exchange']);
  const ipoDate = getField(screener, ['ipodate', 'ipo_date', 'ipoDate']);
  const industry = getField(screener, ['industry']);
  const country = getField(screener, ['country']);

  const overallRisk = getField(dilutionRating, ['rating', 'dilutionRating', 'overall_risk']);
  const offeringRisk = getField(dilutionRating, ['offeringAbility', 'offering_ability']);
  const dilutionRisk = getField(dilutionRating, ['dilution', 'dilution_rating']);
  const cashNeed = getField(dilutionRating, ['cashNeed', 'cash_need']);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/10 bg-[#0f0f11] px-4 py-2.5">
      {/* Ticker + company */}
      <div className="flex items-center gap-2">
        {country ? <span className="text-xs text-zinc-500">{String(country)}</span> : null}
        <span className="text-sm font-semibold text-zinc-100">{ticker}</span>
        {companyName ? <span className="text-xs text-zinc-400">{String(companyName)}</span> : null}
      </div>

      {/* Key metrics */}
      <div className="flex items-center gap-3 text-xs text-zinc-300">
        <span>${formatCompact(marketCap)} <span className="text-zinc-500">MCap</span></span>
        <span>{formatCompact(outstanding)} <span className="text-zinc-500">OS</span></span>
        <span>{formatCompact(float)} <span className="text-zinc-500">Float</span></span>
      </div>

      {/* Risk badges */}
      <div className="flex items-center gap-1.5">
        {riskBadge('Overall', overallRisk)}
        {riskBadge('Offering', offeringRisk)}
        {riskBadge('Dilution', dilutionRisk)}
        {riskBadge('Cash', cashNeed)}
      </div>

      {/* Exchange + meta */}
      <div className="flex items-center gap-3 text-xs text-zinc-500">
        {exchange ? <span>{String(exchange)}</span> : null}
        {ipoDate ? <span>{String(ipoDate)}</span> : null}
        {industry ? <span>{String(industry)}</span> : null}
      </div>
    </div>
  );
}
```

**Acceptance criteria:**
- [ ] Compact single-line header with ticker, company, metrics, risk badges
- [ ] Risk badges color-coded (green/amber/red)
- [ ] Handles missing data gracefully (shows N/A)
- [ ] Lint and type-check pass

#### Step 2.6: Report Sections (tabbed)

**File:** `components/trading/ResearchReportSections.tsx`
**Action:** CREATE

Tabbed interface showing Ask Edgar data sections. Use the field mapping patterns from `AskEdgarRawReport.tsx` (read it for reference — the `getField()` fallback key pattern, `toRecord()`, `formatMoney()`, `formatNumber()`, `riskClass()` helpers).

**Tabs:**
1. **Overview** — Screener data grid (price, market cap, float, OS, short interest, fee rate, country, industry, sector, volume)
2. **Offering Ability** — Registration data table (headline, ATM status, shelf, filed date) + management commentary from dilution-rating `mgmt_commentary` field
3. **Dilution** — Rating badge + warrants/convertibles from dilution-data endpoint
4. **Cash** — Estimated cash, burn rate, months remaining, debt
5. **News & Filings** — Combined news + filing-titles, each as expandable cards with date + form type. Color-code by form type: cyan for news, orange for SEC filings, purple for `grok`/AI summaries
6. **Offerings** — Historical offerings table
7. **Risk** — Scam risk grid (country, float, underwriter, scam) + Nasdaq compliance + pump & dump data
8. **History** — Historical float table + reverse splits + agreements

Each tab renders its content using the raw data from the lookup. Follow the exact field mapping patterns in `AskEdgarRawReport.tsx`.

The component should be a straightforward tab bar + content area. Keep it simple — no need for animation between tabs.

**Acceptance criteria:**
- [ ] 8 tabs render correctly
- [ ] Each tab displays the relevant Ask Edgar data
- [ ] Field mappings handle API response casing variants (use `getField` with fallback keys)
- [ ] Missing data shows "No data" badge
- [ ] Risk badges use emerald/amber/rose color scheme
- [ ] News items are expandable
- [ ] Lint and type-check pass

#### Step 2.7: Jarvis TLDR Component

**File:** `components/trading/ResearchTldr.tsx`
**Action:** CREATE

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface TldrResponse {
  ticker: string;
  tldr: string;
  findings: string[];
  actionSteps: string[];
  risks: string[];
  historicalContext: string | null;
  hasHistoricalData: boolean;
}

interface Props {
  ticker: string;
}

export default function ResearchTldr({ ticker }: Props) {
  const [data, setData] = useState<TldrResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateTldr = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/askedgar/tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      if (!res.ok) throw new Error(`TLDR failed: ${res.status}`);
      const result = await res.json() as TldrResponse;
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'TLDR generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Jarvis TLDR</h3>
        <Button
          type="button"
          disabled={loading}
          onClick={() => void generateTldr()}
          className="bg-emerald-500 px-3 py-1 text-xs font-semibold text-black hover:bg-emerald-400"
        >
          {loading ? 'Generating...' : 'Generate TLDR'}
        </Button>
      </div>

      {error ? <p className="mt-2 text-xs text-rose-400">{error}</p> : null}

      {data ? (
        <div className="mt-3 space-y-3">
          {/* TLDR */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="text-sm text-zinc-200">{data.tldr}</p>
          </div>

          {/* Findings */}
          {data.findings.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-zinc-400">Key Findings</p>
              <ul className="mt-1 space-y-1">
                {data.findings.map((f, i) => (
                  <li key={i} className="text-xs text-zinc-300">• {f}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Action Steps */}
          {data.actionSteps.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-zinc-400">Watch For</p>
              <ul className="mt-1 space-y-1">
                {data.actionSteps.map((s, i) => (
                  <li key={i} className="text-xs text-amber-300">• {s}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Risks */}
          {data.risks.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-zinc-400">Risks</p>
              <ul className="mt-1 space-y-1">
                {data.risks.map((r, i) => (
                  <li key={i} className="text-xs text-rose-300">• {r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Historical Context */}
          {data.historicalContext ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="text-xs font-medium text-zinc-400">Historical Context</p>
              <p className="mt-1 text-xs text-zinc-300">{data.historicalContext}</p>
            </div>
          ) : !data.hasHistoricalData ? (
            <p className="text-xs text-zinc-500">No historical data — import Discord reports to enable historical tracking</p>
          ) : null}
        </div>
      ) : !loading ? (
        <p className="mt-2 text-xs text-zinc-500">Click &quot;Generate TLDR&quot; for an AI-powered dilution risk summary</p>
      ) : null}
    </div>
  );
}
```

**Acceptance criteria:**
- [ ] "Generate TLDR" button triggers POST to `/api/askedgar/tldr`
- [ ] Shows loading state
- [ ] Renders TLDR, findings, action steps, risks, historical context
- [ ] Shows "no historical data" message when appropriate
- [ ] Lint and type-check pass

---

### Phase 3: Wire Up & Full-Page Treatment

> Risk: LOW | 2 file modifications

#### Step 3.1: Give Research tab full-page CSS treatment

**File:** `app/page.tsx`
**Action:** MODIFY

Find line 196:
```typescript
<div className={activeTab === 'charts' ? 'px-3 py-4' : 'mx-auto max-w-7xl p-8'}>
```

Change to:
```typescript
<div className={activeTab === 'charts' || activeTab === 'research' ? 'px-3 py-4' : 'mx-auto max-w-7xl p-8'}>
```

**Acceptance criteria:**
- [ ] Research tab renders full-width (no max-w-7xl constraint)
- [ ] Other tabs still render with max-w-7xl
- [ ] Lint and type-check pass

#### Step 3.2: Final integration test

Run the full verification suite:

```bash
npm run lint && npx tsc --noEmit && npm run test
```

Then manually verify:
- [ ] Research tab loads with gainers list on left
- [ ] Clicking a gainer loads chart + company header + report sections
- [ ] Typing a ticker in search and hitting Enter works
- [ ] All 8 report tabs show data (or "No data" badge)
- [ ] "Generate TLDR" button works (requires ASKEDGAR_API_KEY in env)
- [ ] Risk badges are color-coded correctly
- [ ] Chart renders with timeframe selector
- [ ] Page is full-width (no constrained container)

---

### Files Changed Summary

| File | Action | Risk |
|------|--------|------|
| `lib/db/schema.ts` | MODIFY — add table | LOW |
| `lib/discord/parser.ts` | MODIFY — enhanced parser | MEDIUM |
| `lib/jarvis/askedgar.ts` | MODIFY — add export | LOW |
| `app/api/askedgar/lookup/route.ts` | CREATE | LOW |
| `app/api/askedgar/gainers/route.ts` | CREATE | LOW |
| `app/api/askedgar/tldr/route.ts` | CREATE | MEDIUM |
| `lib/jarvis/historical-summary.ts` | CREATE | MEDIUM |
| `components/trading/ResearchTab.tsx` | REWRITE | MEDIUM |
| `components/trading/ResearchGainersList.tsx` | CREATE | LOW |
| `components/trading/ResearchTickerView.tsx` | CREATE | LOW |
| `components/trading/ResearchCompanyHeader.tsx` | CREATE | LOW |
| `components/trading/ResearchReportSections.tsx` | CREATE | MEDIUM |
| `components/trading/ResearchChart.tsx` | CREATE | MEDIUM |
| `components/trading/ResearchTldr.tsx` | CREATE | LOW |
| `app/api/discord/import/route.ts` | MODIFY — add summary call | LOW |
| `app/api/discord/sync/route.ts` | MODIFY — add summary call | LOW |
| `app/page.tsx` | MODIFY — CSS treatment | LOW |

---

## Direct Relay WebSocket — Bypass DB for Live Quotes

> Generated: 2026-03-18 | Agent: nexus-architect
> Status: CODE COMPLETE
> Priority: MEDIUM — reduces quote latency from ~6s to sub-second, reduces DB load

### Completion Summary

- Implemented all 4 phases end-to-end:
  - Relay WebSocket server + broadcast module (`services/schwab-relay/src/broadcast.ts`, `src/ws-auth.ts`, `src/index.ts`)
  - Relay token endpoint (`app/api/relay-token/route.ts`)
  - Shared client types (`lib/relay-types.ts`) and hook (`hooks/use-relay-socket.ts`)
  - Markets tab integration with automatic SSE fallback (`components/trading/MarketsTab.tsx`)
- Validation: `npm run lint`, `npx tsc --noEmit`, `npm test` all pass (39 test files, 210 tests)
- Validation note: runtime relay endpoint/env verification remains pending until deployment (`/ws` smoke test and Vercel + Fly env vars are required)

 - Latest session checks:
   - `npm run lint` (pass)
   - `npx tsc --noEmit` (pass)
   - `npm test` (pass)
   - `cd services/schwab-relay && npx tsc --noEmit` (pass)
   - `cd services/schwab-relay && npm run build` (pass)
   - `fly status --app nexus-schwab-relay` (pass: machine started, health checks passing)
   - `fly logs --app nexus-schwab-relay --no-tail` (pass: LOGIN successful, subscribed imported tickers, stream connected)
   - `curl https://nexus-schwab-relay.fly.dev/health` (fail: `SSL_ERROR_SYSCALL` from current environment)

### Goal

Add a WebSocket server to the Fly.io relay process so browsers receive real-time quotes directly, bypassing the current `Relay → DB → Vercel SSE → Browser` pipeline. The existing DB write path (`QuoteWriter`) stays intact for scanner persistence and as a fallback. The client falls back to SSE if the WebSocket is unavailable.

### Architecture

**Current flow (kept for scanner/fallback):**
```
Schwab WS → Fly Relay → QuoteWriter → PostgreSQL → Vercel SSE → Browser
```

**New flow (added, hot path):**
```
Schwab WS → Fly Relay → WebSocket Server (port 8080, /ws path) → Browser
```

**Auth flow:**
```
Browser → GET /api/relay-token (Vercel, requireUser) → short-lived HMAC JWT (60s)
Browser → wss://nexus-schwab-relay.fly.dev/ws?token=<JWT> → Relay validates → accepted
```

### Architecture Decisions

- **Reuse port 8080** — The relay's HTTP server already serves `/health`. The `ws` library runs in `noServer` mode and handles WebSocket upgrades on `/ws`. No `fly.toml` changes needed.
- **HMAC-SHA256 JWT** — Hand-rolled with Node's `crypto` module (~15 lines each for sign/verify). No new dependencies. The relay and Vercel share `RELAY_WS_SECRET`.
- **60-second token TTL** — Token is only for the handshake. Once connected, the WebSocket stays open.
- **QuoteWriter unchanged** — DB writes continue every 1s. Scanner and the snapshot fallback still work via the DB path.
- **Fallback to SSE** — If the relay WS fails (network, token error, 3 reconnect attempts), the client enables the existing `useMarketStream` SSE hook. Zero regression.
- **No fly.toml changes** — Fly.io automatically supports WebSocket upgrades on HTTP services.
- **No CORS issues** — WebSocket upgrades don't trigger CORS preflight. Optional `Origin` check for defense-in-depth.

### Environment Variables

Add to both Vercel and Fly.io (never committed):

```
RELAY_WS_SECRET=       # Shared 64-char hex string: openssl rand -hex 32
RELAY_WS_URL=          # Vercel only: wss://nexus-schwab-relay.fly.dev/ws
```

### Workflow Instructions for opencode

**Execute phases in order: 1 → 2 → 3 → 4.**

After each phase:
1. Run the verification commands listed at the end of that phase
2. **STOP and report results.** Do not proceed to the next phase until confirmed.

---

### Phase 1: Relay-Side WebSocket Server + Broadcast

> Risk: MEDIUM | Est: 1.5 hr

#### Change 1A: Create broadcast module

**File:** `services/schwab-relay/src/broadcast.ts`
**Action:** CREATE

This module manages WebSocket client connections and broadcasts quote/screener updates. It maintains an in-memory quote snapshot (Map of symbol → merged QuoteUpdate) so new clients get a full snapshot on connect, then receive incremental updates.

```typescript
import type WebSocket from 'ws';
import type { QuoteUpdate, ScreenerUpdate } from './streamer.js';

/**
 * Manages WebSocket client connections and broadcasts quote data.
 *
 * Maintains an in-memory snapshot of all quotes so new clients
 * get the full picture immediately on connect, then receive
 * only incremental changes after that.
 */
export class QuoteBroadcaster {
  private readonly clients = new Set<WebSocket>();
  private readonly snapshot = new Map<string, QuoteUpdate>();
  private lastScreener: { gainers: ScreenerUpdate['items']; losers: ScreenerUpdate['items'] } = {
    gainers: [],
    losers: [],
  };

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Add a new WebSocket client. Sends the current full snapshot
   * immediately so the client doesn't start with an empty screen.
   */
  addClient(ws: WebSocket): void {
    this.clients.add(ws);

    // Send full snapshot on connect
    const allQuotes = Array.from(this.snapshot.values());
    this.send(ws, { type: 'snapshot', data: allQuotes });

    // Send current screener data
    if (this.lastScreener.gainers.length > 0 || this.lastScreener.losers.length > 0) {
      this.send(ws, { type: 'screener', data: this.lastScreener });
    }

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', () => {
      this.clients.delete(ws);
    });
  }

  /**
   * Merge new quotes into the in-memory snapshot and broadcast
   * the incremental update to all connected clients.
   *
   * Uses the same COALESCE-style merge as QuoteWriter — only
   * overwrite fields that have a non-undefined value in the update.
   */
  broadcast(quotes: QuoteUpdate[]): void {
    for (const quote of quotes) {
      if (!quote.symbol) continue;

      const existing = this.snapshot.get(quote.symbol);
      this.snapshot.set(quote.symbol, {
        ...(existing ?? {}),
        ...quote,
        symbol: quote.symbol,
        assetType: quote.assetType ?? existing?.assetType ?? 'equity',
      });
    }

    const message = { type: 'quotes', data: quotes };
    for (const client of this.clients) {
      this.send(client, message);
    }
  }

  /**
   * Broadcast screener (gainers/losers) data to all clients.
   */
  broadcastScreener(update: ScreenerUpdate): void {
    if (update.type === 'gainers') {
      this.lastScreener.gainers = update.items;
    } else {
      this.lastScreener.losers = update.items;
    }

    const message = { type: 'screener', data: this.lastScreener };
    for (const client of this.clients) {
      this.send(client, message);
    }
  }

  /**
   * Close all client connections (used during shutdown).
   */
  closeAll(): void {
    for (const client of this.clients) {
      try {
        client.close(1001, 'server shutting down');
      } catch {
        // Ignore errors during shutdown
      }
    }
    this.clients.clear();
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState !== 1 /* WebSocket.OPEN */) return;
    try {
      ws.send(JSON.stringify(message));
    } catch {
      this.clients.delete(ws);
    }
  }
}
```

**Why this shape:**
- The `snapshot` Map mirrors what QuoteWriter does in its buffer — same merge logic. New clients get the full picture immediately.
- `closeAll()` is called during `shutdown()` so SIGTERM is clean.
- Dead clients are auto-cleaned via `close`/`error` listeners.

**Acceptance Criteria:**
- [x] `services/schwab-relay/src/broadcast.ts` created with `QuoteBroadcaster` class
- [x] `addClient` sends full snapshot on connect
- [x] `broadcast` merges into snapshot and sends incremental `quotes` messages
- [x] `broadcastScreener` sends screener data
- [x] `closeAll` disconnects all clients
- [x] Dead clients removed automatically (no memory leak)
- [x] `cd services/schwab-relay && npx tsc --noEmit` passes

#### Change 1B: Create auth validation module

**File:** `services/schwab-relay/src/ws-auth.ts`
**Action:** CREATE

Validates the short-lived JWT that the browser sends during the WebSocket handshake. Uses Node's built-in `crypto` — no new dependencies.

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a relay auth token (HMAC-SHA256 JWT).
 *
 * Token format: base64url(header).base64url(payload).base64url(signature)
 * Payload: { sub: userId, exp: epochSeconds }
 *
 * Returns { valid: true, userId } on success, { valid: false } on any error.
 * Never throws.
 */
export function validateRelayToken(token: string): { valid: boolean; userId?: string } {
  try {
    const secret = process.env.RELAY_WS_SECRET;
    if (!secret) return { valid: false };

    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const [header, payload, signature] = parts;

    // Verify signature
    const expectedSig = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const sigBuffer = Buffer.from(signature, 'base64url');
    const expectedBuffer = Buffer.from(expectedSig, 'base64url');

    if (sigBuffer.length !== expectedBuffer.length) return { valid: false };
    if (!timingSafeEqual(sigBuffer, expectedBuffer)) return { valid: false };

    // Decode payload
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string;
      exp?: number;
    };

    // Check expiry
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }

    // Check subject
    if (!decoded.sub || typeof decoded.sub !== 'string') {
      return { valid: false };
    }

    return { valid: true, userId: decoded.sub };
  } catch {
    return { valid: false };
  }
}
```

**Why hand-rolled JWT:** The relay is a minimal Node.js service. Adding `jose` or `jsonwebtoken` would increase the dependency surface for 15 lines of HMAC verification. The token structure is intentionally simple (no claims, no audience, no issuer).

**Acceptance Criteria:**
- [x] `services/schwab-relay/src/ws-auth.ts` created
- [x] Rejects tokens with invalid signatures (returns `{ valid: false }`)
- [x] Rejects expired tokens
- [x] Returns `{ valid: true, userId }` for valid tokens
- [x] Uses timing-safe comparison (prevents timing attacks)
- [x] Never throws — wraps everything in try/catch
- [x] `cd services/schwab-relay && npx tsc --noEmit` passes

#### Change 1C: Wire WebSocket server into relay entrypoint

**File:** `services/schwab-relay/src/index.ts`
**Action:** MODIFY

**Steps:**

1. Add imports at the top of the file (after line 9, after the existing `writer` import):

```typescript
import { WebSocketServer } from 'ws';
import { QuoteBroadcaster } from './broadcast.js';
import { validateRelayToken } from './ws-auth.js';
```

2. Add a module-level variable after `activeAccessToken` (after line 16):

```typescript
let broadcaster: QuoteBroadcaster | null = null;
```

3. In the `startStreamer` function, add broadcast calls to the `onQuoteUpdate` callback (line 42-45). After the existing `writer?.addQuote(quote)` loop, add:

```typescript
      // Broadcast to WebSocket clients (bypasses DB)
      broadcaster?.broadcast(quotes);
```

So the full callback becomes:
```typescript
    onQuoteUpdate: (quotes) => {
      for (const quote of quotes) {
        writer?.addQuote(quote);
      }
      // Broadcast to WebSocket clients (bypasses DB)
      broadcaster?.broadcast(quotes);
    },
```

4. In the `onScreenerUpdate` callback (line 47-60), add after the `void writer.addScreenerData(update)` call:

```typescript
      // Broadcast screener to WebSocket clients
      broadcaster?.broadcastScreener(update);
```

5. In the `shutdown` function (line 118-130), add after `stopStreamer()` on line 121:

```typescript
  broadcaster?.closeAll();
```

6. In the `main` function, after `healthServer.listen(...)` (after line 152), add the WebSocket server setup:

```typescript
  // --- WebSocket server for direct browser connections ---
  broadcaster = new QuoteBroadcaster();
  const wss = new WebSocketServer({ noServer: true });

  healthServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);

    // Only accept WebSocket upgrades on /ws path
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Validate auth token from query string
    const token = url.searchParams.get('token');
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const result = validateRelayToken(token);
    if (!result.valid) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      broadcaster!.addClient(ws);
      log(`ws client connected (user=${result.userId}, clients=${broadcaster!.clientCount})`);

      ws.on('close', () => {
        log(`ws client disconnected (clients=${broadcaster!.clientCount})`);
      });
    });
  });
```

7. Update the health endpoint response (line 137-144) to include WebSocket client count. Change the `status` object to:

```typescript
      const status = {
        ok: true,
        connected: streamer?.isConnected() ?? false,
        activeUser: activeUserId !== null,
        wsClients: broadcaster?.clientCount ?? 0,
        uptime: process.uptime(),
      };
```

**Acceptance Criteria:**
- [x] `/health` endpoint still works, now includes `wsClients` field
- [x] `GET /health` returns `{ ok, connected, activeUser, wsClients, uptime }`
- [x] WebSocket connections to `/ws?token=VALID_TOKEN` are accepted
- [x] WebSocket connections without a token get 401 and socket destroyed
- [x] WebSocket connections with an invalid/expired token get 401
- [x] Non-`/ws` upgrade requests are destroyed (no crash)
- [x] Connected clients receive `snapshot` message immediately on connect
- [x] Connected clients receive `quotes` messages on each Schwab tick
- [x] Connected clients receive `screener` messages on screener updates
- [x] All WS clients disconnected on SIGTERM/SIGINT
- [x] Relay still writes to DB via QuoteWriter (unchanged)
- [x] `cd services/schwab-relay && npx tsc --noEmit` passes

#### Phase 1 Verification

```bash
cd services/schwab-relay && npx tsc --noEmit
```

- [x] Relay type-check passes
- [x] No new npm dependencies needed (ws already installed)

**STOP HERE. Report results before proceeding to Phase 2.**

---

### Phase 2: Auth Token Generation (Next.js API Route)

> Risk: MEDIUM | Est: 30 min

#### Change 2A: Create relay token API route

**File:** `app/api/relay-token/route.ts`
**Action:** CREATE

This route generates a short-lived JWT that the browser uses to authenticate with the relay WebSocket. Protected by `requireUser()`. Also checks that the user has an active Schwab link (same gate as the SSE route).

```typescript
import { createHmac } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import { schwabLinks } from '@/lib/db/schema';
import { requireUser } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';

/**
 * GET /api/relay-token
 *
 * Returns a short-lived JWT for connecting to the Schwab relay WebSocket.
 * The token expires in 60 seconds — it's only used for the handshake.
 *
 * Requires:
 * - Authenticated user (NextAuth session)
 * - Active Schwab link (schwab_links table)
 * - RELAY_WS_SECRET and RELAY_WS_URL env vars
 */
export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const secret = process.env.RELAY_WS_SECRET;
  const wsUrl = process.env.RELAY_WS_URL;

  if (!secret || !wsUrl) {
    return Response.json(
      { error: 'Relay WebSocket not configured' },
      { status: 503 },
    );
  }

  // Verify user has an active Schwab link
  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }

  const [link] = await db
    .select({
      status: schwabLinks.status,
      refreshTokenExpiresAt: schwabLinks.refreshTokenExpiresAt,
    })
    .from(schwabLinks)
    .where(eq(schwabLinks.userId, authState.user.id))
    .limit(1);

  if (!link || link.status !== 'active' || link.refreshTokenExpiresAt.getTime() < Date.now()) {
    return Response.json(
      { error: 'No active Schwab link. Connect your Schwab account first.' },
      { status: 400 },
    );
  }

  // Build JWT: header.payload.signature
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: authState.user.id,
      exp: Math.floor(Date.now() / 1000) + 60, // 60 seconds
    }),
  ).toString('base64url');

  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  const token = `${header}.${payload}.${signature}`;

  return Response.json({ token, wsUrl });
}
```

**Why a separate route (not embedded in the SSE route):** The SSE route returns an EventSource stream. This route returns a one-shot JSON response with a token. Different response types, different purposes. Keeping them separate is cleaner.

**Acceptance Criteria:**
- [x] `app/api/relay-token/route.ts` created
- [x] Returns 401 for unauthenticated requests (via `requireUser()`)
- [x] Returns 503 if `RELAY_WS_SECRET` or `RELAY_WS_URL` not set
- [x] Returns 400 if user has no active Schwab link
- [x] Returns `{ token, wsUrl }` on success
- [x] Token is a valid 3-part base64url JWT (header.payload.signature)
- [x] Token payload contains `sub` (userId) and `exp` (60 seconds from now)
- [x] Token is signed with HMAC-SHA256 using `RELAY_WS_SECRET`
- [x] `npm run lint && npx tsc --noEmit` passes

#### Phase 2 Verification

```bash
npm run lint && npx tsc --noEmit
```

- [x] Lint passes
- [x] Type-check passes

**STOP HERE. Report results before proceeding to Phase 3.**

---

### Phase 3: Client Hook + Shared Types

> Risk: MEDIUM | Est: 1 hr

#### Change 3A: Create shared relay types

**File:** `lib/relay-types.ts`
**Action:** CREATE

The relay's `QuoteUpdate` type lives in the relay package (`services/schwab-relay/src/streamer.ts`) and can't be imported by the Next.js app. We need matching types on the client side.

```typescript
/**
 * Quote data broadcast by the Schwab relay WebSocket.
 * Matches the shape of QuoteUpdate in services/schwab-relay/src/streamer.ts.
 */
export type RelayQuoteUpdate = {
  symbol: string;
  assetType: string;
  lastPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  closePrice?: number;
  netChange?: number;
  netChangePercent?: number;
  totalVolume?: number;
  exchangeId?: string;
  securityStatus?: string;
  quoteTimeMs?: number;
};

/**
 * Screener data broadcast by the relay.
 * Contains merged gainers + losers (relay sends full screener state each time).
 */
export type RelayScreenerData = {
  gainers: RelayScreenerItem[];
  losers: RelayScreenerItem[];
};

export type RelayScreenerItem = {
  symbol: string;
  lastPrice: number;
  netChange: number;
  netChangePercent: number;
  totalVolume: number;
};

/**
 * Message types sent by the relay WebSocket.
 *
 * - snapshot: Full quote array, sent once on connect
 * - quotes: Incremental quote updates, sent on each Schwab tick
 * - screener: Full screener state (gainers + losers)
 */
export type RelayMessage =
  | { type: 'snapshot'; data: RelayQuoteUpdate[] }
  | { type: 'quotes'; data: RelayQuoteUpdate[] }
  | { type: 'screener'; data: RelayScreenerData };
```

**Acceptance Criteria:**
- [x] `lib/relay-types.ts` created with `RelayQuoteUpdate`, `RelayScreenerData`, `RelayScreenerItem`, `RelayMessage` types
- [x] Types match the relay's broadcast shapes
- [x] `npm run lint && npx tsc --noEmit` passes

#### Change 3B: Create useRelaySocket hook

**File:** `hooks/use-relay-socket.ts`
**Action:** CREATE

This hook connects to the relay WebSocket for real-time quotes. It fetches a token from `/api/relay-token`, opens a WebSocket, and dispatches updates. Falls back to SSE after 3 failed reconnect attempts.

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RelayMessage, RelayQuoteUpdate, RelayScreenerData } from '@/lib/relay-types';

type UseRelaySocketOptions = {
  /** Whether to attempt connecting. Set to false to disable. */
  enabled: boolean;
  /** Called once on connect with the full quote snapshot. */
  onSnapshot: (quotes: RelayQuoteUpdate[]) => void;
  /** Called on each incremental quote update from Schwab. */
  onQuotes: (quotes: RelayQuoteUpdate[]) => void;
  /** Called when screener data updates (full gainers + losers). */
  onScreener: (data: RelayScreenerData) => void;
};

type UseRelaySocketReturn = {
  /** Whether the WebSocket is currently open and receiving data. */
  connected: boolean;
  /** True after 3 failed reconnect attempts. Signals the caller to enable SSE fallback. */
  fallbackToSSE: boolean;
};

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 2_000;
const KEEPALIVE_INTERVAL_MS = 30_000;

/**
 * Hook that connects to the Schwab relay WebSocket for real-time quotes.
 *
 * Flow:
 * 1. Fetch a short-lived token from GET /api/relay-token
 * 2. Open WebSocket to the relay's /ws endpoint with the token
 * 3. Receive snapshot (full state), then incremental quotes + screener updates
 * 4. On disconnect: retry up to 3 times with exponential backoff
 * 5. After 3 failures: set fallbackToSSE = true so the caller can switch to SSE
 *
 * The token is only valid for 60 seconds (handshake only). Once connected,
 * the WebSocket stays open without re-authentication.
 */
export function useRelaySocket(options: UseRelaySocketOptions): UseRelaySocketReturn {
  const [connected, setConnected] = useState(false);
  const [fallbackToSSE, setFallbackToSSE] = useState(false);

  // Use refs for callbacks to avoid re-triggering the effect on every render
  const onSnapshotRef = useRef(options.onSnapshot);
  const onQuotesRef = useRef(options.onQuotes);
  const onScreenerRef = useRef(options.onScreener);

  useEffect(() => {
    onSnapshotRef.current = options.onSnapshot;
    onQuotesRef.current = options.onQuotes;
    onScreenerRef.current = options.onScreener;
  }, [options.onSnapshot, options.onQuotes, options.onScreener]);

  const connect = useCallback(async (attempt: number): Promise<WebSocket | null> => {
    try {
      // 1. Fetch token
      const res = await fetch('/api/relay-token');
      if (!res.ok) {
        // Token endpoint failed (401, 400, 503) — no point retrying
        return null;
      }

      const { token, wsUrl } = (await res.json()) as { token: string; wsUrl: string };

      // 2. Open WebSocket
      const ws = new WebSocket(`${wsUrl}?token=${token}`);
      return ws;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) {
      setConnected(false);
      setFallbackToSSE(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    function cleanup() {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      keepaliveTimer = null;
      reconnectTimer = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        ws = null;
      }
    }

    function scheduleReconnect() {
      if (disposed) return;

      reconnectAttempts++;
      if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        setFallbackToSSE(true);
        setConnected(false);
        return;
      }

      const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1);
      reconnectTimer = setTimeout(() => {
        if (disposed) return;
        void startConnection();
      }, delay);
    }

    async function startConnection() {
      if (disposed) return;

      cleanup();

      ws = await connect(reconnectAttempts);

      if (!ws) {
        // Token fetch failed — fall back immediately
        setFallbackToSSE(true);
        setConnected(false);
        return;
      }

      ws.onopen = () => {
        if (disposed) return;
        reconnectAttempts = 0;
        setConnected(true);
        setFallbackToSSE(false);

        // Send keepalive pings to prevent Fly.io proxy from closing idle connections
        keepaliveTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, KEEPALIVE_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as RelayMessage;

          switch (message.type) {
            case 'snapshot':
              onSnapshotRef.current(message.data);
              break;
            case 'quotes':
              onQuotesRef.current(message.data);
              break;
            case 'screener':
              onScreenerRef.current(message.data);
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        keepaliveTimer = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror — reconnect logic is there
      };
    }

    void startConnection();

    return () => {
      disposed = true;
      cleanup();
      setConnected(false);
    };
  }, [options.enabled, connect]);

  return { connected, fallbackToSSE };
}
```

**How this works (plain English):**
1. When `enabled` is true, the hook fetches a token from your Vercel API
2. It opens a WebSocket to the Fly.io relay using that token
3. The relay sends a `snapshot` message immediately (full quote state)
4. Then it sends `quotes` messages every time Schwab pushes a tick (~sub-second)
5. If the connection drops, it retries 3 times with backoff (2s, 4s, 8s)
6. After 3 failures, it sets `fallbackToSSE = true` so the UI can switch to the old SSE path
7. It sends a ping every 30 seconds to keep the connection alive through Fly's proxy

**Acceptance Criteria:**
- [x] `hooks/use-relay-socket.ts` created with `useRelaySocket` export
- [x] Fetches token from `/api/relay-token` before connecting
- [x] Falls back to SSE immediately if token fetch fails (401, 400, 503)
- [x] Opens WebSocket to relay's `/ws` endpoint
- [x] Dispatches `onSnapshot`, `onQuotes`, `onScreener` callbacks based on message type
- [x] Reconnects up to 3 times with exponential backoff on disconnect
- [x] Sets `fallbackToSSE = true` after 3 failed reconnects
- [x] Sends keepalive ping every 30 seconds
- [x] Cleans up WebSocket on unmount or when `enabled` becomes false
- [x] Uses refs for callbacks (avoids reconnect on every render)
- [x] `npm run lint && npx tsc --noEmit` passes

#### Phase 3 Verification

```bash
npm run lint && npx tsc --noEmit
```

- [x] Lint passes
- [x] Type-check passes

**STOP HERE. Report results before proceeding to Phase 4.**

---

### Phase 4: Wire Into MarketsTab

> Risk: MEDIUM | Est: 1 hr

#### Change 4A: Integrate useRelaySocket into MarketsTab

**File:** `components/trading/MarketsTab.tsx`
**Action:** MODIFY

**Steps:**

1. Add imports at the top of the file (after line 10, after `useSchwabStatus` import):

```typescript
import { useRelaySocket } from '@/hooks/use-relay-socket';
import type { RelayQuoteUpdate, RelayScreenerData } from '@/lib/relay-types';
```

2. Inside the `MarketsTab` component (after the `useSchwabStatus` call on line 216), add a ref to hold the quote map and helper functions:

```typescript
  // --- Relay WebSocket (direct from Fly.io, bypasses DB) ---
  const quoteMapRef = useRef(new Map<string, RelayQuoteUpdate>());

  const buildSnapshotFromQuotes = useCallback((quotes: Map<string, RelayQuoteUpdate>): SnapshotPayload => {
    const INDEX_SYMBOLS = ['SPY', 'QQQ', 'DIA', 'IWM'];
    const COMMODITY_MAP = [
      { ticker: 'GLD', label: 'Gold' },
      { ticker: 'SLV', label: 'Silver' },
      { ticker: 'USO', label: 'Crude Oil' },
      { ticker: 'UNG', label: 'Natural Gas' },
      { ticker: 'TLT', label: 'Treasuries' },
      { ticker: 'UUP', label: 'US Dollar' },
    ];
    const EQUITY_SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA', 'TSLA', 'META', 'JPM', 'JNJ', 'V'];

    const toInstrument = (symbol: string, label: string): MarketInstrument => {
      const q = quotes.get(symbol);
      return {
        symbol,
        label,
        price: q?.lastPrice ?? null,
        change: q?.netChange ?? null,
        changePercent: q?.netChangePercent ?? null,
        marketStatus: q?.securityStatus ?? null,
        quoteSession: q ? 'regular' : 'snapshot',
        extendedQuoteUnavailable: false,
        extendedUnavailableLabel: null,
      };
    };

    return {
      indices: INDEX_SYMBOLS.map((s) => toInstrument(s, s)),
      commodities: COMMODITY_MAP.map((c) => toInstrument(c.ticker, c.label)),
      equities: EQUITY_SYMBOLS.map((s) => toInstrument(s, s)),
      movers: snapshot?.movers ?? { gainers: [], losers: [] },
    };
  }, [snapshot?.movers]);

  const handleRelaySnapshot = useCallback((quotes: RelayQuoteUpdate[]) => {
    const map = quoteMapRef.current;
    for (const q of quotes) {
      map.set(q.symbol, q);
    }
    setSnapshot(buildSnapshotFromQuotes(map));
    setCoverage(buildCoverage(buildSnapshotFromQuotes(map)));
    setDataSource('realtime');
    setLastLoadedAt(new Date());
    setLoadingSnapshot(false);
    setWarning(null);
    setIsStale(false);
  }, [buildSnapshotFromQuotes]);

  const handleRelayQuotes = useCallback((quotes: RelayQuoteUpdate[]) => {
    const map = quoteMapRef.current;
    for (const q of quotes) {
      const existing = map.get(q.symbol);
      map.set(q.symbol, { ...(existing ?? {}), ...q, symbol: q.symbol });
    }
    setSnapshot(buildSnapshotFromQuotes(map));
    setLastLoadedAt(new Date());
  }, [buildSnapshotFromQuotes]);

  const handleRelayScreener = useCallback((data: RelayScreenerData) => {
    const toMoverRow = (item: RelayScreenerData['gainers'][number]): MarketMoverRow => ({
      ticker: item.symbol,
      price: item.lastPrice,
      previousClose: null,
      change: item.netChange,
      changePercent: item.netChangePercent,
      updated: null,
      volume: item.totalVolume,
    });

    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        movers: {
          gainers: data.gainers.map(toMoverRow),
          losers: data.losers.map(toMoverRow),
        },
      };
    });
  }, []);

  const { connected: relayConnected, fallbackToSSE: relayFallback } = useRelaySocket({
    enabled: dataSource === 'realtime',
    onSnapshot: handleRelaySnapshot,
    onQuotes: handleRelayQuotes,
    onScreener: handleRelayScreener,
  });
```

3. Modify the existing `useMarketStream` call (line 218). It should only be enabled when the relay WebSocket is unavailable:

Change:
```typescript
  const { connected: sseConnected, fallbackToPolling } = useMarketStream({
    enabled: dataSource === 'realtime',
```

To:
```typescript
  const { connected: sseConnected, fallbackToPolling } = useMarketStream({
    enabled: dataSource === 'realtime' && relayFallback,
```

4. You will also need to add `useRef` to the React import on line 3. Change:

```typescript
import { useCallback, useEffect, useState } from 'react';
```

To:
```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
```

5. Update the LIVE badge text (line 338) to show the data source. Change:

```typescript
            {dataSource === 'realtime' ? 'Schwab real-time streaming' : 'Massive API delayed data'}
```

To:
```typescript
            {dataSource === 'realtime'
              ? relayConnected
                ? 'Schwab real-time (direct WebSocket)'
                : 'Schwab real-time streaming (SSE)'
              : 'Massive API delayed data'}
```

**Why this approach:**
- The relay WebSocket is tried first. If it works, SSE stays disabled (`relayFallback` is false).
- If the relay fails after 3 retries, `relayFallback` becomes true, which enables the SSE hook (same as before).
- The `quoteMapRef` accumulates quote data in memory, and `buildSnapshotFromQuotes` converts it to the same `SnapshotPayload` shape the rest of the component expects. Zero changes to the rendering code.
- The status text tells you which path is active so you can verify.

**Acceptance Criteria:**
- [x] `useRelaySocket` called in MarketsTab with correct callbacks
- [x] `useMarketStream` only enabled when `relayFallback` is true
- [x] Quote data from relay WebSocket renders identically to SSE data
- [x] Movers/screener data from relay renders in the movers section
- [x] LIVE badge shows "direct WebSocket" when relay is connected
- [x] LIVE badge shows "SSE" when relay is unavailable and SSE takes over
- [x] Disconnecting relay causes automatic fallback to SSE (no blank screen)
- [x] ScannerSection still works via existing polling (no changes)
- [x] `npm run lint && npx tsc --noEmit` passes

#### Phase 4 Verification

```bash
npm run lint && npx tsc --noEmit && npm test
```

- [x] Lint passes
- [x] Type-check passes
- [x] All existing tests pass (no regressions)

---

### Files Changed Summary

| File | Action | Phase | Risk |
|------|--------|-------|------|
| `services/schwab-relay/src/broadcast.ts` | CREATE | 1 | LOW |
| `services/schwab-relay/src/ws-auth.ts` | CREATE | 1 | LOW |
| `services/schwab-relay/src/index.ts` | MODIFY | 1 | MEDIUM |
| `app/api/relay-token/route.ts` | CREATE | 2 | MEDIUM |
| `lib/relay-types.ts` | CREATE | 3 | LOW |
| `hooks/use-relay-socket.ts` | CREATE | 3 | MEDIUM |
| `components/trading/MarketsTab.tsx` | MODIFY | 4 | MEDIUM |

**Total: 5 new files, 2 modified files. No new npm dependencies.**

---

### Deployment Order

This feature spans two independently-deployed services. Deploy in this order:

1. **Set env vars first:**
   - Generate secret: `openssl rand -hex 32`
   - Fly.io: `cd services/schwab-relay && fly secrets set RELAY_WS_SECRET=<value>`
   - Vercel: Add `RELAY_WS_SECRET=<same-value>` and `RELAY_WS_URL=wss://nexus-schwab-relay.fly.dev/ws`

2. **Deploy relay (Phases 1):**
   - `cd services/schwab-relay && fly deploy`
   - Verify: `curl https://nexus-schwab-relay.fly.dev/health` → should show `wsClients: 0`

3. **Deploy Vercel (Phases 2-4):**
   - `git push` triggers Vercel deploy
   - Verify: Open Markets tab, check for "direct WebSocket" in status text

### Rollback Plan

Each phase is independently revertible. The existing SSE pipeline is never modified or removed.

- **Phase 4:** Revert MarketsTab. SSE resumes as sole data source.
- **Phase 3:** Delete `hooks/use-relay-socket.ts` and `lib/relay-types.ts`.
- **Phase 2:** Delete `app/api/relay-token/route.ts`. Remove Vercel env vars.
- **Phase 1:** Revert relay `index.ts`. Delete `broadcast.ts` and `ws-auth.ts`. Redeploy relay. Remove Fly secrets.

### Security Notes

- **Token is read-only** — the relay WebSocket only broadcasts quotes. No write operations exposed.
- **60-second TTL** — token expires fast, limiting replay window.
- **Timing-safe comparison** — HMAC verification uses `timingSafeEqual` to prevent timing attacks.
- **No PII** — only market data (ticker, price, volume) flows through the WebSocket.
- **Shared secret** — `RELAY_WS_SECRET` must match on both Vercel and Fly.io. Rotate by updating both simultaneously.

### Future Improvements (Not In Scope)

1. **Client-side scanner filtering** — Once the relay WS sends all quotes, ScannerSection could filter client-side instead of polling `/api/scanner`. Eliminates the last DB round-trip.
2. **Symbol subscription management** — Let the client tell the relay which symbols it cares about, reducing bandwidth.
3. **Binary protocol** — Switch from JSON to MessagePack if bandwidth becomes a concern.

---

### Pre-flight Checklist (for Jared)

Before opencode starts:
- [ ] Generate shared secret: `openssl rand -hex 32`
- [ ] Set `RELAY_WS_SECRET` on Fly.io: `fly secrets set RELAY_WS_SECRET=<value> --app nexus-schwab-relay`
- [ ] Set `RELAY_WS_SECRET` on Vercel: `vercel env add RELAY_WS_SECRET`
- [ ] Set `RELAY_WS_URL` on Vercel: `vercel env add RELAY_WS_URL` → value: `wss://nexus-schwab-relay.fly.dev/ws`
- [ ] Schwab account re-linked (Schwab Relay Auth blocker resolved)
