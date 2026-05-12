import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { agentJobs, agentReports } from '@/lib/db/schema';
import { captureMarketPulseForDate } from '@/lib/market-pulse/capture';
import { dbUnavailable, requireCronSecret } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

interface MarketPulseEodSummary {
  evaluatedDates: string[];
  barsUpserted: number;
  statsUpserted: number;
  jobsEnqueued: number;
  skippedNonTradingDays: number;
  errors: Array<{ date: string; message: string }>;
}

export async function GET(request: Request) {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  const db = getDb();
  if (!db) return dbUnavailable();

  try {
    const url = new URL(request.url);
    const dates = getDatesToEvaluate(url);
    const summary: MarketPulseEodSummary = {
      evaluatedDates: [],
      barsUpserted: 0,
      statsUpserted: 0,
      jobsEnqueued: 0,
      skippedNonTradingDays: 0,
      errors: [],
    };

    for (const tradeDate of dates) {
      try {
        const result = await captureMarketPulseForDate(db, tradeDate);
        if (result.skipped) {
          summary.skippedNonTradingDays += 1;
          continue;
        }

        summary.evaluatedDates.push(tradeDate);
        summary.barsUpserted += result.barsUpserted;
        summary.statsUpserted += result.statsUpserted;
        if (result.statsUpserted > 0 && await enqueueMarketPulseJobIfNeeded(db, tradeDate)) {
          summary.jobsEnqueued += 1;
        }
      } catch (error) {
        summary.errors.push({
          date: tradeDate,
          message: error instanceof Error ? error.message : String(error),
        });
        logRouteError(`market-pulse-eod:${tradeDate}`, error);
      }
    }

    return Response.json(summary);
  } catch (error) {
    logRouteError('market-pulse-eod', error);
    return internalServerError();
  }
}

function getDatesToEvaluate(url: URL): string[] {
  const explicitDate = parseDateParam(url.searchParams.get('date'));
  if (explicitDate) return [explicitDate];

  const from = parseDateParam(url.searchParams.get('from'));
  const daysParam = Number(url.searchParams.get('days') ?? '1');
  const days = Number.isFinite(daysParam) && daysParam > 0
    ? Math.min(30, Math.floor(daysParam))
    : 1;
  return collectCalendarDates(from ?? yesterdayInNewYork(), days);
}

function parseDateParam(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const timestamp = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(timestamp) ? raw : null;
}

function yesterdayInNewYork(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()).split('-').map(Number);
  const midnightUtc = Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!);
  return new Date(midnightUtc - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function collectCalendarDates(from: string, days: number): string[] {
  const startMs = Date.parse(`${from}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = 0; i < days; i += 1) {
    dates.push(new Date(startMs - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return dates;
}

async function enqueueMarketPulseJobIfNeeded(
  db: NonNullable<ReturnType<typeof getDb>>,
  tradeDate: string,
): Promise<boolean> {
  const [existingReport] = await db.select({ id: agentReports.id })
    .from(agentReports)
    .where(and(
      eq(agentReports.userId, 'system-agent-user'),
      eq(agentReports.agentId, 'orchestrator'),
      eq(agentReports.reportType, 'market-pulse'),
      sql`${agentReports.reportJson}->>'tradingDate' = ${tradeDate}`,
    ))
    .limit(1);
  if (existingReport) return false;

  const [existingJob] = await db.select({ id: agentJobs.id })
    .from(agentJobs)
    .where(and(
      eq(agentJobs.userId, 'system-agent-user'),
      eq(agentJobs.agentId, 'orchestrator'),
      eq(agentJobs.jobType, 'market-pulse'),
      sql`${agentJobs.input}->>'tradingDate' = ${tradeDate}`,
      sql`${agentJobs.status} IN ('queued', 'processing', 'completed')`,
    ))
    .limit(1);
  if (existingJob) return false;

  await db.insert(agentJobs).values({
    id: randomUUID(),
    agentId: 'orchestrator',
    userId: 'system-agent-user',
    jobType: 'market-pulse',
    status: 'queued',
    input: { tradingDate: tradeDate },
  });
  return true;
}
