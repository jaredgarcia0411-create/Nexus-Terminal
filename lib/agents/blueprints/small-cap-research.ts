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
    `Filings:\n${JSON.stringify(input.filings)}`,
    `Cash position:\n${JSON.stringify(input.cashPosition)}`,
    `Price context:\n${JSON.stringify(input.priceContext)}`,
    'Use the JMT traffic-light rating system. Each rating must be "green", "yellow", or "red" (lowercase).',
    'For jmt415Commentary: if no jmt415-tagged news items exist in the data, set to null.',
    'For historicalStats: summarize gap-stats patterns (avg gap fade, same-day fade count, typical range). If no gap-stats data, say "No historical gap data available."',
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
      outputSchema: researchReportSchema,
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
          systemPrompt: await loadSmallCapSystemPrompt(),
          userMessage: buildResearchPrompt(input),
          temperature: 0.2,
        }, 'background');

        return completedResult(researchReportSchema.parse(parseJson(llmResponse.content)), {
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
