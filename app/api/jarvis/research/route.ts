import { desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { researchReports } from '@/lib/db/schema';
import { checkRateLimit } from '@/lib/jarvis/rate-limit';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { fetchAndCacheRawReport } from '@/lib/jarvis/research';
import { logJarvisRequest } from '@/lib/jarvis/token-tracking';
import { jarvisResearchSchema } from '@/lib/validations/jarvis';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    const canonicalUser = await ensureUser(db, authState.user);

    const rateLimitResult = await checkRateLimit(canonicalUser.id);
    if (!rateLimitResult.allowed) {
      return Response.json(
        { error: 'Rate limit exceeded. Try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)) },
        },
      );
    }

    const bodyState = await parseAndValidate(request, jarvisResearchSchema);
    if (bodyState.error) return bodyState.error;

    const ticker = bodyState.data.ticker;

    const startedAt = Date.now();
    const result = await fetchAndCacheRawReport(canonicalUser.id, ticker);

    try {
      await logJarvisRequest({
        userId: canonicalUser.id,
        mode: 'research',
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startedAt,
        success: true,
        sourceCount: 0,
        chunkCount: 0,
      });
    } catch (logError) {
      logRouteError('jarvis.research.post.token-tracking', logError);
    }

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
      rawData: researchReports.rawData,
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
