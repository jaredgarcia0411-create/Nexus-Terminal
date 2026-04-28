import { and, eq } from 'drizzle-orm';

import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtestActions, backtestSessions } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const [session] = await db
      .select({ id: backtestSessions.id })
      .from(backtestSessions)
      .where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, id)))
      .limit(1);

    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    await db
      .delete(backtestActions)
      .where(and(eq(backtestActions.userId, authState.user.id), eq(backtestActions.sessionId, id)));

    await db
      .update(backtestSessions)
      .set({ updatedAt: new Date() })
      .where(and(eq(backtestSessions.userId, authState.user.id), eq(backtestSessions.id, id)));

    return Response.json({ cleared: true });
  } catch (error) {
    logRouteError('backtest.sessions.id.clear.post', error);
    return internalServerError();
  }
}
