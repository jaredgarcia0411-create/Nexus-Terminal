import { and, eq, ne } from 'drizzle-orm';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getAgentDb } from '@/lib/agents/db';
import { agentReports } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const user = await ensureUser(db, authState.user);

    const { id } = await context.params;

    const [report] = await db.select({
      id: agentReports.id,
      agentId: agentReports.agentId,
      reportType: agentReports.reportType,
      status: agentReports.status,
      reportJson: agentReports.reportJson,
    })
      .from(agentReports)
      .where(and(
        eq(agentReports.id, id),
        eq(agentReports.userId, user.id),
        ne(agentReports.userId, 'system-agent-user'),
      ))
      .limit(1);

    if (!report) {
      return Response.json({ error: 'report not found' }, { status: 404 });
    }

    return Response.json({
      report: {
        id: report.id,
        agent_id: report.agentId,
        report_type: report.reportType,
        status: report.status,
        report_json: report.reportJson,
      },
    });
  } catch (error) {
    logRouteError('agents.reports.id.get', error);
    return internalServerError();
  }
}
