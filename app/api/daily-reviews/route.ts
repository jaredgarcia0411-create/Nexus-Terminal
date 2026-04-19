import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { dailyReviews } from '@/lib/db/schema';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { upsertDailyReviewSchema } from '@/lib/validations/reviews';

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

    const conditions = [eq(dailyReviews.userId, authState.user.id)];
    if (from) conditions.push(gte(dailyReviews.date, from));
    if (to) conditions.push(lte(dailyReviews.date, to));

    const rows = await db
      .select()
      .from(dailyReviews)
      .where(and(...conditions))
      .orderBy(desc(dailyReviews.date));

    return Response.json({ reviews: rows });
  } catch (error) {
    logRouteError('daily-reviews.get', error);
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

    const bodyState = await parseAndValidate(request, upsertDailyReviewSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const id = `${authState.user.id}:dr:${body.date}`;
    await db
      .insert(dailyReviews)
      .values({
        id,
        userId: authState.user.id,
        date: body.date,
        templateId: body.templateId ?? null,
        templateSnapshot: body.templateSnapshot,
        reportData: body.reportData,
        tradeIds: body.tradeIds,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [dailyReviews.userId, dailyReviews.date],
        set: {
          templateId: body.templateId ?? null,
          templateSnapshot: body.templateSnapshot,
          reportData: body.reportData,
          tradeIds: body.tradeIds,
          updatedAt: new Date(),
        },
      });

    const [saved] = await db
      .select()
      .from(dailyReviews)
      .where(and(eq(dailyReviews.userId, authState.user.id), eq(dailyReviews.date, body.date)))
      .limit(1);

    return Response.json({ review: saved });
  } catch (error) {
    logRouteError('daily-reviews.post', error);
    return internalServerError();
  }
}
