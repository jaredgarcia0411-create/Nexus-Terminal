import { z } from 'zod';
import { getCachedTickerData } from '@/lib/askedgar';
import { writeAndDeliverReport } from '../discord';
import { callLlm } from '../llm-client';
import type { Blueprint, StepResult } from '../types';

const TRADINGVIEW_COLUMNS = [
  'name',
  'close',
  'change',
  'volume',
  'average_volume_90d_calc',
  'market_cap_basic',
  'sector',
  'High.1W',
  'Low.1W',
  'RSI',
  'MACD.macd',
  'EMA9',
  'EMA21',
];

const researchTickerInputSchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,5}$/),
});

const rawResearchInputSchema = z.object({
  ticker: z.string().min(1),
});

const edgarSectionsSchema = z.object({
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
  pumpAndDumpTracker: z.unknown().nullable(),
  news: z.array(z.unknown()),
  cashPosition: z.unknown().nullable(),
});

const priceContextSchema = edgarSectionsSchema.extend({
  priceContext: z.object({
    price: z.number(),
    change: z.number().nullable(),
    volume: z.number().nullable(),
    avgVolume90d: z.number().nullable(),
    marketCap: z.number().nullable(),
    sector: z.string().nullable(),
    high1w: z.number().nullable(),
    low1w: z.number().nullable(),
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
});

const researchPipelineInputSchema = priceContextSchema.extend({
  deterministicAnalysis: deterministicAnalysisSchema,
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

const researchReportSchema = z.object({
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
  historicalStats: z.string(),
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

function readResults(
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

function getStringField(source: unknown, keys: string[]): string | null {
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
  const high = getNumberField(value, ['high', 'intradayHigh', 'intraday_high']);

  if (open === null || close === null || high === null || !Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(high) || open === 0) {
    return null;
  }

  return { open, close, high };
}

function normalizeHistoricalFloatRow(value: unknown): {
  date: Date;
  float: number;
} | null {
  if (!isValidRecord(value)) {
    return null;
  }

  const date = parseLooseDate(getFieldValue(value, ['date', 'reportedDate', 'reported_date']));
  const floatValue = getNumberField(value, ['float', 'tradableFloat', 'tradable_float']);

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

function computeDeterministicAnalysis(input: z.infer<typeof priceContextSchema>): z.infer<typeof deterministicAnalysisSchema> {
  const gapRows = asArray(input.gapStats)
    .map(normalizeGapRow)
    .filter((row): row is { open: number; close: number; high: number } => row !== null);

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
    high1w: toNullableNumber(row.d[7]),
    low1w: toNullableNumber(row.d[8]),
    rsi: toNullableNumber(row.d[9]),
    macdSignal: toNullableNumber(row.d[10]),
    ema9: toNullableNumber(row.d[11]),
    ema21: toNullableNumber(row.d[12]),
  };
}

function buildResearchPrompt(input: z.infer<typeof researchPipelineInputSchema>): string {
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
    historicalStats: 'string summary of gap-stats data',
    confidence: 'high | medium | low',
    evidenceIds: ['string'],
  };

  return [
    `Ticker: ${input.ticker}`,
    'Return strict JSON matching this exact shape (no markdown, no extra keys):',
    JSON.stringify(exampleShape, null, 2),
    formatPromptSection('Price context', input.priceContext),
    [
      'AskEdgar sections:',
      formatPromptSection('gapStats', input.gapStats),
      formatPromptSection('offerings', input.offerings),
      formatPromptSection('registrations', input.registrations),
      formatPromptSection('equityLines', input.equityLines),
      formatPromptSection('dilutionRating', input.dilutionRating),
      formatPromptSection('dilutionData', input.dilutionData),
      formatPromptSection('ownership', input.ownership),
      formatPromptSection('historicalFloat', input.historicalFloat),
      formatPromptSection('reverseSplits', input.reverseSplits),
      formatPromptSection('splitStatus', input.splitStatus),
      formatPromptSection('agreements', input.agreements),
      formatPromptSection('nasdaqCompliance', input.nasdaqCompliance),
      formatPromptSection('pumpAndDumpTracker', input.pumpAndDumpTracker),
      formatPromptSection('news', input.news),
      formatPromptSection('cashPosition', input.cashPosition),
    ].join('\n\n'),
    formatPromptSection('Deterministic analysis', input.deterministicAnalysis),
    'Use the JMT traffic-light rating system. Each rating must be "green", "yellow", or "red" (lowercase).',
    'For jmt415Commentary: if no jmt415-tagged news items exist in the data, set to null.',
    'For historicalStats: summarize gap-stats patterns (avg gap fade, same-day fade count, typical range). If no gap-stats data, say "No historical gap data available."',
    'Use the Deterministic analysis section as precomputed inputs. Do not recalculate those values in the response.',
  ].join('\n\n');
}

async function loadSmallCapSystemPrompt() {
  const { buildLlmSystemPrompt } = await import('../prompts-loader');
  return buildLlmSystemPrompt('small-cap-trader');
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
        const result = await getCachedTickerData(ticker);
        const rawData = result.rawData as Record<string, unknown>;
        const cashPosition = (result as { dilutionDetails?: unknown }).dilutionDetails
          ?? readResults(rawData['dilution-data'])[0]
          ?? readResults(rawData['screener'])[0]
          ?? null;

        return completedResult({
          ticker,
          gapStats: readResults(rawData['gap-stats']),
          offerings: readResults(rawData['offerings']),
          registrations: readResults(rawData['registrations']),
          equityLines: readResults(rawData['equity-lines']),
          dilutionRating: readResults(rawData['dilution-rating'])[0] ?? null,
          dilutionData: readResults(rawData['dilution-data']),
          ownership: readResults(rawData['ownership']),
          historicalFloat: readResults(rawData['historical-float-pro']),
          reverseSplits: readResults(rawData['reverse-splits']),
          splitStatus: readResults(rawData['split-status']),
          agreements: readResults(rawData['agreements']),
          nasdaqCompliance: readResults(rawData['nasdaq-compliance'])[0] ?? null,
          pumpAndDumpTracker: readResults(rawData['pump-and-dump-tracker'])[0] ?? null,
          news: readResults(rawData['news']),
          cashPosition,
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
        const deterministicAnalysis = computeDeterministicAnalysis(input);

        return completedResult({
          ...input,
          deterministicAnalysis,
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

        return completedResult(researchReportSchema.parse(parseJson(llmResponse.content)), {
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
