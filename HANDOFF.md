# Nexus Terminal — HANDOFF.md

> Older completed execution specs have been collapsed to summaries. Use git history for archived implementation detail (Swing-Trader Massive News integration completed 2026-04-14; Macro Daily Pipeline Phase 1 completed 2026-04-13; P2 agent response improvements, T1.1–T1.3 specialist blueprints completed 2026-04-13).

---

## Macro Daily Pipeline Enhancement — Phase 1 (Summary)

> Generated: 2026-04-13
> Status: COMPLETED 2026-04-13

Transformed the macro daily briefing from a thin summary (bias + drivers + catalysts) into a comprehensive pre-market macro analysis.

**What shipped:**

1. **New data sources** — FRED API client (`lib/agents/fred-client.ts`) for Treasury yields and Fed Funds rate; lightweight RSS parser (`lib/agents/rss-lite.ts`) for ZeroHedge headlines; 5-day daily OHLC bars for key level identification.
2. **Expanded ticker universe** — added `UVXY`, `UUP`, `SMH`, `IEF`, `HYG`, `EEM`, `BITO` (7 new tickers via existing Massive API).
3. **Deeper output schema** — `MacroSummaryReport` gained `riskAssessment`, `keyLevels`, `ratesOutlook`, `fredData`, `scenarioAnalysis`, `tldr`.
4. **Pipeline + prompt rewrite** — new `fetch-macro-context` step runs FRED + OHLC in parallel, extends `sourceIndex` with RSS/FRED sources, and the LLM prompt was rewritten for deeper analysis (no filler, data-first). The Discord embed renders all new sections with conditional rendering for optional fields.

**Env vars introduced:** `FRED_API_KEY` (optional), `MACRO_RSS_URLS` (optional, defaults to ZeroHedge).

**Files touched:** `lib/agents/fred-client.ts` (new), `lib/agents/rss-lite.ts` (new), `lib/agents/types.ts`, `lib/agents/blueprints/orchestrator-macro-summary.ts`, `lib/agents/discord.ts`, `lib/agents/prompts/orchestrator.md`, plus test fixtures.

**Guardrails honored:** zero schema/migration changes, zero new npm deps, all fetches graceful-degrade, pipeline produces a valid report with no env vars set.

---

## Macro Daily Pipeline Enhancement — Phase 2

> Generated: 2026-04-15
> Status: READY FOR CODEX
> Scope: 1 new file, 5 files modified, no new npm deps, no DB/migration changes, no new env vars
> Dependency: Phase 1 (COMPLETED 2026-04-13)

### Objective

Add four new data sources to the macro daily pipeline:

- **Alternative.me Fear & Greed Index** — public JSON API (crypto-derived composite sentiment), replaces the originally scoped CNN Fear & Greed (which is JS-only).
- **MarketWatch Top Stories RSS** via the Dow Jones CDN (`feeds.content.dowjones.io/public/rss/mw_topstories`).
- **NBC News Business RSS** (`feeds.nbcnews.com/nbcnews/public/business`).
- **Google News macro RSS** (`news.google.com/rss/search?q=federal+reserve+macro+economy&...`) — aggregates Reuters, AP, FT, CNBC, etc.

Bundle the Fear & Greed fetch into a new `fetch-sentiment` pipeline step. Append the three RSS feeds to `DEFAULT_MACRO_RSS_URLS` so the existing `scrape-headlines` step picks them up with no new code path. Extend `MacroSummaryReport` with an optional `sentimentData` field. Update the LLM prompt and Discord embed to consume and display the new data. All fetches are non-fatal — the pipeline produces a valid report if every new fetch fails.

### Sources Researched And Dropped

| Source | Status | Reason |
|--------|--------|--------|
| Finviz sector heatmap | DROPPED | JS-rendered only; static HTML contains no sector performance values. |
| CME FedWatch | DROPPED | Page and `getMeetingProbabilities.json` both timed out; heavily JS-rendered, no stable public data API. |
| CNN Fear & Greed | DROPPED (replaced) | JS-rendered, no numeric score in HTML. Replaced by Alternative.me. |
| Reuters RSS | DROPPED | `feeds.reuters.com` connection-refused (Reuters no longer exposes public RSS). |
| CNBC RSS | DROPPED | Returns 403. |
| MarketWatch `feeds.marketwatch.com` | DROPPED (replaced) | Subdomain blocked. Replaced by Dow Jones CDN feed that powers the same content. |

### Observed Current State

- Pipeline step order: `scrape-headlines` -> `fetch-market-snapshot` -> `fetch-macro-context` -> `generate-briefing` -> `save-summary`.
- `scrape-headlines` fetches page text from `MACRO_HEADLINES_URLS` and RSS from `MACRO_RSS_URLS` (current default: ZeroHedge only).
- `fetch-macro-context` fetches FRED series + daily OHLC bars and extends `sourceIndex`.
- `MacroSummaryReport` in `lib/agents/types.ts` has no `sentimentData` field.
- `buildMacroSummaryEmbed` in `lib/agents/discord.ts` renders 14 fields; no sentiment section.
- `buildBriefingPrompt` includes sections for Headlines, RSS Headlines, Cross-asset, FRED, Daily OHLC, Source index. No sentiment section.
- `DEFAULT_MACRO_RSS_URLS` is a single-URL string constant.
- Tests in `__tests__/agent-blueprints.test.ts` mock `fetchPageText` and `callLlm`. The `generate-briefing` test passes a `previousOutput` fixture containing `headlines`, `rssHeadlines`, `snapshot`, `note`, `crossAssetSnapshot`, `fredData`, `dailyBars`, `sourceIndex` — this fixture needs `sentimentData` added.

### Decisions Locked

- **D1. Alternative.me, not CNN.** CNN is JS-only. Alternative.me is a public JSON API (0–100 score + classification). The index is crypto-derived so it acts as a divergent/leading signal for equities — the prompt explicitly tells the LLM to treat it that way.
- **D2. Google News, MarketWatch CDN, NBC Business go into `rssHeadlines` via `DEFAULT_MACRO_RSS_URLS`, not a new field.** They are structurally identical to ZeroHedge RSS. No schema expansion for feed URLs.
- **D3. Fear & Greed is a separate step (`fetch-sentiment`), not merged into `fetch-macro-context`.** Different domain, cleaner failure scope.
- **D4. `sentimentData` is optional on `MacroSummaryReport`.** Old DB rows lack it — consumers must use `?.` access.
- **D5. Token shape for Fear & Greed: `{ score, classification, source }` only.** Never pass the raw JSON blob.
- **D6. RSS limit stays at 10 per feed.** Three extra feeds = ~30 more headlines. Acceptable token cost for source diversity.
- **D7. No new env vars.** All new sources are public / unauthenticated. Fear & Greed is always attempted; failures are silent.

