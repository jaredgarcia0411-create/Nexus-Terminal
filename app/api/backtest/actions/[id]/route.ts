import { and, desc, eq } from 'drizzle-orm';

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtestActions, backtestSessions } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const [action] = await db
      .select()
      .from(backtestActions)
      .where(and(eq(backtestActions.userId, authState.user.id), eq(backtestActions.id, id)))
      .limit(1);

    if (!action) {
      return Response.json({ error: 'Action not found' }, { status: 404 });
    }

    const [lastAction] = await db
      .select({ id: backtestActions.id })
      .from(backtestActions)
      .where(and(eq(backtestActions.userId, authState.user.id), eq(backtestActions.sessionId, action.sessionId)))
      .orderBy(desc(backtestActions.sequence))
      .limit(1);

    if (lastAction?.id !== id) {
      return Response.json({ error: 'Only the last action can be undone' }, { status: 409 });
    }

    await db
      .delete(backtestActions)
      .where(and(eq(backtestActions.userId, authState.user.id), eq(backtestActions.id, id)));

    await db
      .update(backtestSessions)
      .set({ updatedAt: new Date() })
      .where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, action.sessionId)));

    return Response.json({ deleted: true, id });
  } catch (error) {
    logRouteError('backtest.actions.id.delete', error);
    return internalServerError();
  }
}
