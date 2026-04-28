import { and, eq } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtestSessions } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { backtestSessionReviewSchema } from '@/lib/validations/backtest';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const bodyState = await parseAndValidate(request, backtestSessionReviewSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    if (body.sessionId !== id) {
      return Response.json({ error: 'sessionId does not match route id' }, { status: 400 });
    }

    const now = new Date();
    const [session] = await db
      .update(backtestSessions)
      .set({
        status: 'REVIEWED',
        reviewedAt: now,
        label: body.label?.trim() || null,
        notes: body.notes?.trim() || null,
        updatedAt: now,
      })
      .where(and(
        eq(backtestSessions.userId, authState.user.id),
        eq(backtestSessions.id, id),
        eq(backtestSessions.status, 'ACTIVE'),
      ))
      .returning();

    if (!session) {
      return Response.json({ error: 'Active session not found' }, { status: 404 });
    }

    return Response.json({ session });
  } catch (error) {
    logRouteError('backtest.sessions.id.review.post', error);
    return internalServerError();
  }
}
