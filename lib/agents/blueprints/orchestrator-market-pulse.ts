import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';

import { wrapUntrusted } from '@/lib/agents/trust-boundary';
import { agentReports, marketPulseDailyBars, marketPulseDailyStats } from '@/lib/db/schema';
import { writeAndDeliverReport } from '../discord';
import { callLlm } from '../llm-client';
import type {
  Blueprint,
  MarketPulseReport,
  StepResult,
} from '../types';

const marketPulseJobInputSchema = z.object({
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const rolling30Schema = z.object({
  tradingDays: z.number(),
  avgAdvancerPct: z.number().nullable(),
  medianAdvancerPct: z.number().nullable(),
  strongDays: z.number(),
  weakDays: z.number(),
  newHigh30dAvg: z.number().nullable(),
  newLow30dAvg: z.number().nullable(),
});

const overview90Schema = z.object({
  tradingDays: z.number(),
  trend: z.enum(['improving', 'flat', 'deteriorating']),
  strongestDate: z.string().nullable(),
  weakestDate: z.string().nullable(),
  note: z.string(),
});

const marketPulseContextSchema = z.object({
  tradingDate: z.string(),
  stats: z.object({
    tickerCount: z.number(),
    advancers: z.number(),
    decliners: z.number(),
    unchanged: z.number(),
    advancerPct: z.number(),
    declinerPct: z.number(),
    upVolume: z.number(),
    downVolume: z.number(),
    totalVolume: z.number(),
    medianChangePct: z.number().nullable(),
    avgChangePct: z.number().nullable(),
    pctAbovePrevClose: z.number().nullable(),
    pctAboveDollarVolumeFloor: z.number().nullable(),
    newHigh30dCount: z.number(),
    newLow30dCount: z.number(),
    rolling30: rolling30Schema,
    overview90: overview90Schema.nullable(),
  }),
  leaders: z.array(z.object({
    ticker: z.string(),
    changePct: z.number(),
    volume: z.number(),
    dollarVolume: z.number(),
    sector: z.string().nullable(),
  })),
  laggards: z.array(z.object({
    ticker: z.string(),
    changePct: z.number(),
    volume: z.number(),
    dollarVolume: z.number(),
    sector: z.string().nullable(),
  })),
  sourceIndex: z.array(z.object({
    id: z.string(),
    label: z.string(),
    source: z.enum(['massive', 'tradingview', 'computed']),
    asOf: z.string(),
  })),
});

const marketPulseDraftSchema = z.object({
  marketStrength: z.enum(['strong', 'mixed', 'weak']),
  confidence: z.enum(['high', 'medium', 'low']),
  tldr: z.array(z.string()),
  summary: z.string(),
  sectorNotes: z.array(z.string()),
  riskFlags: z.array(z.string()),
}).and(z.object({
  tradingDate: z.string(),
  breadth: z.object({
    advancers: z.number(),
    decliners: z.number(),
    unchanged: z.number(),
    advancerPct: z.number(),
    upVolumePct: z.number().nullable(),
  }),
  rolling30: rolling30Schema,
  overview90: overview90Schema.optional(),
  leaders: marketPulseContextSchema.shape.leaders,
  laggards: marketPulseContextSchema.shape.laggards,
  sourceIndex: marketPulseContextSchema.shape.sourceIndex,
}));

function completedResult<T>(
  data: T,
  options?: {
    durationMs?: number;
    tokensUsed?: number;
    sourceIds?: string[];
    upstreamStepIds?: string[];
    model?: string;
  },
): StepResult<T> {
  return {
    status: 'completed',
    data,
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

function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeJson<T>(value: unknown, fallback: T): T {
  return value && typeof value === 'object' ? value as T : fallback;
}

function buildChangeRows(
  bars: Array<{
    ticker: string;
    open: number;
    close: number;
    volume: number;
    dollarVolume: number;
    sector: string | null;
  }>,
) {
  return bars.flatMap((bar) => {
    if (!Number.isFinite(bar.open) || bar.open === 0) return [];
    return [{
      ticker: bar.ticker,
      changePct: ((bar.close - bar.open) / bar.open) * 100,
      volume: bar.volume,
      dollarVolume: bar.dollarVolume,
      sector: bar.sector,
    }];
  });
}

function rankRows(
  rows: ReturnType<typeof buildChangeRows>,
  direction: 'asc' | 'desc',
) {
  return [...rows]
    .sort((a, b) => direction === 'desc' ? b.changePct - a.changePct : a.changePct - b.changePct)
    .slice(0, 5)
    .map((row) => ({
      ...row,
      changePct: Math.round(row.changePct * 100) / 100,
    }));
}

function strengthFromAdvancers(advancerPct: number): 'strong' | 'mixed' | 'weak' {
  if (advancerPct >= 55) return 'strong';
  if (advancerPct <= 45) return 'weak';
  return 'mixed';
}

function buildPrompt(context: z.infer<typeof marketPulseContextSchema>): string {
  return [
    'Generate a concise Market Pulse / Market Strength report as JSON only.',
    'Use only the deterministic stored metrics below. Do not claim intraday patterns, new HOD after 11am, or premarket-high breaks because v1 excludes those inputs.',
    'Required JSON keys: marketStrength, confidence, tldr, summary, sectorNotes, riskFlags.',
    `Deterministic payload:\n${wrapUntrusted('market-pulse-context', JSON.stringify(context, null, 2))}`,
  ].join('\n\n');
}

export const orchestratorMarketPulseBlueprint: Blueprint = {
  id: 'orchestrator:market-pulse',
  description: 'Builds the site-first Market Pulse report from stored market breadth data.',
  steps: [
    {
      name: 'load-market-pulse-context',
      type: 'code',
      inputSchema: marketPulseJobInputSchema,
      outputSchema: marketPulseContextSchema,
      metadata: { canRetry: true, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: false },
      run: async ({ jobInput, db }) => {
        const parsed = marketPulseJobInputSchema.parse(jobInput);
        const [statsRow] = parsed.tradingDate
          ? await db.select()
            .from(marketPulseDailyStats)
            .where(eq(marketPulseDailyStats.tradeDate, parsed.tradingDate))
            .orderBy(desc(marketPulseDailyStats.tradeDate))
            .limit(1)
          : await db.select()
            .from(marketPulseDailyStats)
            .orderBy(desc(marketPulseDailyStats.tradeDate))
            .limit(1);
        if (!statsRow) {
          throw new Error('No market pulse stats available');
        }

        const tradingDate = toDateString(statsRow.tradeDate);
        const barRows = await db.select({
          ticker: marketPulseDailyBars.ticker,
          open: marketPulseDailyBars.open,
          close: marketPulseDailyBars.close,
          volume: marketPulseDailyBars.volume,
          dollarVolume: marketPulseDailyBars.dollarVolume,
          sector: marketPulseDailyBars.sector,
        })
          .from(marketPulseDailyBars)
          .where(eq(marketPulseDailyBars.tradeDate, tradingDate));

        const rankedRows = buildChangeRows(barRows.map((row) => ({
          ticker: row.ticker,
          open: toNumber(row.open),
          close: toNumber(row.close),
          volume: toNumber(row.volume),
          dollarVolume: toNumber(row.dollarVolume),
          sector: row.sector ?? null,
        })));
        const context = marketPulseContextSchema.parse({
          tradingDate,
          stats: {
            tickerCount: statsRow.tickerCount,
            advancers: statsRow.advancers,
            decliners: statsRow.decliners,
            unchanged: statsRow.unchanged,
            advancerPct: statsRow.advancerPct,
            declinerPct: statsRow.declinerPct,
            upVolume: statsRow.upVolume,
            downVolume: statsRow.downVolume,
            totalVolume: statsRow.totalVolume,
            medianChangePct: toNullableNumber(statsRow.medianChangePct),
            avgChangePct: toNullableNumber(statsRow.avgChangePct),
            pctAbovePrevClose: toNullableNumber(statsRow.pctAbovePrevClose),
            pctAboveDollarVolumeFloor: toNullableNumber(statsRow.pctAboveDollarVolumeFloor),
            newHigh30dCount: statsRow.newHigh30dCount,
            newLow30dCount: statsRow.newLow30dCount,
            rolling30: normalizeJson(statsRow.rolling30Json, {
              tradingDays: 0,
              avgAdvancerPct: null,
              medianAdvancerPct: null,
              strongDays: 0,
              weakDays: 0,
              newHigh30dAvg: null,
              newLow30dAvg: null,
            }),
            overview90: normalizeJson(statsRow.overview90Json, null),
          },
          leaders: rankRows(rankedRows, 'desc'),
          laggards: rankRows(rankedRows, 'asc'),
          sourceIndex: [
            {
              id: `massive:grouped:${tradingDate}`,
              label: `Massive grouped daily aggregates for ${tradingDate}`,
              source: 'massive',
              asOf: tradingDate,
            },
            {
              id: `computed:market-pulse:${tradingDate}`,
              label: `Computed breadth and rolling market pulse metrics for ${tradingDate}`,
              source: 'computed',
              asOf: new Date().toISOString(),
            },
          ],
        });

        return completedResult(context, {
          sourceIds: context.sourceIndex.map((source) => source.id),
        });
      },
    },
    {
      name: 'generate-market-pulse-report',
      type: 'llm',
      inputSchema: marketPulseContextSchema,
      outputSchema: marketPulseDraftSchema,
      metadata: { canRetry: true, timeoutMs: 45000, maxRepairAttempts: 1, sideEffect: false, lane: 'background' },
      run: async ({ previousOutput }) => {
        const context = marketPulseContextSchema.parse(previousOutput);
        const response = await callLlm({
          systemPrompt: 'You are the Nexus Terminal market breadth analyst. Return strict JSON.',
          userMessage: buildPrompt(context),
          temperature: 0.2,
        }, 'background');
        const draft = z.object({
          marketStrength: z.enum(['strong', 'mixed', 'weak']).default(strengthFromAdvancers(context.stats.advancerPct)),
          confidence: z.enum(['high', 'medium', 'low']).default('medium'),
          tldr: z.array(z.string()).default([]),
          summary: z.string().default('Market pulse summary unavailable.'),
          sectorNotes: z.array(z.string()).default([]),
          riskFlags: z.array(z.string()).default([]),
        }).parse(parseJson(response.content));

        const report: MarketPulseReport = {
          tradingDate: context.tradingDate,
          marketStrength: draft.marketStrength,
          confidence: draft.confidence,
          tldr: draft.tldr,
          summary: draft.summary,
          breadth: {
            advancers: context.stats.advancers,
            decliners: context.stats.decliners,
            unchanged: context.stats.unchanged,
            advancerPct: context.stats.advancerPct,
            upVolumePct: context.stats.totalVolume > 0
              ? Math.round((context.stats.upVolume / context.stats.totalVolume) * 10_000) / 100
              : null,
          },
          rolling30: context.stats.rolling30,
          ...(context.stats.overview90 ? { overview90: context.stats.overview90 } : {}),
          leaders: context.leaders,
          laggards: context.laggards,
          sectorNotes: draft.sectorNotes,
          riskFlags: draft.riskFlags,
          sourceIndex: context.sourceIndex,
        };

        return completedResult(marketPulseDraftSchema.parse(report), {
          durationMs: response.durationMs,
          tokensUsed: response.inputTokens + response.outputTokens,
          model: response.modelUsed,
          sourceIds: context.sourceIndex.map((source) => source.id),
          upstreamStepIds: ['load-market-pulse-context'],
        });
      },
    },
    {
      name: 'save-market-pulse-report',
      type: 'code',
      inputSchema: marketPulseDraftSchema,
      metadata: { canRetry: false, timeoutMs: 10000, maxRepairAttempts: 0, sideEffect: true },
      run: async ({ previousOutput, job, db }) => {
        const report = marketPulseDraftSchema.parse(previousOutput) as MarketPulseReport;
        const [existingReport] = await db.select({ id: agentReports.id })
          .from(agentReports)
          .where(and(
            eq(agentReports.userId, 'system-agent-user'),
            eq(agentReports.agentId, 'orchestrator'),
            eq(agentReports.reportType, 'market-pulse'),
            sql`${agentReports.reportJson}->>'tradingDate' = ${report.tradingDate}`,
          ))
          .limit(1);

        if (existingReport) {
          return completedResult({
            tradingDate: report.tradingDate,
            reportId: existingReport.id,
            status: 'published',
            deliveryError: null,
            skippedExisting: true,
          }, {
            upstreamStepIds: ['generate-market-pulse-report'],
          });
        }

        const delivery = await writeAndDeliverReport(db, {
          jobId: job.id,
          userId: 'system-agent-user',
          agentId: 'orchestrator',
          reportType: 'market-pulse',
          title: `${report.tradingDate} market pulse`,
          summary: report.summary,
          reportJson: report,
        });

        return completedResult({
          tradingDate: report.tradingDate,
          ...delivery,
        }, {
          upstreamStepIds: ['generate-market-pulse-report'],
        });
      },
    },
  ],
};
