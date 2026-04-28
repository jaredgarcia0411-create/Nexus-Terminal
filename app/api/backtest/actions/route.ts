import { and, desc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtestActions, backtestSessions } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { backtestActionCreateSchema } from '@/lib/validations/backtest';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, backtestActionCreateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [session] = await db
      .select({ id: backtestSessions.id })
      .from(backtestSessions)
      .where(and(
        eq(backtestSessions.userId, authState.user.id),
        eq(backtestSessions.id, body.sessionId),
        eq(backtestSessions.status, 'ACTIVE'),
      ))
      .limit(1);

    if (!session) {
      return Response.json({ error: 'Active session not found' }, { status: 404 });
    }

    const [lastAction] = await db
      .select({ sequence: backtestActions.sequence })
      .from(backtestActions)
      .where(and(eq(backtestActions.userId, authState.user.id), eq(backtestActions.sessionId, body.sessionId)))
      .orderBy(desc(backtestActions.sequence))
      .limit(1);

    const [action] = await db
      .insert(backtestActions)
      .values({
        id: crypto.randomUUID(),
        userId: authState.user.id,
        sessionId: body.sessionId,
        actionType: body.actionType,
        price: body.price,
        shares: body.shares,
        stopPrice: body.stopPrice,
        barTime: body.barTime,
        sequence: (lastAction?.sequence ?? 0) + 1,
      })
      .returning();

    await db
      .update(backtestSessions)
      .set({ updatedAt: new Date() })
      .where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, body.sessionId)));

    return Response.json({ action });
  } catch (error) {
    logRouteError('backtest.actions.post', error);
    return internalServerError();
  }
}