### Files To Modify

| File | Action | Notes |
|------|--------|-------|
| `lib/agents/types.ts` | Modify | Add `SentimentDataPoint` interface; add `sentimentData?: SentimentDataPoint` to `MacroSummaryReport`. |
| `lib/agents/sentiment-client.ts` | **NEW** | Fear & Greed fetcher (~40 lines); imports `SentimentDataPoint` from `./types`. |
| `lib/agents/blueprints/orchestrator-macro-summary.ts` | Modify | Extend RSS defaults; add `fetch-sentiment` step; extend schemas; thread data into prompt + draft. |
| `lib/agents/discord.ts` | Modify | Render `sentimentData` in `buildMacroSummaryEmbed` with optional-chaining guards. |
| `lib/agents/prompts/orchestrator.md` | Modify | Add `sentimentData` field description and LLM usage rules. |
| `__tests__/agent-blueprints.test.ts` | Modify | Mock `fetchFearGreedIndex`; add `fetch-sentiment` step tests; update `generate-briefing` fixture with `sentimentData`. |
| `__tests__/agent-discord.test.ts` | Modify | Add embed tests for sentiment present/absent. |

### Ordered Work

**Step 1 — Extend `lib/agents/types.ts` (do this first so Step 2 can import cleanly).**

Add this interface near the other shared types (above `MacroSource`, around line 63):

```ts
export interface SentimentDataPoint {
  score: number;
  classification: string;
  source: string;
}
```

In `MacroSummaryReport`, add one optional field after `fredData: FredDataPoint[];`:

```ts
sentimentData?: SentimentDataPoint;
```

Validate: `npm run lint && npx tsc --noEmit`

**Step 2 — Create `lib/agents/sentiment-client.ts` (NEW FILE).**

```ts
import type { SentimentDataPoint } from './types';

const FEAR_GREED_URL = 'https://api.alternative.me/fng/?limit=1&format=json';
const DEFAULT_TIMEOUT_MS = 8_000;

interface FngApiResponse {
  data?: Array<{
    value?: string;
    value_classification?: string;
  }>;
  metadata?: { error: null | string };
}

/**
 * Fetch the Alternative.me Fear & Greed Index.
 * Returns null on any failure — caller must handle gracefully.
 * Note: This index is crypto-derived (tracks BTC sentiment correlates).
 * Treat as a divergent/leading signal for equities, not an equities-direct reading.
 */
export async function fetchFearGreedIndex(
  options?: { timeoutMs?: number },
): Promise<SentimentDataPoint | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(FEAR_GREED_URL, {
      headers: { 'User-Agent': 'Nexus-Agent/1.0' },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const json = (await response.json()) as FngApiResponse;
    const entry = json.data?.[0];
    const rawValue = entry?.value?.trim();
    const classification = entry?.value_classification?.trim();

    if (!rawValue || !classification) return null;

    const score = Number(rawValue);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;

    return { score, classification, source: 'alternative.me/fng' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

Validate: `npm run lint && npx tsc --noEmit`

**Step 3 — Extend RSS defaults in `lib/agents/blueprints/orchestrator-macro-summary.ts`.**

Find:

```ts
const DEFAULT_MACRO_RSS_URLS = 'https://cms.zerohedge.com/fullrss2.xml';
```

Replace with:

```ts
const DEFAULT_MACRO_RSS_URLS = [
  'https://cms.zerohedge.com/fullrss2.xml',
  'https://feeds.content.dowjones.io/public/rss/mw_topstories',
  'https://feeds.nbcnews.com/nbcnews/public/business',
  'https://news.google.com/rss/search?q=federal+reserve+macro+economy&hl=en-US&gl=US&ceid=US:en',
].join(',');
```

At the top of the file, add imports:

```ts
import { fetchFearGreedIndex } from '../sentiment-client';
import type { SentimentDataPoint } from '../types';
```

**Step 4 — Add sentiment schemas in the same blueprint file.**

After `enrichedMacroContextSchema` (around line 115) add:

```ts
const sentimentDataSchema = z.object({
  score: z.number().min(0).max(100),
  classification: z.string(),
  source: z.string(),
});

