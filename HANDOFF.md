# Nexus Terminal — HANDOFF.md

> Older completed execution specs were removed to keep this file focused. Use git history for archived implementation detail (P2 agent response improvements, T1.1–T1.3 specialist blueprints — all completed 2026-04-13).

---

## Swing-Trader Massive News Integration — Phase 1

> Generated: 2026-04-14
> Status: COMPLETED 2026-04-14
> Scope: 3 implementation files modified, 1 likely test file updated, no schema/migration changes, no new env vars
> Dependency: existing server-side `MASSIVE_API_KEY`
> Worktree note: preserve the unstaged `mdrSimilarity: z.number().min(0).max(100).catch(0)` change already present in `lib/agents/blueprints/swing-trader-research.ts`

### Completion Notes

- Implemented `fetchTickerNews()` and `MassiveNewsArticle` in `lib/massive-market.ts` using the existing Massive API helper and key path.
- Added `fetch-news` to the swing-trader pipeline, threaded `recentNews` through the prompt schemas, and updated the synthesis prompt to use recent-news context with a no-news fallback.
- Updated `lib/agents/prompts/swing-trader.md` so catalyst reasoning cites article titles from the `Recent news` section in `evidenceIds` when present.
- Updated `__tests__/agent-blueprints.test.ts` for the new step order, successful/failing news fetch behavior, and prompt assertions.
- Validation completed successfully on 2026-04-14: `npm run lint`, `npx tsc --noEmit`, `npm test`.

### Objective

Add recent Massive/Polygon news to the `swing-trader:research` pipeline so the LLM can rate the `catalyst` section from real headlines instead of inferring from price action alone. Keep the new fetch best-effort, token-efficient, and server-only.

### Observed Current State

- `lib/massive-market.ts` currently exposes snapshots, daily summaries, and `fetchDailyAggregates()` only. There is no Massive news type or helper in the file.
- `lib/agents/blueprints/swing-trader-research.ts` currently runs six serial steps: `fetch-filings` -> `fetch-price-context` -> `fetch-ohlc-history` -> `compute-swing-technicals` -> `synthesize-report` -> `save-research`.
- The same blueprint already treats Massive OHLC as non-fatal: `fetch-ohlc-history` catches errors, logs a warning, and continues with `ohlcHistory: []`. The news step should mirror that behavior instead of aborting the pipeline.
- `buildResearchPrompt()` in `lib/agents/blueprints/swing-trader-research.ts` only includes price context, deterministic technicals, runner quality, and optional OHLC. There is no recent-news section or fallback instruction today.
- `lib/agents/prompts/swing-trader.md` tells the model to judge catalyst quality, but it does not instruct the model to cite recent article titles in `evidenceIds`.
- `lib/agents/blueprints/small-cap-research.ts` already digests AskEdgar `news`, but that is a separate filing/news path and should not be reused for market-news input.

### Files To Modify

| File | Action | Notes |
|------|--------|-------|
| `lib/massive-market.ts` | Modify | Add a Massive news response type and a `fetchTickerNews()` helper using the existing Massive API key and shared `fetchMassiveJson()` helper. |
| `lib/agents/blueprints/swing-trader-research.ts` | Modify | Thread recent-news data through schemas, insert a new `fetch-news` step, and update `buildResearchPrompt()` to include a `Recent news` section plus empty-state guidance. |
| `lib/agents/prompts/swing-trader.md` | Modify | Tighten catalyst instructions so article titles from the `Recent news` section are cited in `evidenceIds` when news exists. |
| `__tests__/agent-blueprints.test.ts` | Modify | Update swing-trader blueprint tests for the extra step, Massive news mocking, new warning path, and prompt assertions. |

### Ordered Work

1. Modify `lib/massive-market.ts`.
   Add `MassiveNewsArticle` for the `/v2/reference/news` response shape and export `fetchTickerNews(ticker: string, daysBack = 3)`.
   Use `fetchMassiveJson('/v2/reference/news', ...)` with the normalized ticker, `published_utc.gte`, descending `published_utc`, and `limit: '10'`.
   Return `results ?? []` and keep the helper focused on server-side fetching only. No cache layer, no new env vars, no client exposure.
2. Modify `lib/agents/blueprints/swing-trader-research.ts`.
   Import `fetchTickerNews` from `@/lib/massive-market`.
   Add a prompt-facing `newsArticleSchema` with only the fields the LLM needs: `title`, `publishedUtc`, `description`, `sentiment`, and `sentimentReasoning`.
   Add `newsEnrichedSchema = ohlcEnrichedSchema.extend({ recentNews: z.array(newsArticleSchema) })`.
   Change `swingPipelineInputSchema` to extend `newsEnrichedSchema` instead of `ohlcEnrichedSchema`.
3. Insert the new pipeline step in `lib/agents/blueprints/swing-trader-research.ts`.
   Add `fetch-news` between `fetch-ohlc-history` and `compute-swing-technicals`.
   Input schema: `ohlcEnrichedSchema`. Output schema: `newsEnrichedSchema`.
   Metadata should match the existing best-effort pattern: `canRetry: true`, `sideEffect: false`, timeout around 10s, and no repair loop.
   On success, map raw Massive articles into a token-efficient `recentNews` array. Pull sentiment fields from the matching per-ticker `insights` item when present.
   On failure, `console.warn('[swing-trader] News fetch failed for ${data.ticker}:', error)` and continue with `recentNews: []`.
   Use `sourceIds: ['massive-news:${ticker}']` only when at least one article is returned.
