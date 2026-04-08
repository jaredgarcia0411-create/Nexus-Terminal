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
];

const researchInputSchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,5}$/),
});

const rawResearchInputSchema = z.object({
  ticker: z.string().min(1),
});

const filingsSchema = z.object({
  ticker: z.string(),
  filings: z.array(z.unknown()),
  cashPosition: z.unknown().nullable(),
});

const priceContextSchema = filingsSchema.extend({
  priceContext: z.object({
    price: z.number(),
    change: z.number().nullable(),
    volume: z.number().nullable(),
    avgVolume90d: z.number().nullable(),
    marketCap: z.number().nullable(),
    sector: z.string().nullable(),
  }).nullable(),
});

const swingResearchSchema = z.object({
  ticker: z.string(),
  mdrSimilarity: z.number().min(0).max(100),
  volumeSurgeRatio: z.number(),
  levels: z.object({
    entry: z.number(),
    stop: z.number(),
    targets: z.array(z.number()),
  }),
  recommendation: z.enum(['HOLD', 'ADD', 'TRIM', 'EXIT', 'WATCH']),
  patternClassification: z.enum(['BREAKOUT', 'EXHAUSTION', 'CONTINUATION', 'STOPPED']),
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
  };
}

function buildResearchPrompt(input: z.infer<typeof priceContextSchema>): string {
  return [
    `Ticker: ${input.ticker}`,
    'Return strict JSON with this shape and no markdown:',
    JSON.stringify({
      ticker: input.ticker,
      mdrSimilarity: 72,
      volumeSurgeRatio: 3.4,
      levels: { entry: 12.5, stop: 11.8, targets: [13.2, 14.1] },
      recommendation: 'WATCH | HOLD | ADD | TRIM | EXIT',
      patternClassification: 'BREAKOUT | EXHAUSTION | CONTINUATION | STOPPED',
      confidence: 'high | medium | low',
      evidenceIds: ['string'],
    }, null, 2),
    `Filings:\n${JSON.stringify(input.filings)}`,
    `Cash position:\n${JSON.stringify(input.cashPosition)}`,
    `Price context:\n${JSON.stringify(input.priceContext)}`,
    'Focus on MDR similarity, momentum quality, and actionable entry/stop/target levels.',
  ].join('\n\n');
}

function buildReportSummary(report: z.infer<typeof swingResearchSchema>): string {
  return `${report.recommendation} ${report.patternClassification} setup with ${report.mdrSimilarity}% MDR similarity`;
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
        const result = await getCachedTickerData(ticker);
        const rawData = result.rawData as Record<string, unknown>;
        const filings = [
          ...asArray((result as { offerings?: unknown[] }).offerings),
          ...asArray((result as { registrations?: unknown[] }).registrations),
          ...readResults(rawData['filing-titles']),
        ];
        const cashPosition = (result as { dilutionDetails?: unknown }).dilutionDetails
          ?? readResults(rawData['dilution-data'])[0]
          ?? readResults(rawData.screener)[0]
          ?? null;

        return completedResult({
          ticker,
          filings,
          cashPosition,
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
      name: 'synthesize-report',
      type: 'llm',
      inputSchema: priceContextSchema,
      outputSchema: swingResearchSchema,
      metadata: {
        canRetry: true,
        timeoutMs: 60000,
        maxRepairAttempts: 1,
        sideEffect: false,
        lane: 'background',
      },
      run: async ({ previousOutput }) => {
        const input = priceContextSchema.parse(previousOutput);
        const llmResponse = await callLlm({
          systemPrompt: await loadSwingTraderSystemPrompt(),
          userMessage: buildResearchPrompt(input),
          temperature: 0.2,
        }, 'background');

        return completedResult(swingResearchSchema.parse(parseJson(llmResponse.content)), {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['fetch-price-context'],
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
          title: `${report.ticker} swing research`,
          summary: buildReportSummary(report),
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