const sentimentEnrichedContextSchema = enrichedMacroContextSchema.extend({
  sentimentData: sentimentDataSchema.nullable(),
});
```

In the `macroBriefingDraftSchema` `.extend({...})` block, add after `fredData`:

```ts
sentimentData: sentimentDataSchema.nullable().optional(),
```

**Step 5 — Add the `fetch-sentiment` step.**

Insert between `fetch-macro-context` and `generate-briefing`:

```ts
{
  name: 'fetch-sentiment',
  type: 'code',
  inputSchema: enrichedMacroContextSchema,
  outputSchema: sentimentEnrichedContextSchema,
  metadata: { canRetry: true, timeoutMs: 12000, maxRepairAttempts: 0, sideEffect: false },
  run: async ({ previousOutput }) => {
    const startedAt = Date.now();
    const context = enrichedMacroContextSchema.parse(previousOutput);

    let sentimentData: SentimentDataPoint | null = null;
    try {
      sentimentData = await fetchFearGreedIndex();
    } catch {
      // Fear & Greed unavailable - continue without sentiment data
    }

    const fetchedAt = new Date().toISOString();
    const extendedSourceIndex: MacroSource[] = [
      ...context.sourceIndex,
      ...(sentimentData !== null ? [{
        id: 'data:fear-greed',
        title: 'Alternative.me Fear & Greed Index',
        url: 'https://alternative.me/crypto/fear-and-greed-index/' as string | null,
        fetchedAt,
      }] : []),
    ];

    return completedResult({
      ...context,
      sourceIndex: extendedSourceIndex,
      sentimentData,
    }, {
      durationMs: Date.now() - startedAt,
      sourceIds: sentimentData !== null ? ['fear-greed'] : [],
      upstreamStepIds: ['fetch-macro-context'],
    });
  },
},
```

**Step 6 — Update `generate-briefing` to consume sentiment.**

Change its `inputSchema` to `sentimentEnrichedContextSchema`. Change the `parse` call inside `run` to match. Then, in the draft assembly, add `sentimentData` alongside the existing threaded fields:

```ts
const briefing = macroBriefingDraftSchema.parse({
  crossAssetSnapshot: input.crossAssetSnapshot,
  sourceIndex: input.sourceIndex,
  fredData: input.fredData,
  sentimentData: input.sentimentData,
  ...macroBriefingSchema.parse(parseJson(llmResponse.content)),
});
```

**Step 7 — Update `buildBriefingPrompt`.**

Change its parameter type to `z.infer<typeof sentimentEnrichedContextSchema>`. Add a sentiment section before the Source index section:

```ts
if (input.sentimentData !== null && input.sentimentData !== undefined) {
  sections.push(
    '',
    `Sentiment (crypto-derived Fear & Greed Index — use as a divergent/leading signal, not an equities-direct reading):\nScore: ${input.sentimentData.score}/100 — ${input.sentimentData.classification}\nSource: ${input.sentimentData.source}`,
  );
}
```

Add this rule to the `Rules:` array:

```ts
'- sentimentData (when present): reference the score and classification in riskAssessment and deskImplications. High fear (score < 30) is often contrarian bullish for equities; extreme greed (score > 75) warrants caution. Note: this index tracks crypto sentiment correlates, not pure equities.',
```

**Step 8 — Render sentiment in `lib/agents/discord.ts`.**

In `buildMacroSummaryEmbed`, after the rates block (around line 608) add:

```ts
if (payload.sentimentData && typeof payload.sentimentData === 'object') {
  const s = payload.sentimentData as { score?: unknown; classification?: unknown };
  const score = typeof s.score === 'number' ? s.score : null;
  const classification = typeof s.classification === 'string' ? s.classification.trim() : null;
  if (score !== null && classification) {
    fields.push(buildField('Fear & Greed', `${score}/100 — ${classification} *(crypto-derived)*`, false));
  }
}
```

**Step 9 — Update `lib/agents/prompts/orchestrator.md`.**

In the `## Macro Briefing` section, add a new bullet:

```
- `sentimentData` (optional, crypto-derived): when present, use the score and classification in `riskAssessment` and `deskImplications`. Scores < 30 = Extreme Fear / Fear (contrarian bullish signal for equities). Scores > 75 = Greed / Extreme Greed (caution warranted). This tracks crypto sentiment correlates — treat as a divergent signal, not an equities-direct reading.
```

**Step 10 — Update tests.**

`__tests__/agent-blueprints.test.ts`:

- Add a hoisted mock: `const fetchFearGreedIndexMock = vi.hoisted(() => vi.fn());`
- Mock the module: `vi.mock('@/lib/agents/sentiment-client', () => ({ fetchFearGreedIndex: fetchFearGreedIndexMock }));`
- Reset it in `beforeEach`/`afterEach` cleanup.
- Add a test that `fetch-sentiment` succeeds and emits `data:fear-greed` in `sourceIndex`.
- Add a test that a thrown error from `fetchFearGreedIndex` results in `sentimentData: null` and no pipeline abort.
- Update the `generate-briefing` test's `previousOutput` fixture with `sentimentData: null`. Assert the prompt does NOT contain "Fear & Greed" when null.
- Add a second variant with `sentimentData: { score: 23, classification: 'Extreme Fear', source: 'alternative.me/fng' }`. Assert the prompt DOES contain "Fear & Greed".
- If `blueprint.steps.length` is asserted anywhere, bump from 5 to 6.

`__tests__/agent-discord.test.ts`:

- Test that `buildMacroSummaryEmbed` renders a `Fear & Greed` field when `sentimentData` is present (value contains `23/100` and `Extreme Fear`).
- Test that no `Fear & Greed` field appears when `sentimentData` is absent (old report).

Validate: `npm run lint && npx tsc --noEmit && npm test`

### Acceptance Criteria

- `SentimentDataPoint` is defined in `lib/agents/types.ts`; `sentimentData?: SentimentDataPoint` is on `MacroSummaryReport`.
- `lib/agents/sentiment-client.ts` exports `fetchFearGreedIndex` and imports the type from `./types`.
- Pipeline step order becomes: `scrape-headlines` -> `fetch-market-snapshot` -> `fetch-macro-context` -> `fetch-sentiment` -> `generate-briefing` -> `save-summary`.
- `DEFAULT_MACRO_RSS_URLS` includes ZeroHedge, MarketWatch Dow Jones CDN, NBC News Business, and Google News macro search.
- `fetch-sentiment` is non-fatal: thrown errors result in `sentimentData: null`, not a pipeline abort.
- When `sentimentData` is non-null, `sourceIndex` gains a `data:fear-greed` entry.
- `buildBriefingPrompt` includes the Sentiment section only when `sentimentData` is non-null.
- `buildMacroSummaryEmbed` renders a `Fear & Greed` field when `sentimentData` is present; renders nothing (no crash) when absent.
- Old `MacroSummaryReport` rows without `sentimentData` do not cause runtime errors anywhere.
- `npm run lint && npx tsc --noEmit && npm test` all pass.

### Security Notes

- `api.alternative.me/fng` is a public unauthenticated endpoint. Do not log raw response bodies.
- Google News RSS links are Google redirect URLs — used for headline titles only, never followed server-side.
- No new environment variables. No secrets.

### Complexity

Low–medium. One new ~40-line file. Blueprint adds one step and extends two schemas. Test changes are mechanical (fixture fields + two new test cases per file).

---

## Macro Daily Pipeline Enhancement — Phase 3

> Generated: 2026-04-15
> Status: READY FOR CODEX
> Scope: 2 new files, 6 files modified, 0 schema/migration changes, 2 new optional env vars (`MACRO_INTRADAY_ENABLED`, `MACRO_INTRADAY_HOUR_ET`)
> Dependency: Phase 1 shipped 2026-04-13. Phase 3 can ship independently of Phase 2 — it only uses Phase 1 fields (`marketBias`, `keyLevels`, `fredData`, `tldr`).

### Objective

Four polish + intelligence improvements to the macro daily pipeline:

