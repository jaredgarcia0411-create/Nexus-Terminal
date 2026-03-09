import { desc, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { jarvisRequestLog } from '@/lib/db/schema';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { requireJarvisAdmin } from '@/lib/jarvis-admin';
import { getCircuitBreakerState } from '@/lib/jarvis-circuit-breaker';

export async function GET(request: Request) {
  try {
    const adminError = requireJarvisAdmin(request);
    if (adminError) return adminError;

    const db = getDb();
    if (!db) {
      return Response.json({ error: 'Database not configured' }, { status: 503 });
    }

    const now = new Date();
    const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const [todayRow] = await db.select({
      totalRequests: sql<number>`count(*)::int`,
      totalTokens: sql<number>`coalesce(sum(${jarvisRequestLog.totalTokens}), 0)::int`,
      successCount: sql<number>`coalesce(sum(case when ${jarvisRequestLog.success} = 1 then 1 else 0 end), 0)::int`,
      avgDurationMs: sql<number>`coalesce(avg(${jarvisRequestLog.durationMs}), 0)::float`,
    })
      .from(jarvisRequestLog)
      .where(sql`${jarvisRequestLog.createdAt} >= ${startOfTodayUtc}`);

    const userBreakdownRows = await db.select({
      userId: jarvisRequestLog.userId,
      requestCount: sql<number>`count(*)::int`,
      totalTokens: sql<number>`coalesce(sum(${jarvisRequestLog.totalTokens}), 0)::int`,
      avgDurationMs: sql<number>`coalesce(avg(${jarvisRequestLog.durationMs}), 0)::float`,
    })
      .from(jarvisRequestLog)
      .where(sql`${jarvisRequestLog.createdAt} >= ${startOfTodayUtc}`)
      .groupBy(jarvisRequestLog.userId)
      .orderBy(desc(sql<number>`coalesce(sum(${jarvisRequestLog.totalTokens}), 0)::int`))
      .limit(20);

    const totalRequests = Number(todayRow?.totalRequests ?? 0);
    const successCount = Number(todayRow?.successCount ?? 0);

    return Response.json({
      circuitBreaker: getCircuitBreakerState(),
      today: {
        totalRequests,
        totalTokens: Number(todayRow?.totalTokens ?? 0),
        successRate: totalRequests > 0 ? successCount / totalRequests : 0,
        avgDurationMs: Number(todayRow?.avgDurationMs ?? 0),
      },
      userBreakdown: userBreakdownRows.map((row) => ({
        userId: row.userId,
        requestCount: Number(row.requestCount ?? 0),
        totalTokens: Number(row.totalTokens ?? 0),
        avgDurationMs: Number(row.avgDurationMs ?? 0),
      })),
    });
  } catch (error) {
    logRouteError('jarvis.admin.stats', error);
    return internalServerError();
  }
}
