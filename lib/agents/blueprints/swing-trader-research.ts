import { z } from 'zod';
import { getCachedTickerData } from '@/lib/askedgar';
import { fetchDailyAggregates, fetchTickerNews, type MassiveNewsArticle } from '@/lib/massive-market';
import { wrapUntrusted } from '@/lib/agents/trust-boundary';
import { buildNewsFeedFromArrays, newsFeedItemSchema, type NewsFeedItem } from '../news-formatter';
import { writeAndDeliverReport } from '../discord';
import { upsertMemory } from '../memory';
import { callLlm } from '../llm-client';
import type { Blueprint, GapStatsRow, StepResult } from '../types';

const TRADINGVIEW_COLUMNS = [
  'name',
  'close',
  'change',
  'volume',
  'average_volume_90d_calc',
  'market_cap_basic',
  'sector',
  'High.1M',
  'Low.1M',
  'RSI',
  'MACD.macd',
  'EMA9',
  'EMA21',
];

const researchInputSchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,5}$/),
});

const rawResearchInputSchema = z.object({
  ticker: z.string().min(1),
});

const filingsSchema = z.object({
  ticker: z.string(),
  gapStats: z.array(z.unknown()),
  ownership: z.array(z.unknown()),
  historicalFloat: z.array(z.unknown()),
  dilutionRating: z.unknown().nullable(),
  registrations: z.array(z.unknown()),
  offerings: z.array(z.unknown()),
  askEdgarNewsFeed: z.array(newsFeedItemSchema).default([]),
  managementCommentary: z.string().nullable().default(null),
});

const priceContextSchema = filingsSchema.extend({
  priceContext: z.object({
    price: z.number(),
    change: z.number().nullable(),
    volume: z.number().nullable(),
    avgVolume90d: z.number().nullable(),
    marketCap: z.number().nullable(),
    sector: z.string().nullable(),
    high1m: z.number().nullable(),
    low1m: z.number().nullable(),
    rsi: z.number().nullable(),
    macdSignal: z.number().nullable(),
    ema9: z.number().nullable(),
    ema21: z.number().nullable(),
  }).nullable(),
});

const ohlcBarSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  vwap: z.number().nullable(),
});

const ohlcEnrichedSchema = priceContextSchema.extend({
  ohlcHistory: z.array(ohlcBarSchema),
});

const newsEnrichedSchema = ohlcEnrichedSchema.extend({
  recentNews: z.array(newsFeedItemSchema).default([]),
});

const deterministicTechnicalsSchema = z.object({
  relativeVolume: z.number().nullable(),
  extension5d: z.number().nullable(),
  extension10d: z.number().nullable(),
  rsi: z.number().nullable(),
  ema9: z.number().nullable(),
  ema21: z.number().nullable(),
});

const runnerQualitySchema = z.object({
  gapStats: z.array(z.unknown()),
  gapCount: z.number(),
  sameDayFadeRate: z.number().nullable(),
  avgHighExtension: z.number().nullable(),
  priorGapDayAvgReturn: z.number().nullable(),
  ownership: z.array(z.unknown()),
  historicalFloat: z.array(z.unknown()),
  dilutionRating: z.unknown().nullable(),
  registrations: z.array(z.unknown()),
  offerings: z.array(z.unknown()),
  floatTrend: z.enum(['increasing', 'decreasing', 'stable']).nullable(),
  knownHolderOverhang: z.number().nullable(),
});

const swingPipelineInputSchema = newsEnrichedSchema.extend({
  deterministicTechnicals: deterministicTechnicalsSchema,
  runnerQuality: runnerQualitySchema,
  gapStatsTable: z.array(z.object({
    date: z.string(),
    gapPct: z.number(),
    open: z.number(),
    close: z.number(),
  })),
});

const trafficLightRating = z.enum(['green', 'yellow', 'red']);

const ratedSection = z.object({
  rating: trafficLightRating,
  explanation: z.string().min(1),
});

