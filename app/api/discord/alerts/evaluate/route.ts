import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { evaluatePriceAlerts } from '@/lib/price-alert-evaluator';
import { requireServiceClaims } from '@/lib/service-request';

export async function POST(request: Request) {
  const db = getDb();
  if (!db) {
    return Response.json({ error: 'Database not configured' }, { status: 503 });
  }
  const claimsState = await requireServiceClaims(request, db, {
    requiredScopes: ['alerts:evaluate'],
    enforceReplay: true,
  });
  if ('error' in claimsState) return claimsState.error;

  const runId = randomUUID();
  const payload = await request.json().catch(() => ({})) as { maxAlerts?: number };
  const maxAlerts = typeof payload.maxAlerts === 'number' ? payload.maxAlerts : undefined;

  const result = await evaluatePriceAlerts(db, { maxAlerts, runId });

  return Response.json({
    runId,
    ...result,
  });
}
