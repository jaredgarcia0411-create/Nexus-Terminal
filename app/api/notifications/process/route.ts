import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { processNotificationJobs } from '@/lib/notification-jobs';

export async function POST(request: Request) {
  const authState = isAuthorizedCronRequest(request);
  if (!authState.ok) return authState.response;

  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database not configured' }, { status: 503 });
  }

  const payload = await request.json().catch(() => ({})) as { limit?: number };
  const limit = typeof payload.limit === 'number' ? payload.limit : undefined;
  const runId = randomUUID();

  const metrics = await processNotificationJobs(db, { limit, runId });

  console.info('[notifications:process] job run complete', { runId, ...metrics });

  return Response.json({ runId, ...metrics });
}