1. **Historical comparison** — pass yesterday's compact macro report into the LLM prompt so it writes delta sentences ("10Y at 4.35%, up 3bp from 4.32% yesterday").
2. **Conditional Discord embed sections** — stop rendering `n/a` placeholder fields. Skip Rates entirely when `fredData` is empty; skip Catalysts, Sector Rotation, Desk Implications when their arrays are empty.
3. **Report quality scoring** — post-LLM validation that checks source citation coverage, key level plausibility, and TLDR length. Logs warnings only; never blocks delivery.
4. **Intraday update blueprint** — optional 12:30 PM ET mid-day macro snapshot behind `MACRO_INTRADAY_ENABLED=1`. New short blueprint (5–6 fields) that compares the current session to the morning brief.

### Design Decisions

- **A. Add `deltas?: string[]` to `MacroSummaryReport`.** Keeps delta text structured (better testability, separate embed rendering). Optional field so old DB rows deserialize cleanly via `normalizeMacroSummaryReport` in `context.ts`.
- **B. Quality scoring logs warnings only; do not persist `qualityScore`.** `superRefine` already hard-fails on missing source ids. `console.warn` is enough for a feedback loop at this stage. Reconsider in a later phase if the signal proves valuable.
- **C. Intraday reuses `jobType: 'macro-summary'`** with a new `input.intradayUpdate: true` discriminator. `blueprintResolver` in `lib/agents/config.ts` branches on the flag. The `agent_scheduled_runs` cron uses a new `trigger_type: 'macro-intraday'` to avoid unique-constraint conflicts with the morning run.
- **D. Intraday is opt-in.** `MACRO_INTRADAY_ENABLED=1` is required to start the second cron; with the env var unset, the agent entrypoint behaves exactly as today.

### Observed Current State

- `fetch-macro-context` fetches FRED + daily OHLC but has no prior-day lookup.
- `lib/agents/context.ts` already knows how to query `agentReports` for the latest macro report. The query needed here is the same pattern with `createdAt < tradingDate` plus `limit(1)`.
- `MacroSummaryReport` has no `deltas` field.
- `buildMacroSummaryEmbed` in `lib/agents/discord.ts` has an orphan branch that renders `Rates` with text only when `fredData` is empty but `ratesOutlook` exists. This is the source of the "n/a-ish" fallback.
- `keyLevels` already has conditional rendering. `scheduledCatalysts`, `sectorRotation`, `deskImplications` do not — they always render, falling back to `'n/a'` when empty.
- `macroBriefingDraftSchema.superRefine` already validates every `driver.sourceRefs` against `sourceIndex`. Quality scoring is a soft cross-check.
- `keyLevels[i].support`/`resistance` are string fields. Numeric range checks must `parseFloat` and skip on `NaN`.
- `tldr` has no length constraint in the current schema.
- `lib/agents/macro-cron.ts` exports `startMacroCron`. A companion `startIntradayCron` needs the same shape but with a distinct `trigger_type`.
- `lib/agents/macro-cron.ts` references `AgentDb`, `unwrapRows`, `agentScheduledRuns`, `ScheduledRunRow` — confirmed to exist.
- `services/agent-entrypoint.ts` exists and calls `startMacroCron(db)`; this is where an intraday start call goes.
- `buildBaseEmbed`, `buildField`, `asRecord`, `readJsonValue`, `optionalText`, `formatBulletList` all exist in `lib/agents/discord.ts` — the intraday embed reuses them.

### Files To Modify

| File | Action | Notes |
|------|--------|-------|
| `lib/agents/types.ts` | Modify | Add `deltas?: string[]` to `MacroSummaryReport`. |
| `lib/agents/blueprints/orchestrator-macro-summary.ts` | Modify | Add `fetchPriorMacroReport()`; extend `enrichedMacroContextSchema` with `priorDay`; update prompt; add `deltas` to schemas; add `scoreReportQuality()`. |
| `lib/agents/discord.ts` | Modify | Tighten `buildMacroSummaryEmbed` (remove orphan rates branch, skip empty sections, add optional Deltas field); add `buildMacroIntradayEmbed`; route `macro-intraday` in `selectEmbed` and `resolveWebhookUrl`. |
| `lib/agents/macro-cron.ts` | Modify | Export `startIntradayCron`. |
| `lib/agents/config.ts` | Modify | Branch `blueprintResolver` on `input.intradayUpdate`. |
| `services/agent-entrypoint.ts` | Modify | Conditionally start intraday cron when `MACRO_INTRADAY_ENABLED=1`. |
| `lib/agents/blueprints/orchestrator-macro-intraday.ts` | **NEW** | Intraday blueprint: `fetch-session-snapshot` -> `generate-intraday-briefing` -> `save-intraday-summary`. |
| `__tests__/agent-blueprints.test.ts` | Modify | Update `generate-briefing` fixture with `priorDay: null`; add prior-day-present test; add quality scoring tests; update `save-summary` test with `deltas`. |
| `__tests__/agent-discord.test.ts` | Modify | Assert empty-section skipping; add `Deltas` field test; add `buildMacroIntradayEmbed` tests. |
| `__tests__/agent-macro-cron.test.ts` | Modify | Add `startIntradayCron` tests. |

### Ordered Work

**Step 1 — Add `deltas` to `MacroSummaryReport` in `lib/agents/types.ts`.**

In the `MacroSummaryReport` interface, add one optional field after `tldr`:

```ts
deltas?: string[];
```

Optional so existing DB rows deserialize unchanged. `normalizeMacroSummaryReport` needs no edit (arrays with fallback defaults already handle this shape).

Validate: `npm run lint && npx tsc --noEmit`

**Step 2 — Add `fetchPriorMacroReport()` helper in `orchestrator-macro-summary.ts`.**

Add imports at top:

```ts
import { and, desc, eq, lt } from 'drizzle-orm';
import { agentReports } from '@/lib/db/schema';
import type { AgentDb } from '../db';
```

Add the helper after `buildSourceIndex()` (around line 240):

