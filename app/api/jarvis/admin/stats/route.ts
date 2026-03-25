import { desc, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { agentMemory, jarvisConversations, jarvisRequestLog, macroSummaries, researchReports } from '@/lib/db/schema';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { dbUnavailable } from '@/lib/server-db-utils';
import { requireJarvisAdmin } from '@/lib/jarvis/admin';
import { getCircuitBreakerState } from '@/lib/jarvis/circuit-breaker';

export async function GET(request: Request) {
  try {
    const adminError = requireJarvisAdmin(request);
    if (adminError) return adminError;

    const db = getDb();
    if (!db) {
      return dbUnavailable();
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

    const [memoryTotals] = await db.select({
      total: sql<number>`count(*)::int`,
      tradeInsight: sql<number>`coalesce(sum(case when ${agentMemory.category} = 'trade_insight' then 1 else 0 end), 0)::int`,
      userPreference: sql<number>`coalesce(sum(case when ${agentMemory.category} = 'user_preference' then 1 else 0 end), 0)::int`,
      strategyNote: sql<number>`coalesce(sum(case when ${agentMemory.category} = 'strategy_note' then 1 else 0 end), 0)::int`,
      macroFact: sql<number>`coalesce(sum(case when ${agentMemory.category} = 'macro_fact' then 1 else 0 end), 0)::int`,
    }).from(agentMemory);

    const [researchCount] = await db.select({ count: sql<number>`count(*)::int` }).from(researchReports);
    const [conversationCount] = await db.select({ count: sql<number>`count(*)::int` }).from(jarvisConversations);
    const [latestMacro] = await db.select({ generatedAt: macroSummaries.generatedAt })
      .from(macroSummaries)
      .orderBy(desc(macroSummaries.generatedAt))
      .limit(1);

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
      memory: {
        total: Number(memoryTotals?.total ?? 0),
        byCategory: {
          trade_insight: Number(memoryTotals?.tradeInsight ?? 0),
          user_preference: Number(memoryTotals?.userPreference ?? 0),
          strategy_note: Number(memoryTotals?.strategyNote ?? 0),
          macro_fact: Number(memoryTotals?.macroFact ?? 0),
        },
      },
      researchReports: Number(researchCount?.count ?? 0),
      macroSummaries: {
        latestGeneratedAt: latestMacro?.generatedAt ?? null,
      },
      conversations: Number(conversationCount?.count ?? 0),
    });
  } catch (error) {
    logRouteError('jarvis.admin.stats', error);
    return internalServerError();
  }
}
