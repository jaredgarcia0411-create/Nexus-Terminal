import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { dailyReviews } from '@/lib/db/schema';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const [row] = await db
      .select()
      .from(dailyReviews)
      .where(and(eq(dailyReviews.id, id), eq(dailyReviews.userId, authState.user.id)))
      .limit(1);

    if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ review: row });
  } catch (error) {
    logRouteError('daily-reviews.id.get', error);
    return internalServerError();
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    await db
      .delete(dailyReviews)
      .where(and(eq(dailyReviews.id, id), eq(dailyReviews.userId, authState.user.id)));

    return Response.json({ success: true, id });
  } catch (error) {
    logRouteError('daily-reviews.id.delete', error);
    return internalServerError();
  }
}
