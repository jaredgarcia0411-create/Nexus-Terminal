import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { processNotificationJobs } from '@/lib/notification-jobs';
import { evaluatePriceAlerts } from '@/lib/price-alert-evaluator';

export async function POST(request: Request) {
  const authState = isAuthorizedCronRequest(request);
  if (!authState.ok) return authState.response;

  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database not configured' }, { status: 503 });
  }

  const payload = await request.json().catch(() => ({})) as { maxAlerts?: number; processLimit?: number };
  const runId = randomUUID();

  const evaluation = await evaluatePriceAlerts(db, {
    maxAlerts: typeof payload.maxAlerts === 'number' ? payload.maxAlerts : undefined,
    runId,
  });

  const dispatch = await processNotificationJobs(db, {
    limit: typeof payload.processLimit === 'number' ? payload.processLimit : undefined,
    runId,
  });

  const summary = {
    runId,
    evaluation,
    dispatch,
  };

  console.info('[cron:alerts] run complete', summary);

  return Response.json(summary);
}
