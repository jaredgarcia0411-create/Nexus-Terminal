import { lt } from 'drizzle-orm';
import { logRouteError } from '@/lib/api-route-utils';
import { getAgentDb } from '@/lib/agents/db';
import { agentMemoryV2, agentRequestLog } from '@/lib/db/schema';
import { dbUnavailable, requireCronSecret } from '@/lib/server-db-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * GET /api/cron/agent-retention
 *
 * Vercel cron job — hard-deletes expired agent memory rows and
 * request-log rows older than 90 days. Authenticated via CRON_SECRET.
 *
 * SQL NULL note: lt(expiresAt, now) uses SQL < which naturally excludes NULL rows
 * (NULL comparisons return UNKNOWN in SQL, not TRUE). Permanent memories
 * (expiresAt IS NULL) are therefore never deleted by this cron. This is correct.
 */
export async function GET(request: Request) {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  const db = getAgentDb();
  if (!db) {
    return dbUnavailable();
  }

  let memoryDeleted = 0;
  let requestLogDeleted = 0;

  try {
    const deleted = await db
      .delete(agentMemoryV2)
      .where(lt(agentMemoryV2.expiresAt, new Date()))
      .returning({ id: agentMemoryV2.id });
    memoryDeleted = deleted.length;
  } catch (error) {
    logRouteError('agent-retention:memory', error);
  }

  try {
    const deleted = await db
      .delete(agentRequestLog)
      .where(lt(agentRequestLog.createdAt, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)))
      .returning({ id: agentRequestLog.id });
    requestLogDeleted = deleted.length;
  } catch (error) {
    logRouteError('agent-retention:request-log', error);
  }

  return Response.json({ memoryDeleted, requestLogDeleted });
}
