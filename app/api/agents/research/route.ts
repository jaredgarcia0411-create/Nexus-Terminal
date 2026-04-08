import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getAgentDb } from '@/lib/agents/db';
import { agentRegistry, agentJobs, agentReports } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { researchPostSchema } from '@/lib/validations/agents';

function readTicker(reportJson: unknown): string | null {
  if (!reportJson || typeof reportJson !== 'object') {
    return null;
  }

  const ticker = (reportJson as { ticker?: unknown }).ticker;
  return typeof ticker === 'string' && ticker.trim() ? ticker : null;
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const bodyState = await parseAndValidate(request, researchPostSchema);
    if (bodyState.error) return bodyState.error;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const user = await ensureUser(db, authState.user);

    const [registryRow] = await db.select({
      status: agentRegistry.status,
    })
      .from(agentRegistry)
      .where(eq(agentRegistry.id, bodyState.data.agent_id))
      .limit(1);

    const status = typeof registryRow?.status === 'string' && registryRow.status.trim()
      ? registryRow.status
      : 'offline';

    if (status !== 'online') {
      return Response.json(
        {
          error: 'agent unavailable',
          agent_id: bodyState.data.agent_id,
          status,
        },
        { status: 400 },
      );
    }

    const jobId = randomUUID();

    await db.insert(agentJobs).values({
      id: jobId,
      agentId: bodyState.data.agent_id,
      userId: user.id,
      jobType: 'research',
      status: 'queued',
      input: {
        ticker: bodyState.data.ticker,
      },
    });

    return Response.json({
      job_id: jobId,
      agent_id: bodyState.data.agent_id,
      job_type: 'research',
    });
  } catch (error) {
    logRouteError('agents.research.post', error);
    return internalServerError();
  }
}

export async function GET(request: Request) {
  void request;

  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const user = await ensureUser(db, authState.user);

    const rows = await db.select({
      id: agentReports.id,
      agentId: agentReports.agentId,
      reportType: agentReports.reportType,
      reportJson: agentReports.reportJson,
    })
      .from(agentReports)
      .where(and(
        eq(agentReports.userId, user.id),
        ne(agentReports.userId, 'system-agent-user'),
        eq(agentReports.reportType, 'research'),
      ))
      .orderBy(desc(agentReports.createdAt))
      .limit(50);

    return Response.json({
      reports: rows.map((row) => ({
        id: row.id,
        agent_id: row.agentId,
        report_type: row.reportType,
        ticker: readTicker(row.reportJson),
      })),
    });
  } catch (error) {
    logRouteError('agents.research.get', error);
    return internalServerError();
  }
}
