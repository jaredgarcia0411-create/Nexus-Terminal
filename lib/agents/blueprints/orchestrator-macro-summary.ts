import { z } from 'zod';
import { fetchUnifiedSnapshot, type MassiveSnapshotResult } from '@/lib/massive-market';
import { writeAndDeliverReport } from '../discord';
import { callLlm } from '../llm-client';
import { fetchPageText } from '../scrape-lite';
import type {
  Blueprint,
  CrossAssetEntry,
  MacroSummaryReport,
  MacroSource,
  StepResult,
} from '../types';

const DEFAULT_MACRO_HEADLINES_URLS = 'https://www.marketwatch.com/latest-news,https://finance.yahoo.com/topic/stock-market-news/';
const MACRO_TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLE', 'XLF', 'XLK', 'GLD', 'USO', 'TLT'];

const macroJobInputSchema = z.object({
  tradingDate: z.string().optional(),
});

const headlinesSchema = z.object({
  headlines: z.array(z.object({
    url: z.string(),
    text: z.string(),
  })),
});

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

const macroBriefingDraftSchema = z.object({
  crossAssetSnapshot: macroBriefingContextSchema.shape.crossAssetSnapshot,
  sourceIndex: macroBriefingContextSchema.shape.sourceIndex,
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

function buildBriefingPrompt(
  tradingDate: string,
  input: z.infer<typeof macroBriefingContextSchema>,
): string {
  return [
    `Trading date: ${tradingDate}`,
    'Return strict JSON with this shape and no markdown:',
    JSON.stringify({
      marketBias: 'bullish | bearish | neutral',
      summary: '2-3 sentence daily macro briefing',
      drivers: [{
        driver: 'headline or market driver',
        impact: 'positive | negative | mixed',
        sourceRefs: ['headline:marketwatch.com'],
      }],
      scheduledCatalysts: [{
        event: 'scheduled catalyst',
        date: 'YYYY-MM-DD or null',
        expectedImpact: 'brief description',
      }],
      sectorRotation: ['sector rotation note'],
      deskImplications: ['brief trading implication'],
      confidence: 'high | medium | low',
    }, null, 2),
    'Every driver must include at least one sourceRefs entry, and each sourceRefs value must match an id from sourceIndex.',
    `Headlines:\n${JSON.stringify(input.headlines, null, 2)}`,
    `Cross-asset snapshot:\n${JSON.stringify(input.crossAssetSnapshot, null, 2)}`,
    `Source index:\n${JSON.stringify(input.sourceIndex, null, 2)}`,
    `Market snapshot:\n${JSON.stringify(input.snapshot, null, 2)}`,
    input.note ? `Snapshot note: ${input.note}` : null,
  ].filter(Boolean).join('\n\n');
}

async function loadOrchestratorSystemPrompt() {
  const { buildLlmSystemPrompt } = await import('../prompts-loader');
  return buildLlmSystemPrompt('orchestrator');
}

export const orchestratorMacroSummaryBlueprint: Blueprint = {
  id: 'orchestrator:macro-summary',
  description: 'Daily macro briefing — headlines + market snapshot + LLM synthesis + persisted report.',
  steps: [
    {
      name: 'scrape-headlines',
      type: 'code',
      outputSchema: headlinesSchema,
      metadata: { canRetry: true, timeoutMs: 20000, maxRepairAttempts: 0, sideEffect: false },
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

        return completedResult({ headlines }, {
          durationMs: Date.now() - startedAt,
          sourceIds: urls,
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
      name: 'generate-briefing',
      type: 'llm',
      inputSchema: macroBriefingContextSchema,
      outputSchema: macroBriefingDraftSchema,
      metadata: {
        canRetry: true,
        timeoutMs: 60000,
        maxRepairAttempts: 1,
        sideEffect: false,
        lane: 'background',
      },
      run: async ({ jobInput, previousOutput }) => {
        const input = macroBriefingContextSchema.parse(previousOutput);
        const llmResponse = await callLlm({
          systemPrompt: await loadOrchestratorSystemPrompt(),
          userMessage: buildBriefingPrompt(getTradingDate(jobInput), input),
          temperature: 0.2,
        }, 'background');

        const briefing = macroBriefingDraftSchema.parse({
          crossAssetSnapshot: input.crossAssetSnapshot,
          sourceIndex: input.sourceIndex,
          ...macroBriefingSchema.parse(parseJson(llmResponse.content)),
        });

        return completedResult(briefing, {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['fetch-market-snapshot'],
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
        const reportJson: MacroSummaryReport = {
          tradingDate,
          ...briefing,
        };
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
