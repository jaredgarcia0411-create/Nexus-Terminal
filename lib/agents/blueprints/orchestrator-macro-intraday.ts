import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { agentReports } from '@/lib/db/schema';
import { fetchUnifiedSnapshot, type MassiveSnapshotResult } from '@/lib/massive-market';
import { writeAndDeliverReport } from '../discord';
import { callLlm } from '../llm-client';
import type { AgentDb } from '../db';
import type {
  Blueprint,
  CrossAssetEntry,
  StepResult,
} from '../types';

const INTRADAY_TICKERS = ['SPY', 'QQQ', 'IWM', 'TLT', 'UUP', 'UVXY'];

const intradayJobInputSchema = z.object({
  tradingDate: z.string().optional(),
  intradayUpdate: z.boolean().optional(),
});

const crossAssetSnapshotSchema = z.object({
  ticker: z.string(),
  price: z.number().nullable(),
  changePercent: z.number().nullable(),
});

const morningReportSchema = z.object({
  tradingDate: z.string(),
  marketBias: z.enum(['bullish', 'bearish', 'neutral']),
  summary: z.string(),
  keyLevels: z.array(z.object({
    ticker: z.string(),
    support: z.string(),
    resistance: z.string(),
    note: z.string(),
  })),
  tldr: z.array(z.string()),
}).passthrough();

const sessionSnapshotSchema = z.object({
  tradingDate: z.string(),
  crossAssetSnapshot: z.array(crossAssetSnapshotSchema),
  morningReport: morningReportSchema.nullable(),
});

const intradayBriefingSchema = z.object({
  sessionBias: z.enum(['bullish', 'bearish', 'neutral']),
  sessionSummary: z.string(),
  surprises: z.array(z.string()),
  updatedKeyWatch: z.string(),
  deskNote: z.string(),
});

