import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { agentJobs, agentScheduledRuns } from '@/lib/db/schema';
import type { AgentDb } from './db';

const DEFAULT_MACRO_CRON_HOUR = Number(process.env.MACRO_CRON_HOUR) || 6;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;

type ScheduledRunRow = { id: string };
type ScheduledRunRowsResult = ScheduledRunRow[] | { rows: ScheduledRunRow[] };

export interface MacroCronHandle {
  stop: () => Promise<void>;
}

function unwrapRows(result: ScheduledRunRowsResult): ScheduledRunRow[] {
  return Array.isArray(result) ? result : result.rows;
}

function getTradingWindow(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});

  return {
    tradingDate: `${parts.year}-${parts.month}-${parts.day}`,
    currentHour: Number(parts.hour) % 24,
  };
}

async function runTick(
  db: AgentDb,
  hourEt: number,
) {
  const { tradingDate, currentHour } = getTradingWindow();
  if (currentHour !== hourEt) {
    return;
  }

  await db.transaction(async (tx) => {
    const claimResult = await tx.execute<ScheduledRunRow>(sql`
      INSERT INTO agent_scheduled_runs (id, agent_id, trigger_type, trading_date, status, started_at, created_at)
      VALUES (${randomUUID()}, 'orchestrator', 'macro-summary', ${tradingDate}, 'running', now(), now())
      ON CONFLICT (agent_id, trigger_type, trading_date) DO NOTHING
      RETURNING id;
    `);
    const [scheduledRun] = unwrapRows(claimResult);

    if (!scheduledRun) {
      return;
    }

    const jobId = randomUUID();
    await tx.insert(agentJobs).values({
      id: jobId,
      agentId: 'orchestrator',
      userId: 'system-agent-user',
      jobType: 'macro-summary',
      status: 'queued',
      input: { tradingDate },
    });

    await tx.update(agentScheduledRuns)
      .set({
        jobId,
        status: 'completed',
        completedAt: sql`now()`,
      })
      .where(eq(agentScheduledRuns.id, scheduledRun.id));
  });
}

export function startMacroCron(
  db: AgentDb,
  options: { hourEt?: number; checkIntervalMs?: number } = {},
): MacroCronHandle {
  const hourEt = options.hourEt ?? DEFAULT_MACRO_CRON_HOUR;
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;

  const timer = setInterval(() => {
    void runTick(db, hourEt).catch((error) => {
      console.error('macro cron tick failed', { error });
    });
  }, checkIntervalMs);

  return {
    stop: async () => {
      clearInterval(timer);
    },
  };
}
