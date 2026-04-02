import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { checkRateLimit, rateLimitExceededResponse } from '@/lib/jarvis/rate-limit';
import { logJarvisRequest } from '@/lib/jarvis/token-tracking';
import { jarvisTradeAnalysisSchema } from '@/lib/validations/jarvis';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { runTradeAnalysisPipeline } from '@/lib/jarvis/trade-analysis';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    const canonicalUser = await ensureUser(db, authState.user);

    const rateLimitResult = await checkRateLimit(canonicalUser.id);
    if (!rateLimitResult.allowed) return rateLimitExceededResponse(rateLimitResult);

    const bodyState = await parseAndValidate(request, jarvisTradeAnalysisSchema);
    if (bodyState.error) return bodyState.error;

    const startedAt = Date.now();
    const result = await runTradeAnalysisPipeline(canonicalUser.id);

    await logJarvisRequest({ userId: canonicalUser.id, mode: 'trade-analysis', durationMs: Date.now() - startedAt, success: true });

    return Response.json(result.analysis);
  } catch (error) {
    logRouteError('jarvis.trade-analysis.post', error);
    return internalServerError();
  }
}