4. Update prompt construction in `lib/agents/blueprints/swing-trader-research.ts`.
   Add a `Recent news` section after OHLC context and before the final instruction block.
   If `recentNews.length > 0`, pass only the simplified article objects and instruct the model to use only those articles when judging catalyst quality.
   If `recentNews.length === 0`, add a plain fallback note: no recent news was available, so catalyst must be rated from price-action context only.
   Keep the saved report shape unchanged. This feature should improve the `catalyst` explanation and `evidenceIds`, not add new report fields.
5. Modify `lib/agents/prompts/swing-trader.md`.
   Add one sentence under the catalyst guidance: when recent news is provided, use it to inform the catalyst rating and cite article titles from the `Recent news` section in `evidenceIds`.
6. Update `__tests__/agent-blueprints.test.ts`.
   Cover the new `fetch-news` step, the non-fatal news fallback, and the new prompt text.
   If validation exposes additional swing-trader test failures, update only the exact failing files reported by the suite.

### Acceptance Criteria

- `fetchTickerNews()` exists in `lib/massive-market.ts` and uses the existing Massive API key path; no new environment variables are introduced.
- The swing-trader blueprint step order becomes `fetch-filings` -> `fetch-price-context` -> `fetch-ohlc-history` -> `fetch-news` -> `compute-swing-technicals` -> `synthesize-report` -> `save-research`.
- News fetch failure is non-fatal and results in `recentNews: []`, matching the existing OHLC resilience pattern.
- The prompt includes a `Recent news` section when articles exist and an explicit fallback note when they do not.
- Only token-efficient news fields are passed to the LLM. Do not pass article URLs, images, or publisher-logo noise into the prompt.
- The saved swing-trader report contract remains unchanged. No DB schema work, no Discord embed work, and no API route changes are part of this phase.
- Validation passes: `npm run lint`, `npx tsc --noEmit`, `npm test`.

### Security Notes

- Keep `MASSIVE_API_KEY` server-side only; do not surface it to the client or log it.
- Do not log raw Massive news payloads. Warning logs should stay at the ticker + error level only.
- This change adds one more third-party request per swing research run, so keep the article window bounded to 3 days / 10 articles to avoid unnecessary spend and prompt bloat.

### Order Of Operations

1. Add the Massive helper first so the blueprint can import a real symbol.
2. Thread schemas and the new step through `swing-trader-research.ts`.
3. Update the prompt file once the blueprint is passing the new `Recent news` section.
4. Fix test fallout and run validation last.

### Complexity

Medium. The change is small in file count, but it crosses a shared market-data helper, the swing-trader step graph, and prompt/test expectations.

---

## Macro Daily Pipeline Enhancement — Phase 1

> Generated: 2026-04-13
> Status: COMPLETED 2026-04-13
> Scope: 2 new files, 5 files modified, 1 new optional env var (`FRED_API_KEY`)
> No schema/migration changes, no new npm dependencies

### Overview

Transform the macro daily briefing from a thin summary (bias + drivers + catalysts) into a comprehensive pre-market macro analysis. Four coordinated changes:

1. **New data sources** — FRED API for Treasury yields/rates, RSS parser for ZeroHedge headlines, 5-day daily OHLC bars for key level identification
2. **Expanded ticker universe** — add VIX proxy, dollar, semis, mid-term treasuries, high yield bonds, emerging markets, crypto proxy (7 new tickers via existing Massive API — no new cost)
3. **Deeper output schema** — new sections: risk assessment, key levels, rates outlook, scenario analysis, TLDR
4. **Updated prompt + embed** — rewrite LLM prompt for deeper analysis, update Discord embed to render all new sections

### Files Changed

| File | Change |
|------|--------|
| `lib/agents/fred-client.ts` | **NEW** — FRED API client |
| `lib/agents/rss-lite.ts` | **NEW** — RSS feed parser |
| `lib/agents/types.ts` | Add `FredDataPoint`, `KeyLevel`, `ScenarioAnalysis`; expand `MacroSummaryReport` |
| `lib/agents/blueprints/orchestrator-macro-summary.ts` | New step, expanded tickers, updated schemas, rewritten prompt |
| `lib/agents/discord.ts` | Updated `buildMacroSummaryEmbed` with new report sections |
| `lib/agents/prompts/orchestrator.md` | Updated macro briefing instructions |
| `__tests__/agent-*.test.ts` | Updated fixtures for new schema shape |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FRED_API_KEY` | No | Free API key from [fred.stlouisfed.org](https://fred.stlouisfed.org/docs/api/api_key.html). If absent, FRED data is skipped — pipeline still works. |
| `MACRO_RSS_URLS` | No | Comma-separated RSS feed URLs. Defaults to ZeroHedge RSS. If feeds fail, pipeline continues without RSS data. |

### Guardrails

- No schema/migration changes (no DB changes).
- No new npm dependencies — RSS parsing uses regex on XML, FRED uses native fetch.
- All new data fetches must degrade gracefully: missing API key → skip, failed fetch → empty array, pipeline still completes.
- The pipeline must produce a valid report with zero new env vars set.
- Previously stored macro reports (before this change) lack new fields — code reading `MacroSummaryReport` from the DB (e.g., `context.ts`, `orchestrator-chat.ts`) should tolerate missing fields via optional chaining where needed.
- Run `npm run lint && npx tsc --noEmit && npm test` after each step.

---

### Step 1 — FRED API Client (NEW FILE)

**File:** `lib/agents/fred-client.ts`

**Why:** FRED is free, authoritative, and reliable. It gives us actual Treasury yield percentages and Fed Funds rate — data that transforms vague "rates are moving" analysis into specific "10Y at 4.32%, 2Y at 3.85%, spread +47bp" analysis. The API key is free (register at fred.stlouisfed.org).

**What it does:** Fetches the latest observation for each FRED series ID in parallel. Returns an array of `FredDataPoint` objects. If `FRED_API_KEY` is not set, returns empty array immediately (no error). Each individual series fetch has its own timeout and failure is isolated — if one series fails, the others still return.

Create this file with this exact content:

```ts
import type { FredDataPoint } from './types';

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Human-readable labels for FRED series IDs.
 * Used in the Discord embed so traders see "10-Year Treasury" instead of "DGS10".
 */
