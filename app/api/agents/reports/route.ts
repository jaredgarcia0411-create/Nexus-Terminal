import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getAgentDb } from '@/lib/agents/db';
import { agentReports } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { reportsListQuerySchema } from '@/lib/validations/agents';

function parseReportsQuery(request: Request) {
  const result = reportsListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  if (!result.success) {
    return {
      error: Response.json(
        { error: 'Validation failed', details: z.flattenError(result.error) },
        { status: 400 },
      ),
    };
  }

  return { data: result.data };
}

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const user = await ensureUser(db, authState.user);

    const queryState = parseReportsQuery(request);
    if (queryState.error) return queryState.error;

    const filters = [
      eq(agentReports.userId, user.id),
      ne(agentReports.userId, 'system-agent-user'),
      ...(queryState.data.status ? [eq(agentReports.status, queryState.data.status)] : []),
      ...(queryState.data.agent_id ? [eq(agentReports.agentId, queryState.data.agent_id)] : []),
    ];

    const rows = await db.select({
      id: agentReports.id,
      agentId: agentReports.agentId,
      reportType: agentReports.reportType,
      title: agentReports.title,
      summary: agentReports.summary,
      status: agentReports.status,
      deliveryError: agentReports.deliveryError,
      createdAt: agentReports.createdAt,
    })
      .from(agentReports)
      .where(and(...filters))
      .orderBy(desc(agentReports.createdAt))
      .limit(queryState.data.limit ?? 50);

    return Response.json({
      reports: rows.map((row) => ({
        id: row.id,
        agent_id: row.agentId,
        report_type: row.reportType,
        title: row.title,
        summary: row.summary,
        status: row.status,
        delivery_error: row.deliveryError,
        created_at: row.createdAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    logRouteError('agents.reports.get', error);
    return internalServerError();
  }
}
