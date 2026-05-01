import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtestActions, backtests, backtestSessions, sampleSets, systemTickers, users } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { backtestPatchSchema } from '@/lib/validations/backtests';

async function loadReviewsForSessions(
  db: ReturnType<typeof getDb>,
  sessions: Array<typeof backtestSessions.$inferSelect>,
) {
  if (!db) return [];

  return Promise.all(sessions.map(async (session) => {
    const actions = await db
      .select()
      .from(backtestActions)
      .where(and(eq(backtestActions.userId, session.userId), eq(backtestActions.sessionId, session.id)))
      .orderBy(asc(backtestActions.sequence));

    const [systemTicker] = await db
      .select()
      .from(systemTickers)
      .where(and(eq(systemTickers.ticker, session.ticker), eq(systemTickers.date, session.date)))
      .limit(1);

    return { session, actions, systemTicker: systemTicker ?? null };
  }));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;

    if (id.startsWith('uncat-')) {
      const ownerId = id.slice(6);
      const [owner] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, ownerId))
        .limit(1);

      const sessions = await db
        .select()
        .from(backtestSessions)
        .where(and(
          eq(backtestSessions.userId, ownerId),
          isNull(backtestSessions.backtestId),
          eq(backtestSessions.status, 'REVIEWED'),
        ))
        .orderBy(asc(backtestSessions.reviewedAt));

      const reviews = await loadReviewsForSessions(db, sessions);

      return Response.json({
        backtest: {
          id,
          name: 'Uncategorized',
          description: null,
          sampleSetId: null,
          userId: ownerId,
          ownerId,
          ownerName: owner?.name ?? null,
        },
        reviews,
      });
    }

    const [backtest] = await db
      .select({
        id: backtests.id,
        name: backtests.name,
        description: backtests.description,
        sampleSetId: backtests.sampleSetId,
        userId: backtests.userId,
        ownerId: backtests.userId,
        ownerName: users.name,
        sampleSetName: sampleSets.name,
        createdAt: backtests.createdAt,
        updatedAt: backtests.updatedAt,
      })
      .from(backtests)
      .leftJoin(users, eq(backtests.userId, users.id))
      .leftJoin(sampleSets, eq(backtests.sampleSetId, sampleSets.id))
      .where(eq(backtests.id, id))
      .limit(1);

    if (!backtest) return Response.json({ error: 'Backtest not found' }, { status: 404 });

    const sessions = await db
      .select()
      .from(backtestSessions)
      .where(and(eq(backtestSessions.backtestId, id), eq(backtestSessions.status, 'REVIEWED')))
      .orderBy(asc(backtestSessions.reviewedAt));

    const reviews = await loadReviewsForSessions(db, sessions);

    return Response.json({ backtest, reviews });
  } catch (error) {
    logRouteError('backtests.id.get', error);
    return internalServerError();
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const bodyState = await parseAndValidate(request, backtestPatchSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [row] = await db
      .select({ id: backtests.id, userId: backtests.userId })
      .from(backtests)
      .where(eq(backtests.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Backtest not found' }, { status: 404 });
    if (row.userId !== authState.user.id) return Response.json({ error: 'Forbidden' }, { status: 403 });

    if (body.name !== undefined) {
      const [collision] = await db
        .select({ id: backtests.id })
        .from(backtests)
        .where(
          sql`${backtests.userId} = ${authState.user.id} AND lower(${backtests.name}) = lower(${body.name}) AND ${backtests.id} <> ${id}`,
        )
        .limit(1);

      if (collision) {
        return Response.json({ error: 'A backtest with that name already exists' }, { status: 409 });
      }
    }

    if (body.sampleSetId) {
      const [sampleSet] = await db
        .select({ id: sampleSets.id })
        .from(sampleSets)
        .where(eq(sampleSets.id, body.sampleSetId))
        .limit(1);

      if (!sampleSet) return Response.json({ error: 'Sample set not found' }, { status: 404 });
    }

    const updateData: Partial<typeof backtests.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) updateData.name = body.name;
    if (Object.prototype.hasOwnProperty.call(body, 'description')) updateData.description = body.description ?? null;
    if (Object.prototype.hasOwnProperty.call(body, 'sampleSetId')) updateData.sampleSetId = body.sampleSetId ?? null;

    const [updated] = await db
      .update(backtests)
      .set(updateData)
      .where(and(eq(backtests.id, id), eq(backtests.userId, authState.user.id)))
      .returning();

    return Response.json({ backtest: updated });
  } catch (error) {
    logRouteError('backtests.id.patch', error);
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
    const [row] = await db
      .select({ id: backtests.id, userId: backtests.userId })
      .from(backtests)
      .where(eq(backtests.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Backtest not found' }, { status: 404 });
    if (row.userId !== authState.user.id) return Response.json({ error: 'Forbidden' }, { status: 403 });

    await db.delete(backtests).where(and(eq(backtests.id, id), eq(backtests.userId, authState.user.id)));

    return Response.json({ deleted: true, id });
  } catch (error) {
    logRouteError('backtests.id.delete', error);
    return internalServerError();
  }
}