const SERIES_LABELS: Record<string, string> = {
  DGS10: '10Y Treasury',
  DGS2: '2Y Treasury',
  T10Y2Y: '10Y-2Y Spread',
  FEDFUNDS: 'Fed Funds Rate',
};

/**
 * Fetch the most recent observation for each FRED series.
 * Returns empty array if FRED_API_KEY is not set (graceful degrade).
 * Each series is fetched in parallel with independent error handling.
 */
export async function fetchFredSeries(
  seriesIds: string[],
  options?: { timeoutMs?: number },
): Promise<FredDataPoint[]> {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) return [];

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const settled = await Promise.allSettled(
    seriesIds.map(async (seriesId) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const url = new URL(FRED_BASE_URL);
        url.searchParams.set('series_id', seriesId);
        url.searchParams.set('api_key', apiKey);
        url.searchParams.set('file_type', 'json');
        url.searchParams.set('sort_order', 'desc');
        url.searchParams.set('limit', '1');

        const response = await fetch(url.toString(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`FRED ${seriesId}: status ${response.status}`);
        }

        const data = (await response.json()) as {
          observations?: Array<{ date?: string; value?: string }>;
        };

        const obs = data.observations?.[0];
        const rawValue = obs?.value?.trim();
        // FRED uses "." for missing data (holidays, weekends)
        const numericValue = rawValue && rawValue !== '.' ? Number(rawValue) : null;

        return {
          seriesId,
          label: SERIES_LABELS[seriesId] ?? seriesId,
          date: obs?.date ?? 'unknown',
          value: Number.isFinite(numericValue) ? numericValue : null,
        } satisfies FredDataPoint;
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<FredDataPoint> => r.status === 'fulfilled')
    .map((r) => r.value);
}
```

**Validate:** `npm run lint && npx tsc --noEmit`

---

### Step 2 — RSS Feed Parser (NEW FILE)

**File:** `lib/agents/rss-lite.ts`

**Why:** RSS feeds give structured headline data (title + date + link) much more efficiently than scraping full web pages. ZeroHedge publishes contrarian macro analysis that adds a different perspective from mainstream MarketWatch/Yahoo headlines. No API key needed — RSS is open.

**What it does:** Fetches an RSS XML feed, extracts `<item>` blocks via regex, and returns an array of `{ title, link, pubDate }` only — the `<description>` body is intentionally ignored (ZeroHedge items have massive HTML description blocks that would blow up token usage). Handles CDATA-wrapped titles (common in RSS). No XML parser dependency — regex is sufficient for standard RSS 2.0 feeds. Default limit is 10 items.

Create this file with this exact content:

```ts
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
}

/**
 * Fetch and parse an RSS 2.0 feed. Returns up to `limit` items.
 * Uses regex extraction — no XML parser dependency needed.
 */
