import { desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { researchReports } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { runResearchPipeline } from '@/lib/jarvis/research';

interface ResearchBody {
  ticker?: string;
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    const canonicalUser = await ensureUser(db, authState.user);

    const bodyState = await parseJsonBody<ResearchBody>(request);
    if (bodyState.error) return bodyState.error;

    const ticker = bodyState.data.ticker?.trim().toUpperCase() ?? '';
    if (!ticker) {
      return Response.json({ error: 'ticker is required' }, { status: 400 });
    }

    const result = await runResearchPipeline(canonicalUser.id, ticker);
    return Response.json(result);
  } catch (error) {
    logRouteError('jarvis.research.post', error);
    return internalServerError();
  }
}

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    const canonicalUser = await ensureUser(db, authState.user);

    const rows = await db.select({
      id: researchReports.id,
      ticker: researchReports.ticker,
      generatedAt: researchReports.generatedAt,
      reportJson: researchReports.reportJson,
    })
      .from(researchReports)
      .where(eq(researchReports.userId, canonicalUser.id))
      .orderBy(desc(researchReports.generatedAt));

    return Response.json({ rows });
  } catch (error) {
    logRouteError('jarvis.research.get', error);
    return internalServerError();
  }
}
