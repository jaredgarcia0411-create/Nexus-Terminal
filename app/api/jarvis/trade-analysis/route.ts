import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { checkRateLimit } from '@/lib/jarvis/rate-limit';
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
    if (!rateLimitResult.allowed) {
      return Response.json(
        { error: 'Rate limit exceeded. Try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)) },
        },
      );
    }

    const bodyState = await parseAndValidate(request, jarvisTradeAnalysisSchema);
    if (bodyState.error) return bodyState.error;

    const startedAt = Date.now();
    const result = await runTradeAnalysisPipeline(canonicalUser.id, bodyState.data.days);

    try {
      await logJarvisRequest({
        userId: canonicalUser.id,
        mode: 'trade-analysis',
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startedAt,
        success: true,
        sourceCount: 0,
        chunkCount: 0,
      });
    } catch (logError) {
      logRouteError('jarvis.trade-analysis.post.token-tracking', logError);
    }

    return Response.json(result.analysis);
  } catch (error) {
    logRouteError('jarvis.trade-analysis.post', error);
    return internalServerError();
  }
}