export async function fetchRssItems(
  url: string,
  options?: { timeoutMs?: number; limit?: number },
): Promise<RssItem[]> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = options?.limit ?? 10;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Nexus-Agent/1.0',
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RSS fetch failed with status ${response.status}`);
    }

    const xml = await response.text();
    const items: RssItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
      const block = match[1]!;
      const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim() ?? '';
      const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() ?? '';
      const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() ?? '';

      if (title) {
        items.push({ title, link, pubDate });
      }
    }

    return items;
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`RSS fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
```

**Validate:** `npm run lint && npx tsc --noEmit`

---

### Step 3 — Expand Types

**File:** `lib/agents/types.ts`

**Why:** The report type (`MacroSummaryReport`) is the contract between the blueprint, the Discord embed renderer, and the database. New analysis sections need new fields.

**3a.** Add three new interfaces. Find this line (around line 86):

```ts
export interface ScheduledCatalyst {
```

Add **above** it:

```ts
export interface FredDataPoint {
  seriesId: string;
  label: string;
  date: string;
  value: number | null;
}

export interface KeyLevel {
  ticker: string;
  support: string;
  resistance: string;
  note: string;
}

export interface ScenarioAnalysis {
  consensus: string;
  disruption: string;
}

```

**3b.** Replace the `MacroSummaryReport` interface. Find (lines 88–99):

```ts
export interface MacroSummaryReport {
  tradingDate: string;
  marketBias: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  drivers: MacroDriver[];
  crossAssetSnapshot: CrossAssetEntry[];
  scheduledCatalysts: ScheduledCatalyst[];
  sectorRotation: string[];
  deskImplications: string[];
  sourceIndex: MacroSource[];
  confidence: Confidence;
}
```

Replace with:

```ts
export interface MacroSummaryReport {
  tradingDate: string;
  marketBias: 'bullish' | 'bearish' | 'neutral';
  summary: string;
  riskAssessment: string;
  drivers: MacroDriver[];
  crossAssetSnapshot: CrossAssetEntry[];
  keyLevels: KeyLevel[];
  ratesOutlook: string;
  fredData: FredDataPoint[];
  scheduledCatalysts: ScheduledCatalyst[];
  sectorRotation: string[];
  scenarioAnalysis: ScenarioAnalysis;
  deskImplications: string[];
  sourceIndex: MacroSource[];
  confidence: Confidence;
  tldr: string[];
}
```

**Validate:** `npm run lint && npx tsc --noEmit` — expect type errors in `discord.ts` and the blueprint until those files are updated in later steps. That's fine.

---

### Step 4 — Update Blueprint

**File:** `lib/agents/blueprints/orchestrator-macro-summary.ts`

This is the main change. Follow sub-steps in order.

#### 4a. Add imports

Find the existing import block at the top of the file (lines 1–12). Replace it with:

```ts
import { z } from 'zod';
import { fetchUnifiedSnapshot, fetchDailyAggregates, type MassiveSnapshotResult } from '@/lib/massive-market';
import { writeAndDeliverReport } from '../discord';
import { fetchFredSeries } from '../fred-client';
import { callLlm } from '../llm-client';
import { fetchRssItems } from '../rss-lite';
import { fetchPageText } from '../scrape-lite';
import type {
  Blueprint,
  CrossAssetEntry,
  FredDataPoint,
  MacroSource,
  MacroSummaryReport,
  StepResult,
} from '../types';
```

#### 4b. Update constants

Find the constants (lines 14–15):

```ts
const DEFAULT_MACRO_HEADLINES_URLS = 'https://www.marketwatch.com/latest-news,https://finance.yahoo.com/topic/stock-market-news/';
const MACRO_TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLE', 'XLF', 'XLK', 'GLD', 'USO', 'TLT'];
```

Replace with:

```ts
const DEFAULT_MACRO_HEADLINES_URLS = 'https://www.marketwatch.com/latest-news,https://finance.yahoo.com/topic/stock-market-news/';
const DEFAULT_MACRO_RSS_URLS = 'https://cms.zerohedge.com/fullrss2.xml';
const MACRO_TICKERS = [
  'SPY', 'QQQ', 'IWM', 'DIA',
  'XLE', 'XLF', 'XLK', 'GLD', 'USO', 'TLT',
  'UVXY', 'UUP', 'SMH', 'IEF', 'HYG', 'EEM', 'BITO',
];
const KEY_LEVEL_TICKERS = ['SPY', 'QQQ', 'IWM'];
const FRED_SERIES = ['DGS10', 'DGS2', 'T10Y2Y', 'FEDFUNDS'];
```

**Why the new tickers:**
- `UVXY` — VIX proxy (volatility = risk sentiment)
- `UUP` — US Dollar index ETF (dollar strength affects everything)
- `SMH` — Semiconductor ETF (market bellwether)
- `IEF` — 7-10 Year Treasury ETF (rate proxy)
- `HYG` — High Yield Bond ETF (credit risk appetite)
- `EEM` — Emerging Markets ETF (global risk)
- `BITO` — Bitcoin ETF (crypto correlation)

#### 4c. Update headlinesSchema

Find (lines 21–26):

```ts
const headlinesSchema = z.object({
  headlines: z.array(z.object({
    url: z.string(),
    text: z.string(),
  })),
});
```

Replace with:

```ts
const rssItemSchema = z.object({
  title: z.string(),
  link: z.string(),
  pubDate: z.string(),
});

const headlinesSchema = z.object({
  headlines: z.array(z.object({
    url: z.string(),
    text: z.string(),
  })),
  rssHeadlines: z.array(rssItemSchema),
});
```

#### 4d. Update macroBriefingSchema (LLM output)

Find (lines 28–44):

```ts
const macroBriefingSchema = z.object({
  marketBias: z.enum(['bullish', 'bearish', 'neutral']),
  summary: z.string(),
  drivers: z.array(z.object({
    driver: z.string(),
    impact: z.enum(['positive', 'negative', 'mixed']),
    sourceRefs: z.array(z.string().min(1)).min(1),
  })),
  scheduledCatalysts: z.array(z.object({
    event: z.string(),
    date: z.string().nullable(),
    expectedImpact: z.string(),
  })),
  sectorRotation: z.array(z.string()),
  deskImplications: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
});
```

Replace with:

```ts
const keyLevelSchema = z.object({
  ticker: z.string(),
  support: z.string(),
  resistance: z.string(),
  note: z.string(),
});

const scenarioSchema = z.object({
  consensus: z.string(),
  disruption: z.string(),
});

const macroBriefingSchema = z.object({
  marketBias: z.enum(['bullish', 'bearish', 'neutral']),
  summary: z.string(),
  riskAssessment: z.string(),
  drivers: z.array(z.object({
    driver: z.string(),
    impact: z.enum(['positive', 'negative', 'mixed']),
    sourceRefs: z.array(z.string().min(1)).min(1),
  })),
  keyLevels: z.array(keyLevelSchema),
  ratesOutlook: z.string(),
  scheduledCatalysts: z.array(z.object({
    event: z.string(),
    date: z.string().nullable(),
    expectedImpact: z.string(),
  })),
  sectorRotation: z.array(z.string()),
  scenarioAnalysis: scenarioSchema,
  deskImplications: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
  tldr: z.array(z.string()),
});
```

#### 4e. Add enriched context schemas

Find the `macroBriefingContextSchema` definition (starts around line 46). It currently ends after the `sourceIndex` field. **After** `macroBriefingContextSchema`, add the enriched schema. Find the closing `});` of `macroBriefingContextSchema` and add after it:

```ts

