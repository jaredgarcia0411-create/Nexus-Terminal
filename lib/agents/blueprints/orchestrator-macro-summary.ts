import { z } from 'zod';
import { and, desc, eq, lt } from 'drizzle-orm';
import { agentReports } from '@/lib/db/schema';
import { fetchUnifiedSnapshot, fetchDailyAggregates, type MassiveSnapshotResult } from '@/lib/massive-market';
import { writeAndDeliverReport } from '../discord';
import { fetchFearGreedIndex } from '../sentiment-client';
import { fetchFredSeries } from '../fred-client';
import { callLlm } from '../llm-client';
import { fetchRssItems, type RssItem } from '../rss-lite';
import { fetchPageText } from '../scrape-lite';
import type { AgentDb } from '../db';
import type {
  Blueprint,
  CrossAssetEntry,
  FredDataPoint,
  MacroSource,
  SentimentDataPoint,
  MacroSummaryReport,
  StepResult,
} from '../types';

const DEFAULT_MACRO_HEADLINES_URLS = 'https://www.marketwatch.com/latest-news,https://finance.yahoo.com/topic/stock-market-news/';
const DEFAULT_MACRO_RSS_URLS = [
  'https://cms.zerohedge.com/fullrss2.xml',
  'https://feeds.content.dowjones.io/public/rss/mw_topstories',
  'https://feeds.nbcnews.com/nbcnews/public/business',
  'https://news.google.com/rss/search?q=federal+reserve+macro+economy&hl=en-US&gl=US&ceid=US:en',
].join(',');
const MACRO_TICKERS = [
  'SPY', 'QQQ', 'IWM', 'DIA',
  'XLE', 'XLF', 'XLK', 'GLD', 'USO', 'TLT',
  'UVXY', 'UUP', 'SMH', 'IEF', 'HYG', 'EEM', 'BITO',
];
const KEY_LEVEL_TICKERS = ['SPY', 'QQQ', 'IWM'];
const FRED_SERIES = ['DGS10', 'DGS2', 'T10Y2Y', 'FEDFUNDS'];

const macroJobInputSchema = z.object({
  tradingDate: z.string().optional(),
});

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
  deltas: z.array(z.string()).optional(),
});

const macroBriefingContextSchema = headlinesSchema.extend({
  snapshot: z.unknown().nullable(),
  note: z.string().nullable().optional(),
  crossAssetSnapshot: z.array(z.object({
    ticker: z.string(),
    price: z.number().nullable(),
    changePercent: z.number().nullable(),
  })),
  sourceIndex: z.array(z.object({
    id: z.string(),
    title: z.string(),
    url: z.string().nullable(),
    fetchedAt: z.string(),
  })),
});

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

const enrichedMacroContextSchema = macroBriefingContextSchema.extend({
  fredData: z.array(fredPointSchema),
  dailyBars: z.array(dailyBarEntrySchema),
  priorDay: priorDaySchema.optional(),
});

const sentimentDataSchema = z.object({
  score: z.number().min(0).max(100),
  classification: z.string(),
  source: z.string(),
});

const sentimentEnrichedContextSchema = enrichedMacroContextSchema.extend({
  sentimentData: sentimentDataSchema.nullable(),
});

