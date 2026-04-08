import { eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { redeliverReport } from '@/lib/agents/discord';
import { requireAgentAdmin } from '@/lib/agents/admin';
import { getAgentDb } from '@/lib/agents/db';
import { agentReports } from '@/lib/db/schema';
import { dbUnavailable } from '@/lib/server-db-utils';
import { redeliverSchema } from '@/lib/validations/agents';

export async function POST(request: Request) {
  try {
    const authError = requireAgentAdmin(request);
    if (authError) return authError;

    const bodyState = await parseAndValidate(request, redeliverSchema);
    if (bodyState.error) return bodyState.error;

    const db = getAgentDb();
    if (!db) return dbUnavailable();

    const [report] = await db.select({
      id: agentReports.id,
    })
      .from(agentReports)
      .where(eq(agentReports.id, bodyState.data.report_id))
      .limit(1);

    if (!report) {
      return Response.json({ error: 'report not found' }, { status: 404 });
    }

    const result = await redeliverReport(db, bodyState.data.report_id);

    return Response.json({
      report_id: bodyState.data.report_id,
      status: result.status,
    });
  } catch (error) {
    logRouteError('agents.admin.redeliver.post', error);
    return internalServerError();
  }
}
