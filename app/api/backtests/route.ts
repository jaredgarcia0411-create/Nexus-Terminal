import { count, desc, eq, isNull, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { backtests, backtestSessions, sampleSets, users } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { backtestCreateSchema } from '@/lib/validations/backtests';

export async function GET(_request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const rows = await db
      .select({
        id: backtests.id,
        name: backtests.name,
        description: backtests.description,
        sampleSetId: backtests.sampleSetId,
        sampleSetName: sampleSets.name,
        sampleSetExists: sql<boolean>`${sampleSets.id} IS NOT NULL`,
        ownerId: backtests.userId,
        ownerName: users.name,
        reviewCount: count(backtestSessions.id),
        createdAt: backtests.createdAt,
        updatedAt: backtests.updatedAt,
      })
      .from(backtests)
      .leftJoin(users, eq(backtests.userId, users.id))
      .leftJoin(sampleSets, eq(backtests.sampleSetId, sampleSets.id))
      .leftJoin(backtestSessions, eq(backtestSessions.backtestId, backtests.id))
      .groupBy(
        backtests.id,
        backtests.name,
        backtests.description,
        backtests.sampleSetId,
        backtests.userId,
        backtests.createdAt,
        backtests.updatedAt,
        sampleSets.id,
        sampleSets.name,
        users.name,
      )
      .orderBy(desc(backtests.updatedAt));

    const uncategorizedRows = await db
      .select({
        userId: backtestSessions.userId,
        ownerName: users.name,
        reviewCount: count(backtestSessions.id),
      })
      .from(backtestSessions)
      .leftJoin(users, eq(backtestSessions.userId, users.id))
      .where(isNull(backtestSessions.backtestId))
      .groupBy(backtestSessions.userId, users.name);

    const uncategorized = uncategorizedRows.map((row) => ({
      id: `uncat-${row.userId}`,
      name: 'Uncategorized',
      description: null,
      sampleSetId: null,
      sampleSetName: null,
      sampleSetExists: false,
      ownerId: row.userId,
      ownerName: row.ownerName,
      reviewCount: row.reviewCount,
      createdAt: null,
      updatedAt: null,
    }));

    return Response.json({ backtests: [...rows, ...uncategorized] });
  } catch (error) {
    logRouteError('backtests.get', error);
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

    const bodyState = await parseAndValidate(request, backtestCreateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [existing] = await db
      .select({ id: backtests.id })
      .from(backtests)
      .where(sql`${backtests.userId} = ${authState.user.id} AND lower(${backtests.name}) = lower(${body.name})`)
      .limit(1);

    if (existing) return Response.json({ error: 'A backtest with that name already exists' }, { status: 409 });

    if (body.sampleSetId) {
      const [sampleSet] = await db
        .select({ id: sampleSets.id })
        .from(sampleSets)
        .where(eq(sampleSets.id, body.sampleSetId))
        .limit(1);

      if (!sampleSet) return Response.json({ error: 'Sample set not found' }, { status: 404 });
    }

    const [created] = await db
      .insert(backtests)
      .values({
        userId: authState.user.id,
        name: body.name,
        description: body.description ?? null,
        sampleSetId: body.sampleSetId ?? null,
        updatedAt: new Date(),
      })
      .returning();

    return Response.json({ backtest: created }, { status: 201 });
  } catch (error) {
    logRouteError('backtests.post', error);
    return internalServerError();
  }
}