```ts
/**
 * Fetches the most recent prior macro report from the DB.
 * Returns null on first run or if no prior report exists.
 * Passes only a compact shape to the prompt to avoid token bloat.
 */
async function fetchPriorMacroReport(
  db: AgentDb,
  tradingDate: string,
): Promise<{
  tradingDate: string;
  marketBias: string;
  dgs10: number | null;
  dgs2: number | null;
  spySupport: string | null;
  spyResistance: string | null;
  qqqSupport: string | null;
  qqqResistance: string | null;
} | null> {
  const [row] = await db
    .select({ reportJson: agentReports.reportJson })
    .from(agentReports)
    .where(
      and(
        eq(agentReports.userId, 'system-agent-user'),
        eq(agentReports.agentId, 'orchestrator'),
        eq(agentReports.reportType, 'macro-summary'),
        eq(agentReports.status, 'published'),
        lt(agentReports.createdAt, new Date(`${tradingDate}T00:00:00.000Z`)),
      ),
    )
    .orderBy(desc(agentReports.createdAt))
    .limit(1);

  if (!row?.reportJson) return null;

  const r = row.reportJson as Partial<MacroSummaryReport>;
  if (!r.marketBias || !r.tradingDate) return null;

  const dgs10 = r.fredData?.find((p) => p.seriesId === 'DGS10')?.value ?? null;
  const dgs2 = r.fredData?.find((p) => p.seriesId === 'DGS2')?.value ?? null;
  const spy = r.keyLevels?.find((l) => l.ticker === 'SPY');
  const qqq = r.keyLevels?.find((l) => l.ticker === 'QQQ');

  return {
    tradingDate: r.tradingDate,
    marketBias: r.marketBias,
    dgs10,
    dgs2,
    spySupport: spy?.support ?? null,
    spyResistance: spy?.resistance ?? null,
    qqqSupport: qqq?.support ?? null,
    qqqResistance: qqq?.resistance ?? null,
  };
}
```

In the `fetch-macro-context` step, destructure `jobInput, db` from the run args and call the helper:

```ts
run: async ({ previousOutput, jobInput, db }) => {
  // ... existing code ...
  const tradingDate = getTradingDate(jobInput);
  const priorDay = await fetchPriorMacroReport(db, tradingDate).catch(() => null);
  // ... fold priorDay into the returned context ...
}
```

**Step 3 — Extend schemas and thread `priorDay` + `deltas` through the pipeline.**

Before `enrichedMacroContextSchema`, add:

```ts
const priorDaySchema = z.object({
  tradingDate: z.string(),
  marketBias: z.string(),
  dgs10: z.number().nullable(),
  dgs2: z.number().nullable(),
  spySupport: z.string().nullable(),
  spyResistance: z.string().nullable(),
  qqqSupport: z.string().nullable(),
  qqqResistance: z.string().nullable(),
}).nullable();
```

Extend `enrichedMacroContextSchema`:

```ts
const enrichedMacroContextSchema = macroBriefingContextSchema.extend({
  fredData: z.array(fredPointSchema),
  dailyBars: z.array(dailyBarEntrySchema),
  priorDay: priorDaySchema,
});
```

In the `fetch-macro-context` step's return, add `priorDay` alongside `fredData` and `dailyBars`.

Add `deltas` to `macroBriefingSchema`:

```ts
deltas: z.array(z.string()).optional(),
```

**Step 4 — Update `buildBriefingPrompt` with prior-day block and delta instructions.**

Add `deltas` to the JSON shape block shown to the LLM:

```ts
deltas: ['delta sentence e.g. "10Y at 4.35% (+3bp from yesterday)" — omit if no prior context'],
```

Near the end, before the Source index push, add:

```ts
if (input.priorDay) {
  const pd = input.priorDay;
  const lines = [
    `Prior trading date: ${pd.tradingDate}`,
    `Prior bias: ${pd.marketBias}`,
    pd.dgs10 !== null ? `Prior 10Y: ${pd.dgs10.toFixed(2)}%` : null,
    pd.dgs2 !== null ? `Prior 2Y: ${pd.dgs2.toFixed(2)}%` : null,
    pd.spySupport ? `Prior SPY key levels: ${pd.spySupport} / ${pd.spyResistance}` : null,
    pd.qqqSupport ? `Prior QQQ key levels: ${pd.qqqSupport} / ${pd.qqqResistance}` : null,
  ].filter(Boolean);

  sections.push(
    '',
    'Prior day context (use to write delta sentences in the "deltas" field):',
    lines.join('\n'),
  );
} else {
  sections.push('', 'No prior day context available — omit the deltas field or return an empty array.');
}
```

Add a rule to the `Rules:` array:

```ts
'- deltas: 1–4 sentences. Each must reference a specific number and compare to prior day (e.g. "10Y at 4.35%, up 3bp from 4.32% yesterday"). Omit if no prior context.',
```

**Step 5 — Add `scoreReportQuality()` and call it from `generate-briefing`.**

Place after `buildBriefingPrompt`:

```ts
/**
 * Post-LLM sanity checks. Never throws. Logs warnings only.
 * Checks: (a) every driver has ≥1 sourceRef, (b) key level support/resistance
 * values fall within the 5-day OHLC range (±5%), (c) tldr has 2–4 bullets.
 */
function scoreReportQuality(
  briefing: z.infer<typeof macroBriefingDraftSchema>,
  dailyBars: z.infer<typeof dailyBarEntrySchema>[],
): void {
  const issues: string[] = [];

  briefing.drivers.forEach((driver, i) => {
    if (driver.sourceRefs.length === 0) {
      issues.push(`driver[${i}] "${driver.driver.slice(0, 40)}" has no sourceRefs`);
    }
  });

  for (const level of briefing.keyLevels) {
    const entry = dailyBars.find((bar) => bar.ticker === level.ticker);
    if (!entry || entry.bars.length === 0) continue;

    const rangeMin = Math.min(...entry.bars.map((b) => b.low));
    const rangeMax = Math.max(...entry.bars.map((b) => b.high));
    const margin = (rangeMax - rangeMin) * 0.05 + 1;

    const support = parseFloat(level.support);
    const resistance = parseFloat(level.resistance);

    if (!Number.isNaN(support) && (support < rangeMin - margin || support > rangeMax + margin)) {
      issues.push(`${level.ticker} support ${level.support} outside 5-day range [${rangeMin.toFixed(2)}, ${rangeMax.toFixed(2)}]`);
    }
    if (!Number.isNaN(resistance) && (resistance < rangeMin - margin || resistance > rangeMax + margin)) {
      issues.push(`${level.ticker} resistance ${level.resistance} outside 5-day range [${rangeMin.toFixed(2)}, ${rangeMax.toFixed(2)}]`);
    }
  }

  if (briefing.tldr.length < 2 || briefing.tldr.length > 4) {
    issues.push(`tldr has ${briefing.tldr.length} bullets (expected 2–4)`);
  }

  if (issues.length > 0) {
    console.warn('[macro-summary] quality issues:', issues);
  }
}
```

