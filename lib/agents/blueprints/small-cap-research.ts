import { z } from 'zod';
import { getCachedTickerData } from '@/lib/askedgar';
import { wrapUntrusted } from '@/lib/agents/trust-boundary';
import { buildNewsFeedFromArrays, newsFeedItemSchema } from '../news-formatter';
import { writeAndDeliverReport } from '../discord';
import { callLlm } from '../llm-client';
import { upsertMemory } from '../memory';
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

export const researchTickerInputSchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,5}$/),
});

const rawResearchInputSchema = z.object({
  ticker: z.string().min(1),
});

export const edgarSectionsSchema = z.object({
  ticker: z.string(),
  gapStats: z.array(z.unknown()),
  offerings: z.array(z.unknown()),
  registrations: z.array(z.unknown()),
  equityLines: z.array(z.unknown()),
  dilutionRating: z.unknown().nullable(),
  dilutionData: z.unknown().nullable(),
  ownership: z.unknown().nullable(),
  historicalFloat: z.array(z.unknown()),
  reverseSplits: z.array(z.unknown()),
  splitStatus: z.unknown().nullable(),
  agreements: z.array(z.unknown()),
  nasdaqCompliance: z.unknown().nullable(),
  news: z.array(z.unknown()),
  filingTitles: z.array(z.unknown()).default([]),
  cashPosition: z.unknown().nullable(),
  managementCommentary: z.string().nullable().default(null),
});