const swingResearchSchema = z.object({
  ticker: z.string(),
  mdrPatternMatch: ratedSection.extend({
    mdrSimilarity: z.number().min(0).max(100).catch(0),
  }),
  momentum: ratedSection,
  catalyst: ratedSection,
  patternClassification: z.enum(['BREAKOUT', 'EXHAUSTION', 'CONTINUATION', 'STOPPED']),
  recommendation: z.object({
    action: z.enum(['HOLD', 'ADD', 'TRIM', 'EXIT', 'WATCH']),
    reasoning: z.string().min(1),
  }),
  volumeProfile: ratedSection,
  gapStatsTable: z.array(
    z.object({
      date: z.string(),
      gapPct: z.number(),
      open: z.number(),
      close: z.number(),
    }),
  ),
  financialCommentary: z.object({
    rating: z.enum(['green', 'yellow', 'red']),
    explanation: z.string(),
  }),
  confidence: z.enum(['high', 'medium', 'low']),
  evidenceIds: z.array(z.string()),
});

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

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toUnknownCollection(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readResults(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const results = (value as { results?: unknown }).results;
  return Array.isArray(results) ? results : [];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readSection(rawData: Record<string, unknown>, ...keys: string[]): unknown[] {
  for (const key of keys) {
    const results = readResults(rawData[key]);
    if (results.length > 0) {
      return results;
    }
  }

  return [];
}

function readNullableSectionFirst(rawData: Record<string, unknown>, ...keys: string[]): unknown | null {
  for (const key of keys) {
    const result = readResults(rawData[key])[0];
    if (result !== undefined) {
      return result;
    }
  }

  return null;
}

function getFieldValue(source: unknown, keys: string[]): unknown {
  const record = toObject(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function getNumberField(source: unknown, keys: string[]): number | null {
  const value = getFieldValue(source, keys);
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const numeric = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function parseLooseDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isValidRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeGapRow(value: unknown): {
  open: number;
  close: number;
  high: number;
} | null {
  if (!isValidRecord(value)) {
    return null;
  }

  const open = getNumberField(value, ['open', 'marketOpen', 'market_open']);
  const close = getNumberField(value, ['close', 'marketClose', 'market_close']);
  const high = getNumberField(value, ['high_price', 'high', 'intradayHigh', 'intraday_high']);

  if (
    open === null
    || close === null
    || high === null
    || !Number.isFinite(open)
    || !Number.isFinite(close)
    || !Number.isFinite(high)
    || open === 0
  ) {
    return null;
  }

  return { open, close, high };
}

function computeGapDayStats(gapStats: unknown): {
  gapCount: number;
  sameDayFadeRate: number | null;
  avgHighExtension: number | null;
  priorGapDayAvgReturn: number | null;
} {
  const gapRows = asArray(gapStats)
    .map(normalizeGapRow)
    .filter((row): row is { open: number; close: number; high: number } => row !== null);

  const gapCount = gapRows.length;
  const sameDayFadeRate = gapCount === 0
    ? null
    : gapRows.filter((row) => row.close < row.open).length / gapCount;
  const priorGapDayAvgReturn = gapCount === 0
    ? null
    : gapRows.reduce((sum, row) => sum + (((row.close - row.open) / row.open) * 100), 0) / gapCount;
  const avgHighExtension = gapCount === 0
    ? null
    : gapRows.reduce((sum, row) => sum + (((row.high - row.open) / row.open) * 100), 0) / gapCount;

  return {
    gapCount,
    sameDayFadeRate,
    avgHighExtension,
    priorGapDayAvgReturn,
  };
}

export function extractGapStatsTable(rawRows: unknown[]): GapStatsRow[] {
  const rows: GapStatsRow[] = [];

  for (const value of rawRows) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }

    const row = value as Record<string, unknown>;
    const rawDate = row.date
      ?? row.gapDate
      ?? row.trading_date
      ?? row.tradeDate
      ?? row.tradingDate;
    if (typeof rawDate !== 'string' || !rawDate) {
      continue;
    }

    const date = rawDate.slice(0, 10);
    const open = Number(
      row.market_open
      ?? row.marketOpen
      ?? row.open
      ?? row.openPrice
      ?? row.open_price
      ?? Number.NaN,
    );
    const close = Number(
      row.market_close
      ?? row.marketClose
      ?? row.close
      ?? row.closePrice
      ?? row.close_price
      ?? Number.NaN,
    );
    if (Number.isNaN(open) || Number.isNaN(close)) {
      continue;
    }

    let gapPct: number | null = null;
    const directGap = row.gap_percentage
      ?? row.gapPercentage
      ?? row.gapPercent
      ?? row.gap_pct
      ?? row.gapPct
      ?? row.pctChange
      ?? row.gap
      ?? row.percent_change;
    if (directGap !== undefined && directGap !== null && !Number.isNaN(Number(directGap))) {
      gapPct = Number(directGap);
    } else {
      const priorClose = Number(
        row.previous_day_close
        ?? row.prior_close
        ?? row.priorClose
        ?? row.previousClose
        ?? Number.NaN,
      );
      if (!Number.isNaN(priorClose) && priorClose !== 0) {
        gapPct = ((open - priorClose) / priorClose) * 100;
      }
    }
    if (gapPct === null) {
      continue;
    }

    rows.push({
      date,
      gapPct: Math.round(gapPct * 100) / 100,
      open,
      close,
    });
  }

  return rows.slice(0, 10);
}

function flattenOwnershipRecords(value: unknown): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const entry of toUnknownCollection(value)) {
    if (!isValidRecord(entry)) {
      continue;
    }

    const owners = Array.isArray(entry.owners) ? entry.owners : null;
    if (owners) {
      rows.push(...flattenOwnershipRecords(owners));
      continue;
    }

    rows.push(entry);
  }

  return rows;
}

function normalizeHistoricalFloatRow(value: unknown): {
  date: Date;
  float: number;
} | null {
  if (!isValidRecord(value)) {
    return null;
  }

  const date = parseLooseDate(getFieldValue(value, ['date', 'reportedDate', 'reported_date']));
  // Sprint 2 — historical-float-pro now sources outstanding shares from SEC XBRL companyfacts;
  // float/tradable are null and we fall back to outstanding for trend computation.
  const floatValue = getNumberField(value, ['float', 'tradableFloat', 'tradable_float', 'outstanding', 'outstandingShares', 'outstanding_shares']);

  if (!date || floatValue === null || !Number.isFinite(floatValue)) {
    return null;
  }

  return { date, float: floatValue };
}

function computeFloatTrend(historicalFloat: unknown): 'increasing' | 'decreasing' | 'stable' | null {
  const rows = asArray(historicalFloat)
    .map(normalizeHistoricalFloatRow)
    .filter((row): row is { date: Date; float: number } => row !== null)
    .sort((left, right) => left.date.getTime() - right.date.getTime());

  if (rows.length < 2) {
    return null;
  }

  const first = rows[0]?.float ?? null;
  const last = rows[rows.length - 1]?.float ?? null;
  if (first === null || last === null || !Number.isFinite(first) || !Number.isFinite(last)) {
    return null;
  }

  if (last > first * 1.05) {
    return 'increasing';
  }

  if (last < first * 0.95) {
    return 'decreasing';
  }

  return 'stable';
}

function computeKnownHolderOverhang(ownership: unknown): number | null {
  const ownershipRows = flattenOwnershipRecords(ownership);
  if (ownershipRows.length === 0) {
    return null;
  }

  return Math.min(
    100,
    ownershipRows.reduce((sum, row) => {
      const percentage = getNumberField(row, ['percentage', 'percent_held', 'percentHeld']);
      return sum + (percentage ?? 0);
    }, 0),
  );
}

function normalizeOhlcHistory(history: z.infer<typeof ohlcBarSchema>[]): z.infer<typeof ohlcBarSchema>[] {
  return [...history].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
}

function computeExtension(history: z.infer<typeof ohlcBarSchema>[], barsAgo: number): number | null {
  if (history.length < barsAgo) {
    return null;
  }

  const latest = history[history.length - 1]?.close;
  const previous = history[history.length - barsAgo]?.close;

  if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }

  return ((latest - previous) / previous) * 100;
}

function toOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNewsTimestamp(value: string): number | null {
  const parsed = new Date(value);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function findMatchingNewsInsight(article: MassiveNewsArticle, ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase();

  return article.insights?.find((insight) => {
    const insightTicker = insight.ticker?.trim().toUpperCase();
    return insightTicker === normalizedTicker;
  }) ?? article.insights?.[0] ?? null;
}

function simplifyNewsArticles(
  articles: MassiveNewsArticle[],
  ticker: string,
): NewsFeedItem[] {
  return articles.flatMap((article) => {
    const title = toOptionalText(article.title);
    if (!title) {
      return [];
    }

    const insight = findMatchingNewsInsight(article, ticker);

    return [{
      headline: title,
      summary: toOptionalText(article.description) ?? '',
      date: toOptionalText(article.published_utc) ?? '',
      formType: 'news',
      url: toOptionalText(article.article_url) ?? '',
      tags: [],
      isNews: true,
      isFiling: false,
      sentiment: toOptionalText(insight?.sentiment),
      sentimentReasoning: toOptionalText(insight?.sentiment_reasoning),
    }];
  });
}

function mergeRecentNews(items: NewsFeedItem[]): NewsFeedItem[] {
  const seenHeadlines = new Set<string>();
  const seenUrls = new Set<string>();

  return items
    .filter((item) => {
      const headlineKey = item.headline.trim().toLowerCase();
      if (headlineKey) {
        if (seenHeadlines.has(headlineKey)) {
          return false;
        }
        seenHeadlines.add(headlineKey);
      }

      const urlKey = item.url.trim().toLowerCase();
      if (urlKey) {
        if (seenUrls.has(urlKey)) {
          return false;
        }
        seenUrls.add(urlKey);
      }

      return true;
    })
    .sort((left, right) => {
      const leftTimestamp = left.date ? toNewsTimestamp(left.date) : null;
      const rightTimestamp = right.date ? toNewsTimestamp(right.date) : null;

      if (leftTimestamp !== null && rightTimestamp !== null) {
        return rightTimestamp - leftTimestamp;
      }

      if (leftTimestamp !== null) {
        return -1;
      }

      if (rightTimestamp !== null) {
        return 1;
      }

      return 0;
    })
    .slice(0, 10);
}

function computeSwingTechnicals(input: z.infer<typeof newsEnrichedSchema>): z.infer<typeof swingPipelineInputSchema> {
  const sortedHistory = normalizeOhlcHistory(input.ohlcHistory);
  const priceContext = input.priceContext;
  const gapStatsTable = extractGapStatsTable(asArray(input.gapStats));
  const relativeVolume = priceContext && priceContext.volume !== null
    && priceContext.avgVolume90d !== null
    && priceContext.avgVolume90d > 0
    ? priceContext.volume / priceContext.avgVolume90d
    : null;

  return {
    ...input,
    ohlcHistory: sortedHistory,
    deterministicTechnicals: {
      relativeVolume,
      extension5d: computeExtension(sortedHistory, 5),
      extension10d: computeExtension(sortedHistory, 10),
      rsi: priceContext?.rsi ?? null,
      ema9: priceContext?.ema9 ?? null,
      ema21: priceContext?.ema21 ?? null,
    },
    runnerQuality: {
      gapStats: asArray(input.gapStats),
      ...computeGapDayStats(input.gapStats),
      ownership: asArray(input.ownership),
      historicalFloat: asArray(input.historicalFloat),
      dilutionRating: input.dilutionRating,
      registrations: asArray(input.registrations),
      offerings: asArray(input.offerings),
      floatTrend: computeFloatTrend(input.historicalFloat),
      knownHolderOverhang: computeKnownHolderOverhang(input.ownership),
    },
    gapStatsTable,
  };
}

function formatPromptSection(label: string, value: unknown): string {
  return `${label}:\n${JSON.stringify(value, null, 2)}`;
}

async function fetchTradingViewPriceContext(ticker: string) {
  const sessionId = process.env.TRADINGVIEW_SESSION_ID?.trim() ?? '';
  const response = await fetch('https://scanner.tradingview.com/america/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId ? { Cookie: `sessionid=${sessionId}` } : {}),
      'User-Agent': 'Mozilla/5.0',
      Origin: 'https://www.tradingview.com',
      Referer: 'https://www.tradingview.com/',
    },
    body: JSON.stringify({
      columns: TRADINGVIEW_COLUMNS,
      filter: [
        { left: 'name', operation: 'equal', right: ticker },
      ],
      range: [0, 1],
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`TradingView scanner returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ s?: string; d?: unknown[] }>;
  };
  const row = payload.data?.find((candidate) => candidate.s?.split(':')[1] === ticker)
    ?? payload.data?.[0];
  if (!row?.d) {
    return null;
  }

  const price = Number(row.d[1]);
  if (!Number.isFinite(price)) {
    return null;
  }

  const toNullableNumber = (value: unknown) => {
    if (typeof value === 'string') {
      const numeric = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
      return Number.isFinite(numeric) ? numeric : null;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  return {
    price,
    change: toNullableNumber(row.d[2]),
    volume: toNullableNumber(row.d[3]),
    avgVolume90d: toNullableNumber(row.d[4]),
    marketCap: toNullableNumber(row.d[5]),
    sector: typeof row.d[6] === 'string' && row.d[6].trim() ? row.d[6].trim() : null,
    high1m: toNullableNumber(row.d[7]),
    low1m: toNullableNumber(row.d[8]),
    rsi: toNullableNumber(row.d[9]),
    macdSignal: toNullableNumber(row.d[10]),
    ema9: toNullableNumber(row.d[11]),
    ema21: toNullableNumber(row.d[12]),
  };
}

function buildResearchPrompt(input: z.infer<typeof swingPipelineInputSchema>): string {
  const gapTableSection = input.gapStatsTable.length === 0
    ? 'No historical gap data available.'
    : [
      'Historical Gap Data (last 5, most recent first):',
      '| Date | Gap % | Open | Close |',
      '|------|-------|------|-------|',
      ...input.gapStatsTable.map(
        (row) =>
          `| ${row.date} | ${row.gapPct > 0 ? '+' : ''}${row.gapPct.toFixed(2)}% | ${row.open} | ${row.close} |`,
      ),
    ].join('\n');
  const commentaryText = input.managementCommentary?.trim() || 'No management commentary available.';
  const exampleShape = {
    ticker: input.ticker,
    mdrPatternMatch: { rating: 'green | yellow | red', explanation: 'string', mdrSimilarity: 72 },
    momentum: { rating: 'green | yellow | red', explanation: 'string' },
    catalyst: { rating: 'green | yellow | red', explanation: 'string' },
    patternClassification: 'BREAKOUT | EXHAUSTION | CONTINUATION | STOPPED',
    recommendation: { action: 'HOLD | ADD | TRIM | EXIT | WATCH', reasoning: 'string' },
    volumeProfile: { rating: 'green | yellow | red', explanation: 'string' },
    gapStatsTable: [{ date: '2026-04-17', gapPct: 12.5, open: 1.23, close: 1.18 }],
    financialCommentary: { rating: 'green | yellow | red', explanation: 'string' },
    confidence: 'high | medium | low',
    evidenceIds: ['string'],
  };

  const sections = [
    `Ticker: ${input.ticker}`,
    'Return strict JSON matching this exact shape (no markdown, no extra keys):',
    JSON.stringify(exampleShape, null, 2),
    `Price context:\n${wrapUntrusted('price-context', JSON.stringify(input.priceContext, null, 2))}`,
    `Deterministic technicals:\n${wrapUntrusted('deterministic-technicals', JSON.stringify(input.deterministicTechnicals, null, 2))}`,
    [
      'Runner quality:',
      `gapStats:\n${wrapUntrusted('filing', gapTableSection)}`,
      `ownership:\n${wrapUntrusted('filing', JSON.stringify(input.runnerQuality.ownership, null, 2))}`,
      `historicalFloat:\n${wrapUntrusted('filing', JSON.stringify(input.runnerQuality.historicalFloat, null, 2))}`,
      `dilutionRating:\n${wrapUntrusted('filing', JSON.stringify(input.runnerQuality.dilutionRating, null, 2))}`,
      `registrations:\n${wrapUntrusted('filing', JSON.stringify(input.runnerQuality.registrations, null, 2))}`,
      `offerings:\n${wrapUntrusted('filing', JSON.stringify(input.runnerQuality.offerings, null, 2))}`,
      `Management Commentary (from SEC filings / earnings):\n${wrapUntrusted('filing', commentaryText)}`,
      `floatTrend:\n${wrapUntrusted('deterministic-technicals', JSON.stringify(input.runnerQuality.floatTrend, null, 2))}`,
      `knownHolderOverhang:\n${wrapUntrusted('deterministic-technicals', JSON.stringify(input.runnerQuality.knownHolderOverhang, null, 2))}`,
      `gapDayStats (precomputed):\n${wrapUntrusted('deterministic-technicals', JSON.stringify({
        gapCount: input.runnerQuality.gapCount,
        sameDayFadeRate: input.runnerQuality.sameDayFadeRate,
        avgHighExtension: input.runnerQuality.avgHighExtension,
        priorGapDayAvgReturn: input.runnerQuality.priorGapDayAvgReturn,
      }, null, 2))}`,
    ].join('\n\n'),
  ];

  if (input.ohlcHistory.length > 0) {
    sections.push(
      `Daily OHLC history (last ${input.ohlcHistory.length} days):\n${wrapUntrusted('ohlc-bars', JSON.stringify(input.ohlcHistory, null, 2))}`,
      'Use the OHLC data to assess momentum, volume trends, and pattern quality. Do NOT fabricate data — only reference values present above.',
    );
  } else {
    sections.push(
      'No OHLC history available. Base momentum and volume analysis on the price context data only. State that historical OHLC was unavailable.',
    );
  }

  if (input.recentNews.length > 0) {
    sections.push(
      `Recent news:\n${wrapUntrusted('news', JSON.stringify(input.recentNews, null, 2))}`,
      "Use only items in the Recent news section. When rating Catalyst, quote the exact headline text of the single most relevant item and cite its formType (e.g., (8-K) or (news)). Do not claim no news is available unless Recent news is empty.",
    );
  } else {
    sections.push(
      'Recent news section is empty. Rate catalyst based on price action only and explicitly state that the feed returned no headlines.',
    );
  }

  sections.push(
    'Use the JMT traffic-light rating system. Each rating must be "green", "yellow", or "red" (lowercase).',
    'Do NOT provide specific price levels (entry, stop, target). Focus on pattern quality and setup strength.',
    'Use the precomputed gapDayStats values for historical gap-day analysis. Do not recalculate from the raw gapStats array.',
    'For gapStatsTable: copy the exact Historical Gap Data rows into the JSON output. If the table says no data is available, return an empty array.',
    'For financialCommentary: rate the Management Commentary section using the traffic-light system and explain the cash, liquidity, or financing signal in one short paragraph.',
  );

  return sections.join('\n\n');
}

function buildReportSummary(report: z.infer<typeof swingResearchSchema>): string {
  return `${report.recommendation.action} — ${report.patternClassification} (${report.mdrPatternMatch.mdrSimilarity}% MDR match, ${report.mdrPatternMatch.rating})`;
}

async function loadSwingTraderSystemPrompt() {
  const { buildLlmSystemPrompt } = await import('../prompts-loader');
  return buildLlmSystemPrompt('swing-trader');
}

export const swingTraderResearchBlueprint: Blueprint = {
  id: 'swing-trader:research',
  description: 'Swing-trader research for a single ticker using MDR-focused synthesis.',
  steps: [
    {
      name: 'fetch-filings',
      type: 'code',
      inputSchema: researchInputSchema,
      outputSchema: filingsSchema,
      metadata: { canRetry: true, timeoutMs: 30000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ jobInput }) => {
        const startedAt = Date.now();
        const rawInput = rawResearchInputSchema.parse(jobInput);
        const ticker = rawInput.ticker.trim().toUpperCase();
        researchInputSchema.parse({ ticker });
        const result = await getCachedTickerData(ticker, { scope: 'swing-trader-research' });
        const rawData = result.rawData as Record<string, unknown>;
        const dilutionDetails = (result as { dilutionDetails?: unknown }).dilutionDetails
          ?? readResults(rawData['dilution-data'])[0]
          ?? null;
        const askEdgarNewsFeed = buildNewsFeedFromArrays(
          readResults(rawData['news']),
          readResults(rawData['filing-titles']),
          { maxItems: 8, maxAgeDays: 30 },
        );

        return completedResult({
          ticker,
          gapStats: readSection(rawData, 'gap-stats', 'gapStats'),
          ownership: readSection(rawData, 'ownership'),
          historicalFloat: readSection(rawData, 'historical-float-pro', 'historicalFloatPro'),
          dilutionRating: readNullableSectionFirst(rawData, 'dilution-rating', 'dilutionRating'),
          registrations: readSection(rawData, 'registrations'),
          offerings: readSection(rawData, 'offerings'),
          askEdgarNewsFeed,
          managementCommentary: typeof dilutionDetails === 'object' && dilutionDetails !== null
            ? (
              (dilutionDetails as Record<string, unknown>).managementCommentary
              ?? (dilutionDetails as Record<string, unknown>).management_commentary
              ?? null
            ) as string | null
            : null,
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: [`askedgar:${ticker}`],
        });
      },
    },
    {
      name: 'fetch-price-context',
      type: 'code',
      inputSchema: filingsSchema,
      outputSchema: priceContextSchema,
      metadata: { canRetry: true, timeoutMs: 15000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput }) => {
        const startedAt = Date.now();
        const filings = filingsSchema.parse(previousOutput);
        const priceContext = await fetchTradingViewPriceContext(filings.ticker);

        return completedResult({
          ...filings,
          priceContext,
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: [`tradingview:${filings.ticker}`],
          upstreamStepIds: ['fetch-filings'],
        });
      },
    },
    {
      name: 'fetch-ohlc-history',
      type: 'code',
      inputSchema: priceContextSchema,
      outputSchema: ohlcEnrichedSchema,
      metadata: { canRetry: true, timeoutMs: 15000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput }) => {
        const startedAt = Date.now();
        const data = priceContextSchema.parse(previousOutput);
        let ohlcHistory: z.infer<typeof ohlcBarSchema>[] = [];

        try {
          ohlcHistory = await fetchDailyAggregates(data.ticker, 10);
        } catch (error) {
          // Non-fatal — proceed with empty OHLC if Massive API fails
          console.warn(`[swing-trader] OHLC fetch failed for ${data.ticker}:`, error);
        }

        return completedResult({
          ...data,
          ohlcHistory,
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: ohlcHistory.length > 0 ? [`massive-ohlc:${data.ticker}`] : [],
          upstreamStepIds: ['fetch-price-context'],
        });
      },
    },
    {
      name: 'fetch-news',
      type: 'code',
      inputSchema: ohlcEnrichedSchema,
      outputSchema: newsEnrichedSchema,
      metadata: { canRetry: true, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput }) => {
        const startedAt = Date.now();
        const data = ohlcEnrichedSchema.parse(previousOutput);
        const askEdgarNewsFeed = data.askEdgarNewsFeed;
        let recentNews: NewsFeedItem[] = [];
        let massiveNewsAvailable = false;

        try {
          const articles = await fetchTickerNews(data.ticker, 3);
          const massiveNews = simplifyNewsArticles(articles, data.ticker);
          massiveNewsAvailable = massiveNews.length > 0;
          recentNews = mergeRecentNews([
            ...askEdgarNewsFeed,
            ...massiveNews,
          ]);
        } catch (error) {
          console.warn(`[swing-trader] News fetch failed for ${data.ticker}:`, error);
          recentNews = mergeRecentNews(askEdgarNewsFeed);
        }

        return completedResult({
          ...data,
          recentNews,
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: recentNews.length > 0
            ? [
              ...(askEdgarNewsFeed.length > 0 ? [`askedgar:${data.ticker}`] : []),
              ...(massiveNewsAvailable ? [`massive-news:${data.ticker}`] : []),
            ]
            : [],
          upstreamStepIds: ['fetch-ohlc-history'],
        });
      },
    },
    {
      name: 'compute-swing-technicals',
      type: 'code',
      inputSchema: newsEnrichedSchema,
      outputSchema: swingPipelineInputSchema,
      metadata: { canRetry: true, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput }) => {
        const startedAt = Date.now();
        const input = newsEnrichedSchema.parse(previousOutput);
        const pipelineInput = computeSwingTechnicals(input);

        return completedResult(pipelineInput, {
          durationMs: Date.now() - startedAt,
          upstreamStepIds: ['fetch-news'],
        });
      },
    },
    {
      name: 'synthesize-report',
      type: 'llm',
      inputSchema: swingPipelineInputSchema,
      outputSchema: swingResearchSchema,
      metadata: {
        canRetry: true,
        timeoutMs: 60000,
        maxRepairAttempts: 1,
        sideEffect: false,
        lane: 'background',
      },
      run: async ({ previousOutput }) => {
        const input = swingPipelineInputSchema.parse(previousOutput);
        const llmResponse = await callLlm({
          systemPrompt: await loadSwingTraderSystemPrompt(),
          userMessage: buildResearchPrompt(input),
          temperature: 0.2,
        }, 'background');
        const parsed = swingResearchSchema.parse(parseJson(llmResponse.content));
        parsed.gapStatsTable = input.gapStatsTable;

        return completedResult(parsed, {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['compute-swing-technicals'],
          artifacts: {
            inputTokens: llmResponse.inputTokens,
            outputTokens: llmResponse.outputTokens,
            modelUsed: llmResponse.modelUsed,
          },
        });
      },
    },
    {
      name: 'save-research',
      type: 'code',
      inputSchema: swingResearchSchema,
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async ({ previousOutput, job, db }) => {
        const report = swingResearchSchema.parse(previousOutput);
        const delivery = await writeAndDeliverReport(db, {
          jobId: job.id,
          userId: job.userId,
          agentId: 'swing-trader',
          reportType: 'research',
          title: `${report.ticker} Swing Research`,
          summary: buildReportSummary(report),
          reportJson: report,
        });

        await upsertMemory(db, {
          userId: job.userId,
          agentId: 'swing-trader',
          category: 'thesis',
          key: report.ticker,
          value: `${report.recommendation.action} — ${report.patternClassification}`,
          valueJson: {
            action: report.recommendation.action,
            pattern: report.patternClassification,
            mdrSimilarity: report.mdrPatternMatch.mdrSimilarity,
            momentum: report.momentum.rating,
            confidence: report.confidence,
          },
          source: `report:${job.id}`,
          confidence: report.confidence,
          expiresAt: new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)),
        });

        return completedResult({
          ticker: report.ticker,
          reportType: 'research',
          ...delivery,
        }, {
          durationMs: 0,
          upstreamStepIds: ['synthesize-report'],
        });
      },
    },
  ],
};
