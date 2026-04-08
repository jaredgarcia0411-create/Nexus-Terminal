import { z } from 'zod';
import { fetchUnifiedSnapshot } from '@/lib/massive-market';
import { writeAndDeliverReport } from '../discord';
import { callLlm } from '../llm-client';
import { fetchPageText } from '../scrape-lite';
import type { Blueprint, StepResult } from '../types';

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

const snapshotSchema = headlinesSchema.extend({
  snapshot: z.unknown().nullable(),
  note: z.string().nullable().optional(),
});

const macroBriefingSchema = z.object({
  summary: z.string(),
  keyEvents: z.array(z.string()),
  sectorNotes: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
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

function buildBriefingPrompt(
  tradingDate: string,
  input: z.infer<typeof snapshotSchema>,
): string {
  return [
    `Trading date: ${tradingDate}`,
    'Return strict JSON with this shape and no markdown:',
    JSON.stringify({
      summary: '2-3 sentence daily macro briefing',
      keyEvents: ['headline takeaway'],
      sectorNotes: ['sector rotation note'],
      confidence: 'high | medium | low',
    }, null, 2),
    `Headlines:\n${JSON.stringify(input.headlines)}`,
    `Market snapshot:\n${JSON.stringify(input.snapshot)}`,
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

        if (!process.env.MASSIVE_API_KEY?.trim()) {
          return completedResult({
            ...headlines,
            snapshot: null,
            note: 'no massive api key',
          }, {
            durationMs: Date.now() - startedAt,
            sourceIds: MACRO_TICKERS,
            upstreamStepIds: ['scrape-headlines'],
          });
        }

        const snapshot = await fetchUnifiedSnapshot(MACRO_TICKERS);
        return completedResult({
          ...headlines,
          snapshot,
          note: null,
        }, {
          durationMs: Date.now() - startedAt,
          sourceIds: MACRO_TICKERS,
          upstreamStepIds: ['scrape-headlines'],
        });
      },
    },
    {
      name: 'generate-briefing',
      type: 'llm',
      inputSchema: snapshotSchema,
      outputSchema: macroBriefingSchema,
      metadata: {
        canRetry: true,
        timeoutMs: 60000,
        maxRepairAttempts: 1,
        sideEffect: false,
        lane: 'background',
      },
      run: async ({ jobInput, previousOutput }) => {
        const input = snapshotSchema.parse(previousOutput);
        const llmResponse = await callLlm({
          systemPrompt: await loadOrchestratorSystemPrompt(),
          userMessage: buildBriefingPrompt(getTradingDate(jobInput), input),
          temperature: 0.2,
        }, 'background');

        return completedResult(macroBriefingSchema.parse(parseJson(llmResponse.content)), {
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
      inputSchema: macroBriefingSchema,
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async ({ jobInput, previousOutput, job, db }) => {
        const briefing = macroBriefingSchema.parse(previousOutput);
        const tradingDate = getTradingDate(jobInput);
        const delivery = await writeAndDeliverReport(db, {
          jobId: job.id,
          userId: 'system-agent-user',
          agentId: 'orchestrator',
          reportType: 'macro-summary',
          title: `${tradingDate} macro briefing`,
          summary: briefing.summary,
          reportJson: {
            tradingDate,
            ...briefing,
          },
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
