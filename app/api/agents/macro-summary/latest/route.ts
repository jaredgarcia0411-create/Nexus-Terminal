import { and, desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getAgentDb } from '@/lib/agents/db';
import { agentReports } from '@/lib/db/schema';
import { dbUnavailable } from '@/lib/server-db-utils';

export async function GET(request: Request) {
  void request;

  try {
    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const [summaryRow] = await db.select({
      generatedAt: agentReports.createdAt,
      content: agentReports.reportJson,
      status: agentReports.status,
      deliveryError: agentReports.deliveryError,
    })
      .from(agentReports)
      .where(and(
        eq(agentReports.userId, 'system-agent-user'),
        eq(agentReports.agentId, 'orchestrator'),
        eq(agentReports.reportType, 'macro-summary'),
      ))
      .orderBy(desc(agentReports.createdAt))
      .limit(1);

    if (!summaryRow) {
      return Response.json({ summary: null });
    }

    return Response.json({
      summary: {
        generated_at: summaryRow.generatedAt?.toISOString() ?? null,
        content: summaryRow.content,
        status: summaryRow.status,
        deliveryError: summaryRow.deliveryError,
      },
    });
  } catch (error) {
    logRouteError('agents.macro-summary.latest.get', error);
    return internalServerError();
  }
}