function completedResult<T>(
  data: T,
  options?: {
    durationMs?: number;
    tokensUsed?: number;
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
      sourceIds: [],
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
  const parsed = intradayJobInputSchema.safeParse(jobInput);
  return parsed.success && parsed.data.tradingDate
    ? parsed.data.tradingDate
    : new Date().toISOString().slice(0, 10);
}

async function loadOrchestratorSystemPrompt() {
  const { buildLlmSystemPrompt } = await import('../prompts-loader');
  return buildLlmSystemPrompt('orchestrator');
}

function buildIntradayPrompt(input: z.infer<typeof sessionSnapshotSchema>): string {
  const morningReport = input.morningReport
    ? {
        tradingDate: input.morningReport.tradingDate,
        marketBias: input.morningReport.marketBias,
        summary: input.morningReport.summary,
        keyLevels: input.morningReport.keyLevels,
        tldr: input.morningReport.tldr,
      }
    : null;

  return [
    `Trading date: ${input.tradingDate}`,
    '',
    'You are writing a mid-day macro update for active day traders. Compare the current session to the morning brief and focus on what changed, what surprised, and what matters into the close.',
    '',
    'Return strict JSON with this shape and no markdown:',
    JSON.stringify({
      sessionBias: 'bullish | bearish | neutral',
      sessionSummary: '2 sentence summary of how the session is unfolding vs the morning thesis',
      surprises: ['1-3 concise bullets on what is surprising relative to the morning brief'],
      updatedKeyWatch: '1 sentence on the most important level, catalyst, or risk into the close',
      deskNote: '1 sentence actionable note for the desk right now',
    }, null, 2),
    '',
    'Rules:',
    '- sessionSummary must compare current action against the morning setup, not just restate prices.',
    '- surprises should only include concrete changes, dislocations, or reversals.',
    '- updatedKeyWatch must name a specific level, event, or cross-asset signal.',
    '- deskNote must be actionable and time-sensitive.',
    '',
    `Current session snapshot:\n${JSON.stringify(input.crossAssetSnapshot, null, 2)}`,
    '',
    morningReport
      ? `Morning brief context:\n${JSON.stringify(morningReport, null, 2)}`
      : 'Morning brief context: none available. Infer comparison from the current session only.',
  ].join('\n');
}

async function fetchMorningReport(
  db: AgentDb,
  tradingDate: string,
): Promise<z.infer<typeof morningReportSchema> | null> {
  const [row] = await db
    .select({ reportJson: agentReports.reportJson })
    .from(agentReports)
    .where(
      and(
        eq(agentReports.userId, 'system-agent-user'),
        eq(agentReports.agentId, 'orchestrator'),
        eq(agentReports.reportType, 'macro-summary'),
        eq(agentReports.status, 'published'),
        gte(agentReports.createdAt, new Date(`${tradingDate}T00:00:00.000Z`)),
      ),
    )
    .orderBy(desc(agentReports.createdAt))
    .limit(1);

  if (!row?.reportJson || typeof row.reportJson !== 'object') {
    return null;
  }

  const parsed = morningReportSchema.safeParse(row.reportJson);
  return parsed.success ? parsed.data : null;
}

export const orchestratorMacroIntradayBlueprint: Blueprint = {
  id: 'orchestrator:macro-intraday',
  description: 'Optional intraday macro update that compares the live session to the morning brief.',
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
            const snapshot = await fetchUnifiedSnapshot(INTRADAY_TICKERS);
            const results = Array.isArray((snapshot as { results?: MassiveSnapshotResult[] })?.results)
              ? (snapshot as { results: MassiveSnapshotResult[] }).results
              : [];
            crossAssetSnapshot = results.map((result) => ({
              ticker: typeof result.ticker === 'string' && result.ticker.trim()
                ? result.ticker.trim().toUpperCase()
                : 'UNKNOWN',
              price: result.session?.close ?? null,
              changePercent: result.session?.change_percent ?? null,
            }));
          } catch {
            // Snapshot unavailable - continue with what we have.
          }
        }

        let morningReport: z.infer<typeof morningReportSchema> | null = null;
        try {
          morningReport = await fetchMorningReport(db, tradingDate);
        } catch {
          // No morning report yet - intraday runs blind.
        }

        return completedResult({
          tradingDate,
          crossAssetSnapshot,
          morningReport,
        }, {
          durationMs: Date.now() - startedAt,
        });
      },
    },
    {
      name: 'generate-intraday-briefing',
      type: 'llm',
      inputSchema: sessionSnapshotSchema,
      outputSchema: intradayBriefingSchema,
      metadata: {
        canRetry: true,
        timeoutMs: 45000,
        maxRepairAttempts: 1,
        sideEffect: false,
        lane: 'background',
      },
      run: async ({ previousOutput }) => {
        const input = sessionSnapshotSchema.parse(previousOutput);
        const llmResponse = await callLlm({
          systemPrompt: await loadOrchestratorSystemPrompt(),
          userMessage: buildIntradayPrompt(input),
          temperature: 0.2,
        }, 'background');

        const briefing = intradayBriefingSchema.parse(parseJson(llmResponse.content));
        return completedResult(briefing, {
          durationMs: llmResponse.durationMs,
          tokensUsed: llmResponse.inputTokens + llmResponse.outputTokens,
          model: llmResponse.modelUsed,
          upstreamStepIds: ['fetch-session-snapshot'],
          artifacts: {
            inputTokens: llmResponse.inputTokens,
            outputTokens: llmResponse.outputTokens,
            modelUsed: llmResponse.modelUsed,
          },
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
        const reportJson = {
          tradingDate,
          ...briefing,
        };

        const delivery = await writeAndDeliverReport(db, {
          jobId: job.id,
          userId: 'system-agent-user',
          agentId: 'orchestrator',
          reportType: 'macro-intraday',
          title: `${tradingDate} intraday macro update`,
          summary: briefing.sessionSummary,
          reportJson,
        });

        return completedResult({
          tradingDate,
          ...delivery,
        }, {
          durationMs: 0,
          upstreamStepIds: ['generate-intraday-briefing'],
        });
      },
    },
  ],
};
