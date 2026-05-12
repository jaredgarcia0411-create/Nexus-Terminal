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

    const [pulseRow] = await db.select({
      generatedAt: agentReports.createdAt,
      content: agentReports.reportJson,
      status: agentReports.status,
      deliveryError: agentReports.deliveryError,
    })
      .from(agentReports)
      .where(and(
        eq(agentReports.userId, 'system-agent-user'),
        eq(agentReports.agentId, 'orchestrator'),
        eq(agentReports.reportType, 'market-pulse'),
      ))
      .orderBy(desc(agentReports.createdAt))
      .limit(1);

    if (!pulseRow) {
      return Response.json({ pulse: null });
    }

    return Response.json({
      pulse: {
        generated_at: pulseRow.generatedAt?.toISOString() ?? null,
        content: pulseRow.content,
        status: pulseRow.status,
        deliveryError: pulseRow.deliveryError,
      },
    });
  } catch (error) {
    logRouteError('agents.market-pulse.latest.get', error);
    return internalServerError();
  }
}