Call it in `generate-briefing` right after the draft parse succeeds, before `return completedResult(briefing, ...)`:

```ts
scoreReportQuality(briefing, input.dailyBars);
```

**Step 6 — Tighten `buildMacroSummaryEmbed()` in `lib/agents/discord.ts`.**

- Delete the `else if (typeof payload.ratesOutlook === 'string' && payload.ratesOutlook.trim()) { fields.push(buildField('Rates', payload.ratesOutlook, false)); }` branch. Rates appears only when FRED data exists.
- Wrap the Catalysts push in `if (Array.isArray(payload.scheduledCatalysts) && payload.scheduledCatalysts.length > 0)`.
- Wrap the Sector Rotation push in `if (Array.isArray(payload.sectorRotation) && payload.sectorRotation.length > 0)`.
- Wrap the Desk Implications push in `if (Array.isArray(payload.deskImplications) && payload.deskImplications.length > 0)`.
- After the TLDR block, add:

```ts
if (Array.isArray(payload.deltas) && payload.deltas.length > 0) {
  fields.push(buildField('Deltas', formatBulletList(payload.deltas), false));
}
```

**Step 7 — Add `startIntradayCron()` to `lib/agents/macro-cron.ts`.**

Append to the bottom of the file:

```ts
async function runIntradayTick(db: AgentDb, hourEt: number): Promise<void> {
  const { tradingDate, currentHour } = getTradingWindow();
  if (currentHour !== hourEt) return;

  await db.transaction(async (tx) => {
    const claimResult = await tx.execute<ScheduledRunRow>(sql`
      INSERT INTO agent_scheduled_runs (id, agent_id, trigger_type, trading_date, status, started_at, created_at)
      VALUES (${randomUUID()}, 'orchestrator', 'macro-intraday', ${tradingDate}, 'running', now(), now())
      ON CONFLICT (agent_id, trigger_type, trading_date) DO NOTHING
      RETURNING id;
    `);
    const [scheduledRun] = unwrapRows(claimResult);
    if (!scheduledRun) return;

    const jobId = randomUUID();
    await tx.insert(agentJobs).values({
      id: jobId,
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'macro-summary',
      status: 'queued',
      input: { tradingDate, intradayUpdate: true },
    });

    await tx.update(agentScheduledRuns)
      .set({ jobId, status: 'completed', completedAt: sql`now()` })
      .where(eq(agentScheduledRuns.id, scheduledRun.id));
  });
}

export function startIntradayCron(
  db: AgentDb,
  options: { hourEt?: number; checkIntervalMs?: number } = {},
): MacroCronHandle {
  const hourEt = options.hourEt ?? Number(process.env.MACRO_INTRADAY_HOUR_ET) || 12;
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const executeTick = () => {
    void runIntradayTick(db, hourEt).catch((error) => {
      console.error('intraday cron tick failed', { error });
    });
  };
  executeTick();
  const timer = setInterval(executeTick, checkIntervalMs);
  return { stop: async () => { clearInterval(timer); } };
}
```

**Step 8 — Create `lib/agents/blueprints/orchestrator-macro-intraday.ts` (NEW FILE).**

Deliberately short: current snapshot + today's morning brief => 5-field intraday report. No RSS, no FRED, no OHLC daily bars.