const fredPointSchema = z.object({
  seriesId: z.string(),
  label: z.string(),
  date: z.string(),
  value: z.number().nullable(),
});

const dailyBarEntrySchema = z.object({
  ticker: z.string(),
  bars: z.array(z.object({
    date: z.string(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number(),
  })),
});

const enrichedMacroContextSchema = macroBriefingContextSchema.extend({
  fredData: z.array(fredPointSchema),
  dailyBars: z.array(dailyBarEntrySchema),
});
```

#### 4f. Update macroBriefingDraftSchema

Find the existing `macroBriefingDraftSchema` (lines 62–79). Replace the entire definition:

```ts
const macroBriefingDraftSchema = z.object({
  crossAssetSnapshot: macroBriefingContextSchema.shape.crossAssetSnapshot,
  sourceIndex: macroBriefingContextSchema.shape.sourceIndex,
  fredData: z.array(fredPointSchema),
}).extend(macroBriefingSchema.shape).superRefine((value, ctx) => {
  const sourceIds = new Set(value.sourceIndex.map((source) => source.id));

  value.drivers.forEach((driver, driverIndex) => {
    driver.sourceRefs.forEach((sourceRef, sourceRefIndex) => {
      if (!sourceIds.has(sourceRef)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['drivers', driverIndex, 'sourceRefs', sourceRefIndex],
          message: `Unknown macro source reference: ${sourceRef}`,
        });
      }
    });
  });
});
```

**What changed:** Added `fredData: z.array(fredPointSchema)` alongside `crossAssetSnapshot` and `sourceIndex` as code-merged (non-LLM-generated) fields in the draft. The `macroBriefingSchema.shape` spread now includes all the new LLM output fields.

#### 4g. Add getRssUrls helper

Find the `getHeadlineUrls` function (around line 130). Add this new function right after it:

```ts

function getRssUrls(): string[] {
  return (process.env.MACRO_RSS_URLS ?? DEFAULT_MACRO_RSS_URLS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}
```

#### 4h. Update scrape-headlines step

Find the `scrape-headlines` step (starts around line 218). Replace the entire step object:

```ts
    {
      name: 'scrape-headlines',
      type: 'code',
      outputSchema: headlinesSchema,
      metadata: { canRetry: true, timeoutMs: 30000, maxRepairAttempts: 0, sideEffect: false },
      run: async () => {
        const startedAt = Date.now();
        const urls = getHeadlineUrls();
        const headlines = [];

        for (const url of urls) {
          try {
            const text = await fetchPageText(url);
            headlines.push({ url, text: text.slice(0, 8000) });
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            headlines.push({ url, text: `[fetch failed: ${detail}]` });
          }
        }

        const rssUrls = getRssUrls();
        const rssHeadlines: z.infer<typeof rssItemSchema>[] = [];
        for (const rssUrl of rssUrls) {
          try {
            const items = await fetchRssItems(rssUrl);
            rssHeadlines.push(...items);
          } catch {
            // Gracefully skip failed RSS feeds — pipeline continues without RSS data
          }
        }

        return completedResult({ headlines, rssHeadlines }, {
          durationMs: Date.now() - startedAt,
          sourceIds: [...urls, ...rssUrls],
        });
      },
    },
```

**What changed:** Timeout bumped from 20000→30000 to accommodate RSS fetches. Added RSS fetch loop after page headlines. Output now includes `rssHeadlines`. RSS failures are silently swallowed (the pipeline doesn't depend on RSS data).

#### 4i. Add fetch-macro-context step

This is a **new** step. Insert it between `fetch-market-snapshot` and `generate-briefing`. Find the closing `},` of the `fetch-market-snapshot` step and add this step after it:

```ts
    {
      name: 'fetch-macro-context',
      type: 'code',
      metadata: { canRetry: true, timeoutMs: 20000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput }) => {
        const startedAt = Date.now();
        const context = macroBriefingContextSchema.parse(previousOutput);

        // Fetch FRED data (graceful degrade if key missing or API fails)
        let fredData: FredDataPoint[] = [];
        try {
          fredData = await fetchFredSeries(FRED_SERIES);
        } catch {
          // FRED unavailable — continue without rates data
        }

        // Fetch daily OHLC bars for key level identification
        let dailyBars: z.infer<typeof dailyBarEntrySchema>[] = [];
        if (process.env.MASSIVE_API_KEY?.trim()) {
          const settled = await Promise.allSettled(
            KEY_LEVEL_TICKERS.map(async (ticker) => ({
              ticker,
              bars: (await fetchDailyAggregates(ticker, 5)).map((bar) => ({
                date: bar.date,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
              })),
            })),
          );
          dailyBars = settled
            .filter((r): r is PromiseFulfilledResult<z.infer<typeof dailyBarEntrySchema>> =>
              r.status === 'fulfilled')
            .map((r) => r.value);
        }

        // Extend source index with RSS and FRED source entries
        const fetchedAt = new Date().toISOString();
        const rssUrls = getRssUrls();
        const extendedSourceIndex: MacroSource[] = [
          ...context.sourceIndex,
          ...rssUrls.map((url) => {
            let hostname = 'rss-source';
            try { hostname = new URL(url).hostname; } catch { /* ignore */ }
            return {
              id: `rss:${hostname}`,
              title: `${hostname} RSS`,
              url,
              fetchedAt,
            };
          }),
          ...(fredData.length > 0 ? [{
            id: 'data:fred',
            title: 'FRED Economic Data',
            url: 'https://fred.stlouisfed.org' as string | null,
            fetchedAt,
          }] : []),
        ];

        return completedResult({
          ...context,
          sourceIndex: extendedSourceIndex,
          fredData,
          dailyBars,
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: [
            ...(fredData.length > 0 ? ['fred'] : []),
            ...KEY_LEVEL_TICKERS,
          ],
          upstreamStepIds: ['fetch-market-snapshot'],
        });
      },
    },
