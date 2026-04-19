import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { weeklyReviews } from '@/lib/db/schema';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { upsertWeeklyReviewSchema } from '@/lib/validations/reviews';

export async function GET(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const conditions = [eq(weeklyReviews.userId, authState.user.id)];
    if (from) conditions.push(gte(weeklyReviews.weekStart, from));
    if (to) conditions.push(lte(weeklyReviews.weekStart, to));

    const rows = await db
      .select()
      .from(weeklyReviews)
      .where(and(...conditions))
      .orderBy(desc(weeklyReviews.weekStart));

    return Response.json({ reviews: rows });
  } catch (error) {
    logRouteError('weekly-reviews.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, upsertWeeklyReviewSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const id = `${authState.user.id}:wr:${body.weekStart}`;
    await db
      .insert(weeklyReviews)
      .values({
        id,
        userId: authState.user.id,
        weekStart: body.weekStart,
        weekEnd: body.weekEnd,
        templateId: body.templateId ?? null,
        templateSnapshot: body.templateSnapshot,
        reportData: body.reportData,
        tradeIds: body.tradeIds,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [weeklyReviews.userId, weeklyReviews.weekStart],
        set: {
          weekEnd: body.weekEnd,
          templateId: body.templateId ?? null,
          templateSnapshot: body.templateSnapshot,
          reportData: body.reportData,
          tradeIds: body.tradeIds,
          updatedAt: new Date(),
        },
      });

    const [saved] = await db
      .select()
      .from(weeklyReviews)
      .where(
        and(eq(weeklyReviews.userId, authState.user.id), eq(weeklyReviews.weekStart, body.weekStart)),
      )
      .limit(1);

    return Response.json({ review: saved });
  } catch (error) {
    logRouteError('weekly-reviews.post', error);
    return internalServerError();
  }
}