```ts
import { z } from 'zod';
import { fetchUnifiedSnapshot, type MassiveSnapshotResult } from '@/lib/massive-market';
import { writeAndDeliverReport } from '../discord';
import { callLlm } from '../llm-client';
import { and, desc, eq, gte } from 'drizzle-orm';
import { agentReports } from '@/lib/db/schema';
import type {
  Blueprint,
  CrossAssetEntry,
  MacroSummaryReport,
  StepResult,
} from '../types';

const INTRADAY_TICKERS = ['SPY', 'QQQ', 'IWM', 'TLT', 'UUP', 'UVXY'];

const intradayJobInputSchema = z.object({
  tradingDate: z.string().optional(),
  intradayUpdate: z.boolean().optional(),
});

function getTradingDate(jobInput: unknown): string {
  const parsed = intradayJobInputSchema.safeParse(jobInput);
  return parsed.success && parsed.data.tradingDate
    ? parsed.data.tradingDate
    : new Date().toISOString().slice(0, 10);
}

function completedResult<T>(data: T, options?: { durationMs?: number; upstreamStepIds?: string[]; model?: string; tokensUsed?: number }): StepResult<T> {
  return {
    status: 'completed',
    data,
    metrics: { durationMs: options?.durationMs ?? 0, attempt: 1, ...(options?.tokensUsed !== undefined ? { tokensUsed: options.tokensUsed } : {}) },
    provenance: { sourceIds: [], ...(options?.model ? { model: options.model } : {}), upstreamStepIds: options?.upstreamStepIds ?? [], timestamp: new Date().toISOString() },
  };
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch {
    const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
    if (m) return JSON.parse(m[1]!);
  }
  throw new Error('LLM did not return valid JSON');
}

const snapshotStepOutputSchema = z.object({
  tradingDate: z.string(),
  crossAssetSnapshot: z.array(z.object({
    ticker: z.string(),
    price: z.number().nullable(),
    changePercent: z.number().nullable(),
  })),
  morningReport: z.unknown().nullable(),
});

const intradayBriefingSchema = z.object({
  sessionBias: z.enum(['bullish', 'bearish', 'neutral']),
  sessionSummary: z.string(),
  surprises: z.array(z.string()),
  updatedKeyWatch: z.string(),
  deskNote: z.string(),
});

export const orchestratorMacroIntradayBlueprint: Blueprint = {
  id: 'orchestrator:macro-intraday',
  description: 'Mid-day macro update at 12:30 PM ET — session-so-far analysis vs morning brief.',
  steps: [
    {
      name: 'fetch-session-snapshot',
      type: 'code',
      metadata: { canRetry: true, timeoutMs: 20000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ jobInput, db }) => {
        const startedAt = Date.now();
        const tradingDate = getTradingDate(jobInput);

        let crossAssetSnapshot: CrossAssetEntry[] = [];
        if (process.env.MASSIVE_API_KEY?.trim()) {
          try {
            const snap = await fetchUnifiedSnapshot(INTRADAY_TICKERS);
            const results: MassiveSnapshotResult[] = Array.isArray((snap as { results?: MassiveSnapshotResult[] })?.results)
              ? (snap as { results: MassiveSnapshotResult[] }).results
              : [];
            crossAssetSnapshot = results.map((r) => ({
              ticker: typeof r.ticker === 'string' ? r.ticker.trim().toUpperCase() : 'UNKNOWN',
              price: r.session?.close ?? null,
              changePercent: r.session?.change_percent ?? null,
            }));
          } catch {
            // Snapshot unavailable — continue with empty
          }
        }

        let morningReport: MacroSummaryReport | null = null;
        try {
          const todayStart = new Date(`${tradingDate}T00:00:00.000Z`);
          const [row] = await db
            .select({ reportJson: agentReports.reportJson })
            .from(agentReports)
            .where(
              and(
                eq(agentReports.userId, 'system-agent-user'),
                eq(agentReports.agentId, 'orchestrator'),
                eq(agentReports.reportType, 'macro-summary'),
                eq(agentReports.status, 'published'),
                gte(agentReports.createdAt, todayStart),
              ),
            )
            .orderBy(desc(agentReports.createdAt))
            .limit(1);
          if (row?.reportJson) {
            morningReport = row.reportJson as MacroSummaryReport;
          }
        } catch {
          // No morning report — intraday runs blind
        }

        return completedResult({ tradingDate, crossAssetSnapshot, morningReport }, {
          durationMs: Date.now() - startedAt,
        });
      },
    },
    {
      name: 'generate-intraday-briefing',
      type: 'llm',
      inputSchema: snapshotStepOutputSchema,
      outputSchema: intradayBriefingSchema,
      metadata: { canRetry: true, timeoutMs: 45000, maxRepairAttempts: 1, sideEffect: false, lane: 'background' },
      run: async ({ previousOutput }) => {
        const input = snapshotStepOutputSchema.parse(previousOutput);
        const morningBias = input.morningReport
          ? `Morning bias: ${(input.morningReport as MacroSummaryReport).marketBias}. Morning TLDR: ${((input.morningReport as MacroSummaryReport).tldr ?? []).slice(0, 2).join(' | ')}`
          : 'No morning report available.';

        const userMessage = [
          `Trading date: ${input.tradingDate} (12:30 PM ET intraday check)`,
          '',
          morningBias,
          '',
          `Current session snapshot:\n${JSON.stringify(input.crossAssetSnapshot, null, 2)}`,
          '',
          'Return strict JSON with this shape and no markdown:',
          JSON.stringify({
            sessionBias: 'bullish | bearish | neutral',
            sessionSummary: '2 sentences: how the session has played out vs the morning thesis',
            surprises: ['1–3 bullet strings: what is surprising relative to the morning brief'],
            updatedKeyWatch: '1 sentence: what is the most important level or event to watch into the close',
            deskNote: '1 sentence: one specific actionable note for the desk right now',
          }, null, 2),
        ].join('\n');

        const { buildLlmSystemPrompt } = await import('../prompts-loader');
        const llmResponse = await callLlm({
          systemPrompt: await buildLlmSystemPrompt('orchestrator'),
          userMessage,
          temperature: 0.2,
        }, 'background');

        const briefing = intradayBriefingSchema.parse(parseJson(llmResponse.content));
        return completedResult(briefing, {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['fetch-session-snapshot'],
        });
      },
    },
    {
      name: 'save-intraday-summary',
      type: 'code',
      inputSchema: intradayBriefingSchema,
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async ({ jobInput, previousOutput, job, db }) => {
        const briefing = intradayBriefingSchema.parse(previousOutput);
        const tradingDate = getTradingDate(jobInput);
        const delivery = await writeAndDeliverReport(db, {
          jobId: job.id,
          userId: 'system-agent-user',
          agentId: 'orchestrator',
          reportType: 'macro-intraday',
          title: `${tradingDate} intraday macro update`,
          summary: briefing.sessionSummary,
          reportJson: { tradingDate, ...briefing },
        });
        return completedResult({ tradingDate, ...delivery }, {
          durationMs: 0,
          upstreamStepIds: ['generate-intraday-briefing'],
        });
      },
    },
  ],
};
```

**Step 9 — Wire the intraday blueprint in `lib/agents/config.ts`.**

Add the import:

```ts
import { orchestratorMacroIntradayBlueprint } from './blueprints/orchestrator-macro-intraday';
```

Update the orchestrator agent's `blueprintResolver`:

```ts
blueprintResolver: (job) => {
  if (job.jobType === 'macro-summary') {
    const input = job.input as { intradayUpdate?: boolean };
    if (input.intradayUpdate === true) {
      return orchestratorMacroIntradayBlueprint;
    }
    return orchestratorMacroSummaryBlueprint;
  }
  // ... existing resolver logic for other job types ...
}
```

**Step 10 — Wire `startIntradayCron()` in `services/agent-entrypoint.ts`.**

Update the import:

```ts
import { startMacroCron, startIntradayCron, type MacroCronHandle } from '../lib/agents/macro-cron';
```

Add alongside the existing `macroCron` handle:

```ts
let intradayCron: MacroCronHandle | null = null;
// ... after macroCron = startMacroCron(db):
if (process.env.MACRO_INTRADAY_ENABLED === '1') {
  intradayCron = startIntradayCron(db);
}
```

In the shutdown function, after `macroCron.stop()`:

```ts
if (intradayCron) {
  await intradayCron.stop();
}
```

**Step 11 — Route `macro-intraday` in `lib/agents/discord.ts`.**

In `resolveWebhookUrl()`, add a branch that maps `macro-intraday` to the existing `DISCORD_WEBHOOK_MACRO_DAILY` env var (so it flows to the same channel as the morning brief):

```ts
} else if (agentId === 'orchestrator' && reportType === 'macro-intraday') {
  envName = 'DISCORD_WEBHOOK_MACRO_DAILY';
```

In `selectEmbed()`, add before the `macro-summary` branch:

```ts
if (report.reportType === 'macro-intraday') {
  return buildMacroIntradayEmbed(report);
}
```