```

**What this step does:**
1. Fetches FRED series data in parallel (4 series, ~5s). Returns empty if `FRED_API_KEY` not set.
2. Fetches 5-day daily OHLC bars for SPY, QQQ, IWM in parallel (~5s). Skipped if `MASSIVE_API_KEY` not set.
3. Extends the `sourceIndex` with RSS feed sources and FRED source entry (so drivers can reference them in `sourceRefs`).
4. Passes everything forward to the LLM step.

#### 4j. Update generate-briefing step

Find the `generate-briefing` step. Make these changes:

**Change 1:** Update `inputSchema` from `macroBriefingContextSchema` to `enrichedMacroContextSchema`:

```ts
      inputSchema: enrichedMacroContextSchema,
```

**Change 2:** In the `run` function, change the parse call:

```ts
        const input = enrichedMacroContextSchema.parse(previousOutput);
```

**Change 3:** In the `macroBriefingDraftSchema.parse(...)` call, add `fredData`:

```ts
        const briefing = macroBriefingDraftSchema.parse({
          crossAssetSnapshot: input.crossAssetSnapshot,
          sourceIndex: input.sourceIndex,
          fredData: input.fredData,
          ...macroBriefingSchema.parse(parseJson(llmResponse.content)),
        });
```

**Change 4:** Update `upstreamStepIds` from `['fetch-market-snapshot']` to `['fetch-macro-context']`.

#### 4k. Rewrite buildBriefingPrompt

Replace the entire `buildBriefingPrompt` function (lines 176–207) with:

```ts
function buildBriefingPrompt(
  tradingDate: string,
  input: z.infer<typeof enrichedMacroContextSchema>,
): string {
  const sections: string[] = [
    `Trading date: ${tradingDate}`,
    '',
    'You are writing a pre-market macro analysis for active day traders. This is read before the bell — be specific, actionable, and data-driven. Do NOT pad with generic filler; every sentence must contain specific data or analysis.',
    '',
    'Return strict JSON with this shape and no markdown:',
    JSON.stringify({
      marketBias: 'bullish | bearish | neutral',
      summary: '2-3 sentence executive summary of the macro setup',
      riskAssessment: '2-4 sentences on the risk environment — what is driving risk-on or risk-off, cross-asset signals, where conviction is highest or lowest',
      drivers: [{
        driver: 'market-moving headline or driver',
        impact: 'positive | negative | mixed',
        sourceRefs: ['headline:marketwatch.com'],
      }],
      keyLevels: [{
        ticker: 'SPY',
        support: 'price level (e.g. 520.00)',
        resistance: 'price level (e.g. 535.00)',
        note: 'why these levels matter — reference recent price action from daily bars',
      }],
      ratesOutlook: '1-2 sentences on rates environment and equity implications — reference actual FRED values when available',
      scheduledCatalysts: [{
        event: 'scheduled catalyst',
        date: 'YYYY-MM-DD or null',
        expectedImpact: 'brief description',
      }],
      sectorRotation: ['sector rotation note with specific tickers or ETFs'],
      scenarioAnalysis: {
        consensus: 'what plays out if the base case holds — be specific with levels and sectors',
        disruption: 'what breaks the thesis and consequences — be specific',
      },
      deskImplications: ['specific, actionable trading implication'],
      confidence: 'high | medium | low',
      tldr: ['2-4 bullet points — start with overall bias, end with what to watch today'],
    }, null, 2),
    '',
    'Rules:',
    '- Every driver must include at least one sourceRefs entry matching an id from sourceIndex.',
    '- keyLevels: focus on SPY, QQQ, IWM. Use the daily OHLC bars to identify meaningful support/resistance (recent swing highs/lows, prior day close, round numbers). Include specific price levels.',
    '- scenarioAnalysis: consensus is the base case, disruption is what breaks it. Both must reference specific data.',
    '- tldr: what someone reads if they read nothing else. Every bullet must be specific and actionable.',
    '',
    `Headlines:\n${JSON.stringify(input.headlines, null, 2)}`,
    '',
    `RSS Headlines:\n${JSON.stringify(input.rssHeadlines, null, 2)}`,
    '',
    `Cross-asset snapshot:\n${JSON.stringify(input.crossAssetSnapshot, null, 2)}`,
  ];

  if (input.fredData.length > 0) {
    sections.push('', `FRED rates data:\n${JSON.stringify(input.fredData, null, 2)}`);
  }

  if (input.dailyBars.length > 0) {
    sections.push('', `Recent daily OHLC bars (use for key level identification):\n${JSON.stringify(input.dailyBars, null, 2)}`);
  }

  sections.push(
    '',
    `Source index:\n${JSON.stringify(input.sourceIndex, null, 2)}`,
    '',
    `Market snapshot:\n${JSON.stringify(input.snapshot, null, 2)}`,
  );

  if (input.note) {
    sections.push(`Snapshot note: ${input.note}`);
  }

  return sections.join('\n');
}
```

**Key differences from original prompt:**
- Instructs the LLM to write a "pre-market macro analysis for active day traders" (not just a summary)
- Explicitly tells it not to use filler — every sentence must have data or analysis
- New output fields: `riskAssessment`, `keyLevels`, `ratesOutlook`, `scenarioAnalysis`, `tldr`
- Passes RSS headlines and FRED data as separate context sections
- Passes daily OHLC bars for key level identification
- Rules section gives specific guidance on how to use each data source

**Validate:** `npm run lint && npx tsc --noEmit`

---

### Step 5 — Update Orchestrator Prompt

**File:** `lib/agents/prompts/orchestrator.md`

Find the `## Macro Briefing` section (lines 16–22). Replace it with:

```md
## Macro Briefing
- Daily macro analyses synthesize headlines, RSS feeds, cross-asset data, FRED rates, and recent price bars into a structured pre-market briefing.
- Return JSON with: `marketBias`, `summary`, `riskAssessment`, `drivers`, `keyLevels`, `ratesOutlook`, `scheduledCatalysts`, `sectorRotation`, `scenarioAnalysis`, `deskImplications`, `confidence`, `tldr`.
- Every `driver` must include at least one `sourceRefs` entry matching an id from `sourceIndex`.
- `riskAssessment` is the core analytical section — 2-4 sentences synthesizing cross-asset signals into a risk narrative. Not a summary — an analysis.
- `keyLevels` must reference actual prices from the daily bars data. Focus on SPY, QQQ, IWM.
- `scenarioAnalysis` provides consensus (base case) and disruption (what breaks it). Both must be specific and data-referenced.
- `tldr` is 2-4 bullets — start with bias, end with what to watch. Assume the reader sees nothing else.
- Be concise — traders read this before the bell.
```

---

### Step 6 — Update Discord Embed

**File:** `lib/agents/discord.ts`

**6a.** Update the import to include new types. Find (lines 5–11):

```ts
import type {
  AgentId,
  AgentReport,
  MacroSummaryReport,
  SmallCapResearchReport,
  SwingResearchReport,
} from './types';
```

Replace with:

```ts
import type {
  AgentId,
  AgentReport,
  FredDataPoint,
  MacroSummaryReport,
  SmallCapResearchReport,
  SwingResearchReport,
} from './types';
```

**6b.** Replace the entire `buildMacroSummaryEmbed` function (lines 536–577) with:

```ts
export function buildMacroSummaryEmbed(report: AgentReport): DiscordEmbed {
  const payload = report.reportJson as MacroSummaryReport;
  const impactEmoji = (impact: MacroSummaryReport['drivers'][number]['impact']): string => {
    if (impact === 'positive') return '\u{1F7E2}';
    if (impact === 'negative') return '\u{1F534}';
    return '\u{1F7E1}';
  };

  const formatList = (values: string[] | undefined): string => (
    values && values.length > 0 ? values.map((value) => `\u2022 ${value}`).join('\n') : UNKNOWN_VALUE
  );

  const formatFredValue = (fp: FredDataPoint): string => {
    if (fp.value === null) return 'n/a';
    if (fp.seriesId === 'T10Y2Y') {
      const bps = Math.round(fp.value * 100);
      return `${bps >= 0 ? '+' : ''}${bps}bp`;
    }
    return `${fp.value.toFixed(2)}%`;
  };

  const fields: DiscordEmbedField[] = [
    buildField('Market Bias', payload.marketBias),
    buildField('Confidence', payload.confidence),
  ];

  // Risk Assessment
  if (payload.riskAssessment) {
    fields.push(buildField('Risk Assessment', payload.riskAssessment, false));
  }

  // Top Drivers
  fields.push(buildField(
    'Top Drivers',
    payload.drivers.length > 0
      ? payload.drivers.slice(0, 4).map((driver) => `${impactEmoji(driver.impact)} ${driver.driver}`).join('\n')
      : UNKNOWN_VALUE,
    false,
  ));

  // Key Levels
  if (payload.keyLevels && payload.keyLevels.length > 0) {
    fields.push(buildField(
      'Key Levels',
      payload.keyLevels.map((kl) =>
        `**${kl.ticker}**: ${kl.support} / ${kl.resistance} \u2014 ${kl.note}`).join('\n'),
      false,
    ));
  }

  // Rates — show FRED values + LLM outlook
  if (payload.fredData && payload.fredData.length > 0) {
    const ratesLine = payload.fredData.map((fp) => `${fp.label}: ${formatFredValue(fp)}`).join(' | ');
    const ratesText = payload.ratesOutlook
      ? `${ratesLine}\n${payload.ratesOutlook}`
      : ratesLine;
    fields.push(buildField('Rates', ratesText, false));
  } else if (payload.ratesOutlook) {
    fields.push(buildField('Rates', payload.ratesOutlook, false));
  }

  // Catalysts
  fields.push(buildField(
    'Catalysts',
    payload.scheduledCatalysts.length > 0
      ? payload.scheduledCatalysts.map((catalyst) => {
        const when = catalyst.date ? ` (${catalyst.date})` : '';
        return `\u2022 ${catalyst.event}${when} \u2014 ${catalyst.expectedImpact}`;
      }).join('\n')
      : UNKNOWN_VALUE,
    false,
  ));

  // Sector Rotation
  fields.push(buildField('Sector Rotation', formatList(payload.sectorRotation), false));

  // Scenarios
  if (payload.scenarioAnalysis) {
    fields.push(buildField(
      'Scenarios',
      `\u2705 **Consensus:** ${payload.scenarioAnalysis.consensus}\n\u26A0\uFE0F **Disruption:** ${payload.scenarioAnalysis.disruption}`,
      false,
    ));
  }

  // Desk Implications
  fields.push(buildField('Desk Implications', formatList(payload.deskImplications), false));

  // TLDR
  if (payload.tldr && payload.tldr.length > 0) {
    fields.push(buildField('TLDR', formatList(payload.tldr), false));
  }

  return buildBaseEmbed(
    report,
    fields,
    payload.summary,
  );
}
```

**What changed:**
- New fields: Risk Assessment, Key Levels, Rates (with FRED values + outlook), Scenarios, TLDR
- FRED values formatted intelligently — percentages for yields, basis points for spreads
- All new sections use optional chaining and conditional rendering so old reports (without new fields) still render without errors
- Drivers now show up to 4 (was 3)
- Uses unicode characters directly (bullet `\u2022`, em-dash `\u2014`, checkmark `\u2705`, warning `\u26A0\uFE0F`)

**Validate:** `npm run lint && npx tsc --noEmit`

---

### Step 7 — Update Tests

Update test fixtures in these files to include the new schema fields:

- `__tests__/agent-blueprints.test.ts` — blueprint step contract tests
- `__tests__/agent-discord.test.ts` — embed rendering tests
- `__tests__/agent-macro-summary-route.test.ts` — macro summary route tests
- `__tests__/agent-context.test.ts` — context/report tests

**For any test fixture that constructs a `MacroSummaryReport`**, add these new fields with reasonable defaults:

```ts
riskAssessment: 'Test risk assessment.',
keyLevels: [{ ticker: 'SPY', support: '520', resistance: '535', note: 'test level' }],
ratesOutlook: 'Test rates outlook.',
fredData: [{ seriesId: 'DGS10', label: '10Y Treasury', date: '2026-04-11', value: 4.32 }],
scenarioAnalysis: { consensus: 'Test consensus.', disruption: 'Test disruption.' },
tldr: ['Test TLDR bullet.'],
```

**For any test fixture that constructs a `headlinesSchema` output**, add:

```ts
rssHeadlines: [],
```

**For any test that validates the `macroBriefingDraftSchema` or the briefing output**, add the new fields to the expected output.

**Do not delete or skip failing tests — update them.**

**Validate:** `npm run lint && npx tsc --noEmit && npm test`

---

### Step 8 — Final Validation

After all steps:

```bash
npm run lint && npx tsc --noEmit && npm test
```

All tests must pass. Note the final test count in a checkpoint comment below.

---

## Future Phases (Not Yet Planned)

### Phase 2 — Additional Data Sources

- **Finviz sector heatmap** — scrape sector performance data for more precise sector rotation analysis
- **CME FedWatch** — rate cut/hike probability data from CME Group (scrapable)
- **CNN Fear & Greed Index** — composite sentiment indicator
- **Google News RSS** — topic-specific macro news feeds (free, no API key)
- Additional RSS feeds (Reuters, CNBC) for broader source diversity

### Phase 3 — Polish & Intelligence

- **Historical comparison** — include yesterday's bias/levels/rates for delta analysis ("10Y up 5bp from yesterday")
- **Conditional sections** — skip rates section if FRED unavailable; skip key levels if no daily bars
- **Report quality scoring** — automated check on output quality (did the LLM cite sources? are key levels within recent price range?)
- **Intraday update** — optional mid-day macro update at 12:30 PM ET with session-so-far analysis