export const priceContextSchema = edgarSectionsSchema.extend({
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

const deterministicAnalysisSchema = z.object({
  gapCount: z.number().nullable(),
  sameDayFadeRate: z.number().nullable(),
  avgCloseVsOpen: z.number().nullable(),
  avgHighExtension: z.number().nullable(),
  recentOfferingCount: z.number().nullable(),
  hasActiveShelf: z.boolean(),
  hasActiveAtm: z.boolean(),
  amountRemainingAtm: z.number().nullable(),
  splitApproved: z.boolean(),
  splitEffectivePending: z.boolean(),
  daysToComplianceDeadline: z.number().nullable(),
  floatTrend: z.enum(['increasing', 'decreasing', 'stable']).nullable(),
  knownHolderOverhang: z.number().nullable(),
  newsCount: z.number(),
  mostRecentNewsDate: z.string().nullable(),
  daysSinceLastNews: z.number().nullable(),
  hasFilingCatalyst: z.boolean(),
  hasJmt415Content: z.boolean(),
  catalystCategories: z.array(z.string()),
});

export const researchPipelineInputSchema = priceContextSchema.extend({
  deterministicAnalysis: deterministicAnalysisSchema,
  gapStatsTable: z.array(z.object({
    date: z.string(),
    gapPct: z.number(),
    open: z.number(),
    close: z.number(),
  })),
  newsFeed: z.array(newsFeedItemSchema).default([]),
});

const trafficLightRating = z.enum(['green', 'yellow', 'red']);

const ratedSection = z.object({
  rating: trafficLightRating,
  explanation: z.string().min(1),
});

const ratedCatalyst = z.object({
  catalyst: z.string().min(1),
  rating: trafficLightRating,
});

export const researchReportSchema = z.object({
  ticker: z.string(),
  newsWhyRunning: ratedSection,
  themeMatch: ratedSection,
  otherCatalysts: z.array(ratedCatalyst),
  chartHistory: ratedSection,
  dilution: ratedSection,
  offeringFrequency: ratedSection,
  offeringAbility: ratedSection,
  cashNeed: ratedSection,
  overallOfferingRisk: ratedSection,
  jmt415Commentary: z.string().nullable(),
  gapStatsTable: z.array(z.object({
    date: z.string(),
    gapPct: z.number(),
    open: z.number(),
    close: z.number(),
  })),
  financialCommentary: z.object({
    rating: z.enum(['green', 'yellow', 'red']),
    explanation: z.string(),
    // 'verbatim' = pasted from AskEdgar's mgmt_commentary; 'llm' = LLM-generated fallback.
    // Default to 'llm' so the model doesn't have to set it; we override post-LLM in synthesize.
    source: z.enum(['verbatim', 'llm']).default('llm'),
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

export function parseJson(text: string): unknown {
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

export function readResults(
  value: unknown,
): unknown[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const results = (value as { results?: unknown }).results;
  return Array.isArray(results) ? results : [];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toUnknownCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as { results?: unknown };
  if (Array.isArray(record.results)) {
    return record.results;
  }

  return [value];
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

export function getStringField(source: unknown, keys: string[]): string | null {
  const value = getFieldValue(source, keys);
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getBooleanField(source: unknown, keys: string[]): boolean | null {
  const value = getFieldValue(source, keys);
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (/^(true|yes|1|effective|approved|active)$/i.test(value.trim())) {
      return true;
    }

    if (/^(false|no|0|inactive|pending|denied)$/i.test(value.trim())) {
      return false;
    }
  }

  return null;
}

function getNumberField(source: unknown, keys: string[]): number | null {
  return toNullableNumber(getFieldValue(source, keys));
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

  if (open === null || close === null || high === null || !Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(high) || open === 0) {
    return null;
  }

  return { open, close, high };
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

function normalizeOfferingRow(value: unknown): {
  offeringType: string | null;
  status: string | null;
  date: Date | null;
  remainingAmount: number | null;
} | null {
  if (!isValidRecord(value)) {
    return null;
  }

  return {
    offeringType: getStringField(value, ['offering_type', 'offeringType', 'type']),
    status: getStringField(value, ['status', 'offering_status', 'offeringStatus']),
    date: parseLooseDate(getFieldValue(value, ['date', 'offering_date', 'offeringDate', 'filedAt', 'filed_at'])),
    remainingAmount: getNumberField(value, ['remaining_amount', 'amount_remaining', 'amountRemaining']),
  };
}

function normalizeSplitStatusRow(value: unknown): {
  status: string | null;
} | null {
  if (!isValidRecord(value)) {
    return null;
  }

  return {
    status: getStringField(value, ['status', 'details', 'actionType']),
  };
}

function normalizeComplianceRow(value: unknown): {
  deadline: Date | null;
} | null {
  if (!isValidRecord(value)) {
    return null;
  }

  return {
    deadline: parseLooseDate(getFieldValue(value, ['deadline', 'compliance_deadline', 'complianceDeadline'])),
  };
}

const FILING_CATALYST_FORM_TYPES = new Set([
  '424B5', '424B1', '424B4', '424B3', 'S-1', 'S-3', 'F-3', '8-K',
]);
const FILING_CATALYST_TAGS = new Set([
  'Offerings', 'Dilution', 'Financing Activity', 'Capital Structure', 'Cash Runway',
]);

function extractNewsMetrics(newsItems: unknown[]): {
  newsCount: number;
  mostRecentNewsDate: string | null;
  daysSinceLastNews: number | null;
  hasFilingCatalyst: boolean;
  hasJmt415Content: boolean;
  catalystCategories: string[];
} {
  const newsCount = newsItems.length;
  let latestDate: Date | null = null;
  let hasFilingCatalyst = false;
  let hasJmt415Content = false;
  const categorySet = new Set<string>();

  for (const item of newsItems) {
    if (!isValidRecord(item)) {
      continue;
    }

    const date = parseLooseDate(getFieldValue(item, ['filed_at', 'filedAt']));
    if (date && (latestDate === null || date > latestDate)) {
      latestDate = date;
    }

    const formType = getStringField(item, ['form_type', 'formType']);
    if (formType) {
      categorySet.add(formType);
      if (FILING_CATALYST_FORM_TYPES.has(formType.toUpperCase())) {
        hasFilingCatalyst = true;
      }
      if (formType.toLowerCase() === 'jmt415') {
        hasJmt415Content = true;
      }
    }

    const tags = Array.isArray(item.tags) ? item.tags : [];
    for (const tag of tags) {
      if (typeof tag === 'string' && FILING_CATALYST_TAGS.has(tag)) {
        hasFilingCatalyst = true;
      }
    }
  }

  const mostRecentNewsDate = latestDate ? latestDate.toISOString().slice(0, 10) : null;
  const daysSinceLastNews = latestDate
    ? Math.floor((Date.now() - latestDate.getTime()) / 86400000)
    : null;

  return {
    newsCount,
    mostRecentNewsDate,
    daysSinceLastNews,
    hasFilingCatalyst,
    hasJmt415Content,
    catalystCategories: [...categorySet].sort(),
  };
}

export function computeDeterministicAnalysis(
  input: z.infer<typeof priceContextSchema>,
): z.infer<typeof deterministicAnalysisSchema> & { gapStatsTable: GapStatsRow[] } {
  const newsMetrics = extractNewsMetrics(asArray(input.news));
  const rawGapRows = asArray(input.gapStats);
  const gapRows = rawGapRows
    .map(normalizeGapRow)
    .filter((row): row is { open: number; close: number; high: number } => row !== null);
  const gapStatsTable = extractGapStatsTable(rawGapRows);

  const gapCount = gapRows.length;
  const sameDayFadeRate = gapCount === 0
    ? null
    : gapRows.filter((row) => row.close < row.open).length / gapCount;
  const avgCloseVsOpen = gapCount === 0
    ? null
    : gapRows.reduce((sum, row) => sum + (((row.close - row.open) / row.open) * 100), 0) / gapCount;
  const avgHighExtension = gapCount === 0
    ? null
    : gapRows.reduce((sum, row) => sum + (((row.high - row.open) / row.open) * 100), 0) / gapCount;

  const recentOfferingCutoff = Date.now() - (365 * 24 * 60 * 60 * 1000);
  const recentOfferingCount = asArray(input.offerings)
    .map(normalizeOfferingRow)
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter((row) => row.date !== null && row.date.getTime() >= recentOfferingCutoff)
    .length;

  const registrations = asArray(input.registrations);
  const hasActiveShelf = registrations.some((entry) => {
    const status = getStringField(entry, ['status', 'effective_status', 'effectiveStatus']);
    if (status) {
      return status.toLowerCase().includes('effective');
    }

    return getBooleanField(entry, ['isEffective', 'effective']) === true;
  });

  const offerings = asArray(input.offerings)
    .map(normalizeOfferingRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const hasActiveAtm = offerings.some((row) => {
    const offeringType = row.offeringType?.toLowerCase() ?? '';
    const status = row.status?.toLowerCase() ?? '';
    return offeringType.includes('atm') && status.includes('active');
  });
  const activeAtmOfferings = offerings.filter((row) => {
    const offeringType = row.offeringType?.toLowerCase() ?? '';
    const status = row.status?.toLowerCase() ?? '';
    return offeringType.includes('atm') && status.includes('active');
  });
  const amountRemainingAtm = activeAtmOfferings.length === 0
    ? null
    : activeAtmOfferings.reduce((sum, row) => sum + (row.remainingAmount ?? 0), 0);

  const splitStatusRows = toUnknownCollection(input.splitStatus)
    .map(normalizeSplitStatusRow)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const splitApproved = splitStatusRows.some((row) => row.status?.toLowerCase().includes('approved') ?? false);
  const splitEffectivePending = splitStatusRows.some((row) => row.status?.toLowerCase().includes('pending') ?? false);

  const complianceRow = toUnknownCollection(input.nasdaqCompliance)
    .map(normalizeComplianceRow)
    .find((row): row is NonNullable<typeof row> => row !== null) ?? null;
  const daysToComplianceDeadline = complianceRow?.deadline
    ? Math.ceil((complianceRow.deadline.getTime() - Date.now()) / 86400000)
    : null;

  const historicalFloatRows = asArray(input.historicalFloat)
    .map(normalizeHistoricalFloatRow)
    .filter((row): row is { date: Date; float: number } => row !== null)
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  const floatTrend = (() => {
    if (historicalFloatRows.length < 2) {
      return null;
    }

    const first = historicalFloatRows[0]?.float ?? null;
    const last = historicalFloatRows[historicalFloatRows.length - 1]?.float ?? null;
    if (first === null || last === null || !Number.isFinite(first) || !Number.isFinite(last)) {
      return null;
    }

    if (last > first * 1.05) {
      return 'increasing' as const;
    }

    if (last < first * 0.95) {
      return 'decreasing' as const;
    }

    return 'stable' as const;
  })();

  const ownershipRows = flattenOwnershipRecords(input.ownership);
  const knownHolderOverhang = ownershipRows.length === 0
    ? null
    : Math.min(
        100,
        ownershipRows.reduce((sum, row) => {
          const percentage = getNumberField(row, ['percentage', 'percent_held', 'percentHeld']);
          return sum + (percentage ?? 0);
        }, 0),
      );

  return {
    gapCount,
    sameDayFadeRate,
    avgCloseVsOpen,
    avgHighExtension,
    recentOfferingCount,
    hasActiveShelf,
    hasActiveAtm,
    amountRemainingAtm,
    splitApproved,
    splitEffectivePending,
    daysToComplianceDeadline,
    floatTrend,
    knownHolderOverhang,
    gapStatsTable,
    ...newsMetrics,
  };
}

function formatPromptSection(label: string, value: unknown): string {
  return `${label}:\n${JSON.stringify(value, null, 2)}`;
}

export async function fetchTradingViewPriceContext(ticker: string) {
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

export function buildResearchPrompt(input: z.infer<typeof researchPipelineInputSchema>): string {
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
    newsWhyRunning: { rating: 'green | yellow | red', explanation: 'string' },
    themeMatch: { rating: 'green | yellow | red', explanation: 'string' },
    otherCatalysts: [{ catalyst: 'string', rating: 'green | yellow | red' }],
    chartHistory: { rating: 'green | yellow | red', explanation: 'string' },
    dilution: { rating: 'green | yellow | red', explanation: 'string' },
    offeringFrequency: { rating: 'green | yellow | red', explanation: 'string' },
    offeringAbility: { rating: 'green | yellow | red', explanation: 'string' },
    cashNeed: { rating: 'green | yellow | red', explanation: 'string' },
    overallOfferingRisk: { rating: 'green | yellow | red', explanation: 'string' },
    jmt415Commentary: 'string or null',
    gapStatsTable: [{ date: '2026-04-17', gapPct: 12.5, open: 1.23, close: 1.18 }],
    financialCommentary: { rating: 'green | yellow | red', explanation: 'string' },
    confidence: 'high | medium | low',
    evidenceIds: ['string'],
  };

  return [
    `Ticker: ${input.ticker}`,
    'Return strict JSON matching this exact shape (no markdown, no extra keys):',
    JSON.stringify(exampleShape, null, 2),
    `Price context:\n${wrapUntrusted('price-context', JSON.stringify(input.priceContext, null, 2))}`,
    [
      'AskEdgar sections:',
      `gapStats:\n${wrapUntrusted('filing', gapTableSection)}`,
      `offerings:\n${wrapUntrusted('filing', JSON.stringify(input.offerings, null, 2))}`,
      `registrations:\n${wrapUntrusted('filing', JSON.stringify(input.registrations, null, 2))}`,
      `equityLines:\n${wrapUntrusted('filing', JSON.stringify(input.equityLines, null, 2))}`,
      `dilutionRating:\n${wrapUntrusted('filing', JSON.stringify(input.dilutionRating, null, 2))}`,
      `dilutionData:\n${wrapUntrusted('filing', JSON.stringify(input.dilutionData, null, 2))}`,
      `ownership:\n${wrapUntrusted('filing', JSON.stringify(input.ownership, null, 2))}`,
      `historicalFloat:\n${wrapUntrusted('filing', JSON.stringify(input.historicalFloat, null, 2))}`,
      `reverseSplits:\n${wrapUntrusted('filing', JSON.stringify(input.reverseSplits, null, 2))}`,
      `splitStatus:\n${wrapUntrusted('filing', JSON.stringify(input.splitStatus, null, 2))}`,
      `agreements:\n${wrapUntrusted('filing', JSON.stringify(input.agreements, null, 2))}`,
      `nasdaqCompliance:\n${wrapUntrusted('filing', JSON.stringify(input.nasdaqCompliance, null, 2))}`,
      `Recent news & filings (headline, date, formType, summary):\n${wrapUntrusted('news', JSON.stringify(input.newsFeed, null, 2))}`,
      `cashPosition:\n${wrapUntrusted('filing', JSON.stringify(input.cashPosition, null, 2))}`,
      `Management Commentary (from SEC filings / earnings):\n${wrapUntrusted('filing', commentaryText)}`,
    ].join('\n\n'),
    `Deterministic analysis:\n${wrapUntrusted('deterministic-analysis', JSON.stringify(input.deterministicAnalysis, null, 2))}`,
    'Use the JMT traffic-light rating system. Each rating must be "green", "yellow", or "red" (lowercase).',
    'For jmt415Commentary: if deterministicAnalysis.hasJmt415Content is false, set to null. If true, note the presence of JMT content based on the Recent news & filings section.',
    'For gapStatsTable: copy the exact Historical Gap Data rows into the JSON output. If the table says no data is available, return an empty array.',
    'For financialCommentary: rate the Management Commentary section using the traffic-light system and explain the cash, liquidity, or financing signal in one short paragraph.',
    "When rating 'News / Why It's Running', quote the exact headline text of the single most relevant item from the Recent news & filings section. Reference the formType in parentheses (e.g., (8-K)).",
    'Do not claim "no recent news available" unless the Recent news & filings section is empty. Do not fabricate headlines.',
    'Use the Deterministic analysis section as precomputed inputs. Do not recalculate those values in the response.',
    'For chartHistory: write 2-3 sentences rating the ticker\'s technical posture and historical gap behavior. Read numeric inputs directly from the deterministicAnalysis JSON block (for gapCount, sameDayFadeRate, avgHighExtension, avgCloseVsOpen) and the priceContext JSON block (for rsi, ema9, ema21, high1m, low1m, sector). Translate those numbers into plain-English phrasing — e.g., "fades intraday about half the time", "averages ~25% above the open", "RSI 69 is approaching overbought", "trades between $2.98 and $6.57 over the last month". Do NOT echo the raw field identifiers in your output (no literal "gapCount", "sameDayFadeRate", "avgHighExtension", "avgCloseVsOpen", "high1m", "low1m", "ema9", or "ema21" tokens in the sentence). Do NOT count rows from the Historical Gap Data display table — trust the gapCount value in deterministicAnalysis (the display table may be a truncated view). Do NOT write "no historical gap data available" in chartHistory — that phrase belongs only to the gapStatsTable section. If gapCount is 0, still rate the chart setup using price-context technicals and acknowledge thin gap priors in one clause.',
  ].join('\n\n');
}

export async function loadSmallCapSystemPrompt() {
  const { buildLlmSystemPrompt } = await import('../prompts-loader');
  return buildLlmSystemPrompt('small-cap-trader');
}

/**
 * Generate a small-cap research report for a single ticker.
 * Reuses the agent's prompt + analysis pipeline but skips Discord delivery and memory persistence -
 * intended for the Research tab's site-only API route. Uses the BACKGROUND_LLM_API_KEY (paid lane).
 */
export interface ResearchReportGeneration {
  report: z.infer<typeof researchReportSchema>;
  llmUsage: {
    modelUsed: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
  };
}

export async function generateSmallCapResearchReport(
  ticker: string,
): Promise<ResearchReportGeneration> {
  const normalized = ticker.trim().toUpperCase();
  researchTickerInputSchema.parse({ ticker: normalized });

  // 1. Fetch AskEdgar data (cached helper).
  const askEdgarResult = await getCachedTickerData(normalized, { scope: 'small-cap-research' });
  const rawData = askEdgarResult.rawData as Record<string, unknown>;
  const dilutionRatingFirst = readResults(rawData['dilution-rating'])[0] ?? null;
  const cashPosition = (askEdgarResult as { dilutionDetails?: unknown }).dilutionDetails
    ?? readResults(rawData['dilution-data'])[0]
    ?? readResults(rawData['screener'])[0]
    ?? null;
  const managementCommentary =
    getStringField(dilutionRatingFirst, ['mgmt_commentary', 'managementCommentary', 'commentary'])
    ?? getStringField(cashPosition, ['managementCommentary', 'management_commentary']);

  const edgarSections = edgarSectionsSchema.parse({
    ticker: normalized,
    gapStats: readResults(rawData['gap-stats']),
    offerings: readResults(rawData['offerings']),
    registrations: readResults(rawData['registrations']),
    equityLines: readResults(rawData['equity-lines']),
    dilutionRating: dilutionRatingFirst,
    dilutionData: readResults(rawData['dilution-data']),
    ownership: readResults(rawData['ownership']),
    historicalFloat: readResults(rawData['historical-float-pro']),
    reverseSplits: readResults(rawData['reverse-splits']),
    splitStatus: readResults(rawData['split-status']),
    agreements: readResults(rawData['agreements']),
    nasdaqCompliance: readResults(rawData['nasdaq-compliance'])[0] ?? null,
    news: readResults(rawData['news']),
    filingTitles: readResults(rawData['filing-titles']),
    cashPosition,
    managementCommentary,
  });

  // 2. Add price context.
  const priceContext = await fetchTradingViewPriceContext(normalized);
  const withPriceContext = priceContextSchema.parse({ ...edgarSections, priceContext });

  // 3. Compute deterministic analysis + news feed.
  const { gapStatsTable, ...deterministicAnalysis } = computeDeterministicAnalysis(withPriceContext);
  const newsFeed = buildNewsFeedFromArrays(
    Array.isArray(withPriceContext.news) ? withPriceContext.news : [],
    { maxItems: 10, maxAgeDays: 30 },
  );
  const pipelineInput = researchPipelineInputSchema.parse({
    ...withPriceContext,
    deterministicAnalysis,
    gapStatsTable,
    newsFeed,
  });

  // 4. Call LLM via agent's background lane (paid Groq key).
  const llmResponse = await callLlm({
    systemPrompt: await loadSmallCapSystemPrompt(),
    userMessage: buildResearchPrompt(pipelineInput),
    temperature: 0.2,
  }, 'background');

  // 5. Parse + apply the same post-LLM commentary override the blueprint uses.
  const parsed = researchReportSchema.parse(parseJson(llmResponse.content));
  parsed.gapStatsTable = pipelineInput.gapStatsTable;

  const verbatimCommentary = pipelineInput.managementCommentary?.trim();
  if (verbatimCommentary) {
    parsed.financialCommentary = {
      ...parsed.financialCommentary,
      explanation: verbatimCommentary,
      source: 'verbatim',
    };
  } else {
    parsed.financialCommentary.source = 'llm';
  }

  return {
    report: parsed,
    llmUsage: {
      modelUsed: llmResponse.modelUsed,
      inputTokens: llmResponse.inputTokens,
      outputTokens: llmResponse.outputTokens,
      durationMs: llmResponse.durationMs,
    },
  };
}

export const smallCapResearchBlueprint: Blueprint = {
  id: 'small-cap-trader:research',
  description: 'Short-sell / dilution research for a single ticker.',
  steps: [
    {
      name: 'fetch-filings',
      type: 'code',
      inputSchema: researchTickerInputSchema,
      outputSchema: edgarSectionsSchema,
      metadata: { canRetry: true, timeoutMs: 30000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ jobInput }) => {
        const startedAt = Date.now();
        const rawInput = rawResearchInputSchema.parse(jobInput);
        const ticker = rawInput.ticker.trim().toUpperCase();
        researchTickerInputSchema.parse({ ticker });
        const result = await getCachedTickerData(ticker, { scope: 'small-cap-research' });
        const rawData = result.rawData as Record<string, unknown>;
        const dilutionRatingFirst = readResults(rawData['dilution-rating'])[0] ?? null;
        const cashPosition = (result as { dilutionDetails?: unknown }).dilutionDetails
          ?? readResults(rawData['dilution-data'])[0]
          ?? readResults(rawData['screener'])[0]
          ?? null;
        // AskEdgar's "Commentary on Financial Condition" lives on dilution-rating[0].mgmt_commentary.
        // Fall back to the cashPosition shape for safety in case AskEdgar ever inlines it there.
        const managementCommentary =
          getStringField(dilutionRatingFirst, ['mgmt_commentary', 'managementCommentary', 'commentary'])
          ?? getStringField(cashPosition, ['managementCommentary', 'management_commentary']);

        return completedResult({
          ticker,
          gapStats: readResults(rawData['gap-stats']),
          offerings: readResults(rawData['offerings']),
          registrations: readResults(rawData['registrations']),
          equityLines: readResults(rawData['equity-lines']),
          dilutionRating: dilutionRatingFirst,
          dilutionData: readResults(rawData['dilution-data']),
          ownership: readResults(rawData['ownership']),
          historicalFloat: readResults(rawData['historical-float-pro']),
          reverseSplits: readResults(rawData['reverse-splits']),
          splitStatus: readResults(rawData['split-status']),
          agreements: readResults(rawData['agreements']),
          nasdaqCompliance: readResults(rawData['nasdaq-compliance'])[0] ?? null,
          news: readResults(rawData['news']),
          filingTitles: readResults(rawData['filing-titles']),
          cashPosition,
          managementCommentary,
          warnings: Array.isArray((result as { warnings?: unknown }).warnings)
            ? (result as { warnings: string[] }).warnings
            : [],
          hasAnyData: Boolean((result as { hasAnyData?: unknown }).hasAnyData),
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: [`askedgar:${ticker}`],
        });
      },
    },
    {
      name: 'fetch-price-context',
      type: 'code',
      inputSchema: edgarSectionsSchema,
      outputSchema: priceContextSchema,
      metadata: { canRetry: true, timeoutMs: 15000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput }) => {
        const startedAt = Date.now();
        const edgarSections = edgarSectionsSchema.parse(previousOutput);
        const priceContext = await fetchTradingViewPriceContext(edgarSections.ticker);

        return completedResult({
          ...edgarSections,
          priceContext,
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: [`tradingview:${edgarSections.ticker}`],
          upstreamStepIds: ['fetch-filings'],
        });
      },
    },
    {
      name: 'compute-deterministic',
      type: 'code',
      inputSchema: priceContextSchema,
      outputSchema: researchPipelineInputSchema,
      metadata: { canRetry: true, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ previousOutput }) => {
        const startedAt = Date.now();
        const input = priceContextSchema.parse(previousOutput);
        const { gapStatsTable, ...deterministicAnalysis } = computeDeterministicAnalysis(input);

        return completedResult({
          ...input,
          deterministicAnalysis,
          gapStatsTable,
          newsFeed: buildNewsFeedFromArrays(
            asArray(input.news),
            { maxItems: 10, maxAgeDays: 30 },
          ),
        }, {
          durationMs: Date.now() - startedAt,
          upstreamStepIds: ['fetch-price-context'],
        });
      },
    },
    {
      name: 'synthesize-report',
      type: 'llm',
      inputSchema: researchPipelineInputSchema,
      outputSchema: researchReportSchema,
      metadata: {
        canRetry: true,
        timeoutMs: 60000,
        maxRepairAttempts: 1,
        sideEffect: false,
        lane: 'background',
      },
      run: async ({ previousOutput }) => {
        const input = researchPipelineInputSchema.parse(previousOutput);
        const llmResponse = await callLlm({
          systemPrompt: await loadSmallCapSystemPrompt(),
          userMessage: buildResearchPrompt(input),
          temperature: 0.2,
        }, 'background');
        const parsed = researchReportSchema.parse(parseJson(llmResponse.content));
        parsed.gapStatsTable = input.gapStatsTable;

        // Override the LLM's financialCommentary explanation with AskEdgar's verbatim
        // mgmt_commentary when present. The LLM-assigned rating is preserved either way.
        const verbatimCommentary = input.managementCommentary?.trim();
        if (verbatimCommentary) {
          parsed.financialCommentary = {
            ...parsed.financialCommentary,
            explanation: verbatimCommentary,
            source: 'verbatim',
          };
        } else {
          parsed.financialCommentary.source = 'llm';
        }

        return completedResult(parsed, {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['compute-deterministic'],
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
      inputSchema: researchReportSchema,
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async ({ previousOutput, job, db }) => {
        const report = researchReportSchema.parse(previousOutput);
        const delivery = await writeAndDeliverReport(db, {
          jobId: job.id,
          userId: job.userId,
          agentId: 'small-cap-trader',
          reportType: 'research',
          title: `${report.ticker} Small-Cap Research`,
          summary: `${report.overallOfferingRisk.rating.toUpperCase()} offering risk — ${report.overallOfferingRisk.explanation.slice(0, 120)}`,
          reportJson: report,
        });

        await upsertMemory(db, {
          userId: job.userId,
          agentId: 'small-cap-trader',
          category: 'thesis',
          key: report.ticker,
          value: `${report.overallOfferingRisk.rating.toUpperCase()} offering risk — ${report.confidence} confidence`,
          valueJson: {
            overallOfferingRisk: report.overallOfferingRisk.rating,
            dilution: report.dilution.rating,
            cashNeed: report.cashNeed.rating,
            offeringAbility: report.offeringAbility.rating,
            confidence: report.confidence,
          },
          source: `report:${job.id}`,
          confidence: report.confidence,
          expiresAt: new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)),
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