Add the embed function (reuses existing helpers `asRecord`, `readJsonValue`, `optionalText`, `formatBulletList`, `buildField`, `buildBaseEmbed`):

```ts
export function buildMacroIntradayEmbed(report: AgentReport): DiscordEmbed {
  const payload = asRecord(report.reportJson);
  const fields: DiscordEmbedField[] = [
    buildField('Session Bias', readJsonValue(payload, 'sessionBias')),
  ];

  const surprises = readJsonValue(payload, 'surprises');
  if (Array.isArray(surprises) && surprises.length > 0) {
    fields.push(buildField('Surprises', formatBulletList(surprises), false));
  }

  const updatedKeyWatch = optionalText(readJsonValue(payload, 'updatedKeyWatch'));
  if (updatedKeyWatch) {
    fields.push(buildField('Key Watch', updatedKeyWatch, false));
  }

  const deskNote = optionalText(readJsonValue(payload, 'deskNote'));
  if (deskNote) {
    fields.push(buildField('Desk Note', deskNote, false));
  }

  return buildBaseEmbed(
    report,
    fields,
    optionalText(report.summary, readJsonValue(payload, 'sessionSummary')),
  );
}
```

**Step 12 — Update tests.**

`__tests__/agent-blueprints.test.ts`:

- In the `generate-briefing` test's `previousOutput`, add `priorDay: null`. Add a second variant with a populated `priorDay` and assert the prompt contains `Prior day context`.
- In the `save-summary` test, update the mock LLM output to include `deltas: ['10Y at 4.32%, unchanged from yesterday']` and assert it appears in the saved `reportJson`.
- Add tests for `scoreReportQuality` behavior — indirectly via the `generate-briefing` step. Spy on `console.warn`:
  - Key levels outside the 5-day range -> warn called.
  - Levels within range + 2–4 TLDR bullets -> warn NOT called.
  - 5+ TLDR bullets -> warn called.
- If `blueprint.steps.length` is asserted, it remains unchanged at 5 (`fetch-macro-context` was already present in Phase 1; Phase 3 adds no new step to the morning blueprint).

`__tests__/agent-discord.test.ts`:

- When `fredData: []` and `ratesOutlook` is set -> no `Rates` field in the embed.
- When `scheduledCatalysts: []` -> no `Catalysts` field.
- When `sectorRotation: []` -> no `Sector Rotation` field.
- When `deskImplications: []` -> no `Desk Implications` field.
- When `deltas: ['10Y up 3bp']` -> `Deltas` field appears.
- `buildMacroIntradayEmbed` renders `Session Bias`, `Surprises`, `Key Watch`, `Desk Note`.

`__tests__/agent-macro-cron.test.ts`:

- Add `describe('startIntradayCron')` mirroring `startMacroCron` tests. Assertions:
  - Skips ticks outside the configured ET hour.
  - On match, inserts a row into `agent_scheduled_runs` with `trigger_type: 'macro-intraday'` and enqueues an `agentJobs` row with `input.intradayUpdate === true`.
  - Deduplicates concurrent ticks via the `(agent_id, trigger_type, trading_date)` unique constraint.

Run: `npm run lint && npx tsc --noEmit && npm test`

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MACRO_INTRADAY_ENABLED` | No | Set to `1` to start the 12:30 PM ET intraday cron in the agent service. Default: off (existing behavior unchanged). |
| `MACRO_INTRADAY_HOUR_ET` | No | ET hour for the intraday trigger. Default: `12`. Only read when `MACRO_INTRADAY_ENABLED=1`. |

### Acceptance Criteria

- `deltas?: string[]` on `MacroSummaryReport`. Prior reports without the field deserialize fine.
- `fetch-macro-context` queries `agentReports` for the most recent prior report (before `tradingDate`) and passes a compact `priorDay` shape to the LLM. On first run (`priorDay: null`) the prompt instructs the LLM to omit `deltas`.
- The LLM prompt contains a `Prior day context` block whenever `priorDay` is non-null.
- `scoreReportQuality()` is called after `macroBriefingDraftSchema.parse()`. It writes warnings to `console.warn` and never throws or blocks delivery.
- `buildMacroSummaryEmbed()`: `Rates` is absent when `fredData.length === 0`. `Catalysts`, `Sector Rotation`, `Desk Implications` are absent when their arrays are empty. `Deltas` appears when `deltas.length > 0`.
- `startIntradayCron()` is exported from `lib/agents/macro-cron.ts` and uses `trigger_type: 'macro-intraday'` (distinct from the morning `macro-summary` trigger).
- `orchestratorMacroIntradayBlueprint` exists, is registered in `lib/agents/config.ts`, and is selected when `job.input.intradayUpdate === true`.
- `resolveWebhookUrl()` routes `macro-intraday` to `DISCORD_WEBHOOK_MACRO_DAILY`. `buildMacroIntradayEmbed()` renders the intraday report type.
- Intraday cron does NOT start unless `MACRO_INTRADAY_ENABLED=1`. With the env var unset, `services/agent-entrypoint.ts` behaves exactly as today.
- `npm run lint && npx tsc --noEmit && npm test` all pass.

### Security Notes

- `fetchPriorMacroReport()` reads `agentReports` as `userId: 'system-agent-user'` only. No user data exposure.
- `MACRO_INTRADAY_ENABLED` / `MACRO_INTRADAY_HOUR_ET` are read server-side only (agent service container). They are not Next.js public env vars and never reach the browser.
- `scoreReportQuality()` only writes to `console.warn`. No DB persistence, no PII.

### Order Of Operations

1. Type change first (`types.ts`) — everything else imports from it.
2. Schema + helper additions in `orchestrator-macro-summary.ts` — compile after each chunk.
3. Embed tightening in `discord.ts` — standalone, easy to validate in isolation.
4. `macro-cron.ts` export, then intraday blueprint, then `config.ts` resolver wiring.
5. `services/agent-entrypoint.ts` last (depends on cron export).
6. Tests after all code compiles clean.

### Complexity

Medium–high. Highest-risk piece is the intraday blueprint — new code path through the resolver and a new report type through the Discord embed. Risk is contained because it's entirely opt-in (`MACRO_INTRADAY_ENABLED=1`). Historical comparison and quality scoring touch the morning pipeline but are purely additive. Embed tightening is low-risk surgical deletions. Test surface is moderate — 3 test files, ~15–20 new cases.