const macroBriefingDraftSchema = z.object({
  crossAssetSnapshot: macroBriefingContextSchema.shape.crossAssetSnapshot,
  sourceIndex: macroBriefingContextSchema.shape.sourceIndex,
  fredData: z.array(fredPointSchema),
  sentimentData: sentimentDataSchema.nullable().optional(),
  deltas: z.array(z.string()).optional(),
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

const generateBriefingInputSchema = z.union([
  sentimentEnrichedContextSchema,
  macroBriefingDraftSchema,
]);

function completedResult<T>(
  data: T,
  options?: {
    durationMs?: number;
    tokensUsed?: number;
    sourceIds?: string[];
    upstreamStepIds?: string[];
    model?: string;
    artifacts?: Record<string, unknown>;
  },
): StepResult<T> {
  return {
    status: 'completed',
    data,
    ...(options?.artifacts ? { artifacts: options.artifacts } : {}),
    metrics: {
      durationMs: options?.durationMs ?? 0,
      ...(options?.tokensUsed === undefined ? {} : { tokensUsed: options.tokensUsed }),
      attempt: 1,
    },
    provenance: {
      sourceIds: options?.sourceIds ?? [],
      ...(options?.model ? { model: options.model } : {}),
      upstreamStepIds: options?.upstreamStepIds ?? [],
      timestamp: new Date().toISOString(),
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
    if (fenceMatch) {
      return JSON.parse(fenceMatch[1]);
    }
  }

  throw new Error('LLM did not return valid JSON');
}

function getTradingDate(jobInput: unknown): string {
  const parsed = macroJobInputSchema.safeParse(jobInput);
  return parsed.success && parsed.data.tradingDate
    ? parsed.data.tradingDate
    : new Date().toISOString().slice(0, 10);
}

function getHeadlineUrls(): string[] {
  return (process.env.MACRO_HEADLINES_URLS ?? DEFAULT_MACRO_HEADLINES_URLS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getRssUrls(): string[] {
  return (process.env.MACRO_RSS_URLS ?? DEFAULT_MACRO_RSS_URLS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildCrossAssetSnapshot(results: MassiveSnapshotResult[]): CrossAssetEntry[] {
  return results.map((result) => ({
    ticker: typeof result.ticker === 'string' && result.ticker.trim()
      ? result.ticker.trim().toUpperCase()
      : 'UNKNOWN',
    price: result.session?.close ?? null,
    changePercent: result.session?.change_percent ?? null,
  }));
}

function buildSourceIndex(headlines: z.infer<typeof headlinesSchema>['headlines']): MacroSource[] {
  const fetchedAt = new Date().toISOString();

  return [
    ...headlines.map((headline) => {
      let hostname = 'headline-source';

      try {
        hostname = new URL(headline.url).hostname;
      } catch {
        hostname = headline.url;
      }

      return {
        id: `headline:${hostname}`,
        title: `${hostname} headlines`,
        url: headline.url,
        fetchedAt,
      };
    }),
    ...MACRO_TICKERS.map((ticker) => ({
      id: `snapshot:${ticker}`,
      title: `${ticker} Session Snapshot`,
      url: null,
      fetchedAt,
    })),
  ];
}

/**
 * Fetches the most recent prior macro report from the DB.
 * Returns null on first run or when no usable prior report exists.
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
  if (!db || typeof db.select !== 'function') {
    return null;
  }

  const [row] = await db.select({ reportJson: agentReports.reportJson })
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

  if (!row?.reportJson || typeof row.reportJson !== 'object') {
    return null;
  }

  const report = row.reportJson as Partial<MacroSummaryReport>;
  if (typeof report.tradingDate !== 'string' || typeof report.marketBias !== 'string') {
    return null;
  }

  const dgs10 = report.fredData?.find((point) => point.seriesId === 'DGS10')?.value ?? null;
  const dgs2 = report.fredData?.find((point) => point.seriesId === 'DGS2')?.value ?? null;
  const spy = report.keyLevels?.find((level) => level.ticker === 'SPY');
  const qqq = report.keyLevels?.find((level) => level.ticker === 'QQQ');

  return {
    tradingDate: report.tradingDate,
    marketBias: report.marketBias,
    dgs10,
    dgs2,
    spySupport: spy?.support ?? null,
    spyResistance: spy?.resistance ?? null,
    qqqSupport: qqq?.support ?? null,
    qqqResistance: qqq?.resistance ?? null,
  };
}

function buildBriefingPrompt(
  tradingDate: string,
  input: z.infer<typeof sentimentEnrichedContextSchema>,
): string {
  const sections: string[] = [
    `Trading date: ${tradingDate}`,
    '',
    'You are writing a pre-market macro analysis for active day traders. This is read before the bell - be specific, actionable, and data-driven. Do NOT pad with generic filler; every sentence must contain specific data or analysis.',
    '',
    'Return strict JSON with this shape and no markdown:',
    JSON.stringify({
      marketBias: 'bullish | bearish | neutral',
      summary: '2-3 sentence executive summary of the macro setup',
      riskAssessment: '2-4 sentences on the risk environment - what is driving risk-on or risk-off, cross-asset signals, where conviction is highest or lowest',
      drivers: [{
        driver: 'market-moving headline or driver',
        impact: 'positive | negative | mixed',
        sourceRefs: ['headline:marketwatch.com'],
      }],
      keyLevels: [{
        ticker: 'SPY',
        support: 'price level (e.g. 520.00)',
        resistance: 'price level (e.g. 535.00)',
        note: 'why these levels matter - reference recent price action from daily bars',
      }],
      ratesOutlook: '1-2 sentences on rates environment and equity implications - reference actual FRED values when available',
      scheduledCatalysts: [{
        event: 'scheduled catalyst',
        date: 'YYYY-MM-DD or null',
        expectedImpact: 'brief description',
      }],
      sectorRotation: ['sector rotation note with specific tickers or ETFs'],
      scenarioAnalysis: {
        consensus: 'what plays out if the base case holds - be specific with levels and sectors',
        disruption: 'what breaks the thesis and consequences - be specific',
      },
      deskImplications: ['specific, actionable trading implication'],
      confidence: 'high | medium | low',
      tldr: ['2-4 bullet points - start with overall bias, end with what to watch today'],
      deltas: ['delta sentence e.g. "10Y at 4.35% (+3bp from yesterday)" — omit if no prior context'],
    }, null, 2),
    '',
    'Rules:',
    '- Every driver must include at least one sourceRefs entry matching an id from sourceIndex.',
    '- keyLevels: focus on SPY, QQQ, IWM. Use the daily OHLC bars to identify meaningful support/resistance (recent swing highs/lows, prior day close, round numbers). Include specific price levels.',
    '- scenarioAnalysis: consensus is the base case, disruption is what breaks it. Both must reference specific data.',
    '- deltas: 1–4 sentences. Each must reference a specific number and compare to prior day (e.g. "10Y at 4.35%, up 3bp from 4.32% yesterday"). Omit if no prior context.',
    '- sentimentData (when present): reference the score and classification in riskAssessment and deskImplications. High fear (score < 30) is often contrarian bullish for equities; extreme greed (score > 75) warrants caution. Note: this index tracks crypto sentiment correlates, not pure equities.',
    '- tldr: what someone reads if they read nothing else. Every bullet should be specific and actionable.',
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

  if (input.priorDay) {
    const pd = input.priorDay;
    const lines = [
      `Prior trading date: ${pd.tradingDate}`,
      `Prior bias: ${pd.marketBias}`,
      pd.dgs10 !== null ? `Prior 10Y: ${pd.dgs10.toFixed(2)}%` : null,
      pd.dgs2 !== null ? `Prior 2Y: ${pd.dgs2.toFixed(2)}%` : null,
      pd.spySupport ? `Prior SPY key levels: ${pd.spySupport} / ${pd.spyResistance}` : null,
      pd.qqqSupport ? `Prior QQQ key levels: ${pd.qqqSupport} / ${pd.qqqResistance}` : null,
    ].filter((line): line is string => Boolean(line));

    sections.push(
      '',
      'Prior day context (use to write delta sentences in the "deltas" field):',
      lines.join('\n'),
    );
  } else {
    sections.push('', 'No prior day context available — omit the deltas field or return an empty array.');
  }

  if (input.sentimentData !== null && input.sentimentData !== undefined) {
    sections.push(
      '',
      `Sentiment (crypto-derived Fear & Greed Index - use as a divergent/leading signal, not an equities-direct reading):\nScore: ${input.sentimentData.score}/100 - ${input.sentimentData.classification}\nSource: ${input.sentimentData.source}`,
    );
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

function scoreReportQuality(
  briefing: z.infer<typeof macroBriefingDraftSchema>,
  dailyBars: z.infer<typeof dailyBarEntrySchema>[],
): void {
  const issues: string[] = [];

  briefing.drivers.forEach((driver, index) => {
    if (driver.sourceRefs.length === 0) {
      issues.push(`driver[${index}] "${driver.driver.slice(0, 40)}" has no sourceRefs`);
    }
  });

  for (const level of briefing.keyLevels) {
    const entry = dailyBars.find((bar) => bar.ticker === level.ticker);
    if (!entry || entry.bars.length === 0) {
      continue;
    }

    const rangeMin = Math.min(...entry.bars.map((bar) => bar.low));
    const rangeMax = Math.max(...entry.bars.map((bar) => bar.high));
    const margin = (rangeMax - rangeMin) * 0.05 + 1;
    const support = Number.parseFloat(level.support);
    const resistance = Number.parseFloat(level.resistance);

    if (!Number.isNaN(support) && (support < rangeMin - margin || support > rangeMax + margin)) {
      issues.push(`${level.ticker} support ${level.support} outside 5-day range [${rangeMin.toFixed(2)}, ${rangeMax.toFixed(2)}]`);
    }

    if (!Number.isNaN(resistance) && (resistance < rangeMin - margin || resistance > rangeMax + margin)) {
      issues.push(`${level.ticker} resistance ${level.resistance} outside 5-day range [${rangeMin.toFixed(2)}, ${rangeMax.toFixed(2)}]`);
    }
  }

  if (briefing.tldr.length < 2 || briefing.tldr.length > 4) {
    issues.push(`tldr has ${briefing.tldr.length} bullets (expected 2-4)`);
  }

  if (issues.length > 0) {
    console.warn('[macro-summary] quality issues:', issues);
  }
}

async function loadOrchestratorSystemPrompt() {
  const { buildLlmSystemPrompt } = await import('../prompts-loader');
  return buildLlmSystemPrompt('orchestrator');
}

export const orchestratorMacroSummaryBlueprint: Blueprint = {
  id: 'orchestrator:macro-summary',
  description: 'Daily macro briefing - headlines + market snapshot + LLM synthesis + persisted report.',
  steps: [
    {
      name: 'scrape-headlines',
      type: 'code',
      outputSchema: headlinesSchema,
      metadata: { canRetry: true, timeoutMs: 30000, maxRepairAttempts: 0, sideEffect: false },
      run: async () => {
        const startedAt = Date.now();
        const urls = getHeadlineUrls();
        const headlines: z.infer<typeof headlinesSchema>['headlines'] = [];

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
        const rssHeadlines: RssItem[] = [];

        for (const rssUrl of rssUrls) {
          try {
            const items = await fetchRssItems(rssUrl);
            rssHeadlines.push(...items);
          } catch {
            // Gracefully skip failed RSS feeds - pipeline continues without RSS data
          }
        }

        return completedResult({ headlines, rssHeadlines }, {
          durationMs: Date.now() - startedAt,
          sourceIds: [...urls, ...rssUrls],
        });
      },
    },
    {
      name: 'fetch-market-snapshot',
      type: 'code',
      metadata: { canRetry: true, timeoutMs: 15000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput }) => {
        const startedAt = Date.now();
        const headlines = headlinesSchema.parse(previousOutput);
        const crossAssetSnapshotSourceIds = [...MACRO_TICKERS];

        const buildSnapshotPayload = (snapshot: unknown, note: string | null) => {
          const normalizedSnapshot = snapshot && typeof snapshot === 'object'
            ? snapshot as { results?: MassiveSnapshotResult[] }
            : null;
          const snapshotResults = Array.isArray(normalizedSnapshot?.results)
            ? normalizedSnapshot.results
            : [];
          const crossAssetSnapshot = buildCrossAssetSnapshot(snapshotResults);
          const sourceIndex = buildSourceIndex(headlines.headlines);

          return completedResult({
            ...headlines,
            snapshot,
            note,
            crossAssetSnapshot,
            sourceIndex,
          }, {
            durationMs: Date.now() - startedAt,
            sourceIds: [
              ...headlines.headlines.map((headline) => headline.url),
              ...crossAssetSnapshotSourceIds,
            ],
            upstreamStepIds: ['scrape-headlines'],
          });
        };

        if (!process.env.MASSIVE_API_KEY?.trim()) {
          return buildSnapshotPayload(null, 'no massive api key');
        }

        const snapshot = await fetchUnifiedSnapshot(MACRO_TICKERS);
        return buildSnapshotPayload(snapshot, null);
      },
    },
    {
      name: 'fetch-macro-context',
      type: 'code',
      inputSchema: macroBriefingContextSchema,
      outputSchema: enrichedMacroContextSchema,
      metadata: { canRetry: true, timeoutMs: 20000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput, jobInput, db }) => {
        const startedAt = Date.now();
        const context = macroBriefingContextSchema.parse(previousOutput);
        const tradingDate = getTradingDate(jobInput);
        const priorDay = await fetchPriorMacroReport(db, tradingDate).catch(() => null);

        let fredData: FredDataPoint[] = [];
        try {
          fredData = await fetchFredSeries(FRED_SERIES);
        } catch {
          // FRED unavailable - continue without rates data
        }

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
            .filter((result): result is PromiseFulfilledResult<z.infer<typeof dailyBarEntrySchema>> =>
              result.status === 'fulfilled')
            .map((result) => result.value);
        }

        const fetchedAt = new Date().toISOString();
        const rssUrls = getRssUrls();
        const extendedSourceIndex: MacroSource[] = [
          ...context.sourceIndex,
          ...rssUrls.map((url) => {
            let hostname = 'rss-source';
            try {
              hostname = new URL(url).hostname;
            } catch {
              // ignore malformed URLs in source metadata
            }
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
          priorDay,
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
          ...(sentimentData !== null
            ? [{
              id: 'data:fear-greed',
              title: 'Alternative.me Fear & Greed Index',
              url: 'https://alternative.me/crypto/fear-and-greed-index/',
              fetchedAt,
            }]
            : []),
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
    {
      name: 'generate-briefing',
      type: 'llm',
      inputSchema: generateBriefingInputSchema,
      outputSchema: macroBriefingDraftSchema,
      metadata: {
        canRetry: true,
        timeoutMs: 60000,
        maxRepairAttempts: 1,
        sideEffect: false,
        lane: 'background',
      },
      run: async ({ jobInput, previousOutput }) => {
        // Preserve resume compatibility for runs checkpointed on the pre-Phase-2
        // generate step before fetch-sentiment existed in the middle of the flow.
        const resumedDraft = macroBriefingDraftSchema.safeParse(previousOutput);
        if (resumedDraft.success) {
          return completedResult(resumedDraft.data, {
            durationMs: 0,
            upstreamStepIds: ['fetch-sentiment'],
          });
        }

        const input = sentimentEnrichedContextSchema.parse(previousOutput);
        const llmResponse = await callLlm({
          systemPrompt: await loadOrchestratorSystemPrompt(),
          userMessage: buildBriefingPrompt(getTradingDate(jobInput), input),
          temperature: 0.2,
        }, 'background');

        const parsedBriefing = macroBriefingSchema.parse(parseJson(llmResponse.content));
        const briefing = macroBriefingDraftSchema.parse({
          crossAssetSnapshot: input.crossAssetSnapshot,
          sourceIndex: input.sourceIndex,
          fredData: input.fredData,
          sentimentData: input.sentimentData,
          ...parsedBriefing,
        });

        scoreReportQuality(briefing, input.dailyBars);

        return completedResult(briefing, {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['fetch-sentiment'],
          artifacts: {
            inputTokens: llmResponse.inputTokens,
            outputTokens: llmResponse.outputTokens,
            modelUsed: llmResponse.modelUsed,
          },
        });
      },
    },
    {
      name: 'save-summary',
      type: 'code',
      inputSchema: macroBriefingDraftSchema,
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async ({ jobInput, previousOutput, job, db }) => {
        const briefing = macroBriefingDraftSchema.parse(previousOutput);
        const tradingDate = getTradingDate(jobInput);
        const reportJson = {
          tradingDate,
          ...briefing,
        } as MacroSummaryReport;
        const delivery = await writeAndDeliverReport(db, {
          jobId: job.id,
          userId: 'system-agent-user',
          agentId: 'orchestrator',
          reportType: 'macro-summary',
          title: `${tradingDate} macro briefing`,
          summary: briefing.summary,
          reportJson,
        });

        return completedResult({
          tradingDate,
          ...delivery,
        }, {
          durationMs: 0,
          upstreamStepIds: ['generate-briefing'],
        });
      },
    },
  ],
};
