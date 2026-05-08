import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { agentJobs, agentScheduledRuns } from '@/lib/db/schema';
import type { AgentDb } from './db';

const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_INTRADAY_CRON_HOUR_ET = 12;

// Read at call time (not module load) so tests can override via env vars.
function readDefaultMacroCronHour(): number {
  return Number(process.env.MACRO_CRON_HOUR) || 6;
}

function readDefaultIntradayCronHour(): number {
  return Number(process.env.MACRO_INTRADAY_HOUR_ET) || DEFAULT_INTRADAY_CRON_HOUR_ET;
}

type CronTriggerType = 'macro-summary' | 'macro-intraday';
type CronJobInputFactory = (tradingDate: string) => Record<string, unknown>;
type RunTickOptions = {
  triggerType: CronTriggerType;
  jobInput: CronJobInputFactory;
};

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
    weekday: 'short',
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
    weekday: parts.weekday,
  };
}

async function runTick(
  db: AgentDb,
  hourEt: number,
  options: RunTickOptions,
) {
  const { tradingDate, currentHour, weekday } = getTradingWindow();
  if (currentHour !== hourEt) {
    return;
  }
  // Markets are closed on weekends — skip macro briefing runs entirely.
  if (weekday === 'Sat' || weekday === 'Sun') {
    return;
  }

  await db.transaction(async (tx) => {
    const claimResult = await tx.execute<ScheduledRunRow>(sql`
      INSERT INTO agent_scheduled_runs (id, agent_id, trigger_type, trading_date, status, started_at, created_at)
      VALUES (${randomUUID()}, 'orchestrator', ${options.triggerType}, ${tradingDate}, 'running', now(), now())
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
      input: options.jobInput(tradingDate),
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
  const hourEt = options.hourEt ?? readDefaultMacroCronHour();
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const executeTick = () => {
    void runTick(db, hourEt, {
      triggerType: 'macro-summary',
      jobInput: (tradingDate) => ({ tradingDate }),
    }).catch((error) => {
      console.error('macro cron tick failed', { error });
    });
  };

  executeTick();

  const timer = setInterval(executeTick, checkIntervalMs);

  return {
    stop: async () => {
      clearInterval(timer);
    },
  };
}

export function startIntradayCron(
  db: AgentDb,
  options: { hourEt?: number; checkIntervalMs?: number } = {},
): MacroCronHandle {
  const hourEt = options.hourEt ?? readDefaultIntradayCronHour();
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const executeTick = () => {
    void runTick(db, hourEt, {
      triggerType: 'macro-intraday',
      jobInput: (tradingDate) => ({ tradingDate, intradayUpdate: true }),
    }).catch((error) => {
      console.error('intraday cron tick failed', { error });
    });
  };

  executeTick();

  const timer = setInterval(executeTick, checkIntervalMs);

  return {
    stop: async () => {
      clearInterval(timer);
    },
  };
}
