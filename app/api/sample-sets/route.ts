import { desc, eq, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sampleSets, users } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sampleSetCreateSchema } from '@/lib/validations/sample-sets';

export async function GET(_request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const rows = await db
      .select({
        id: sampleSets.id,
        name: sampleSets.name,
        rowCount: sampleSets.rowCount,
        ownerId: sampleSets.userId,
        ownerName: users.name,
        createdAt: sampleSets.createdAt,
        updatedAt: sampleSets.updatedAt,
      })
      .from(sampleSets)
      .leftJoin(users, eq(sampleSets.userId, users.id))
      .orderBy(desc(sampleSets.updatedAt));

    return Response.json({ sampleSets: rows });
  } catch (error) {
    logRouteError('sample-sets.get', error);
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

    const bodyState = await parseAndValidate(request, sampleSetCreateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [existing] = await db
      .select({ id: sampleSets.id })
      .from(sampleSets)
      .where(sql`${sampleSets.userId} = ${authState.user.id} AND lower(${sampleSets.name}) = lower(${body.name})`)
      .limit(1);

    if (existing) {
      return Response.json({ error: 'A sample set with that name already exists' }, { status: 409 });
    }

    const [created] = await db
      .insert(sampleSets)
      .values({
        userId: authState.user.id,
        name: body.name,
        rows: body.rows,
        rowCount: body.rows.length,
        updatedAt: new Date(),
      })
      .returning();

    return Response.json({ sampleSet: created }, { status: 201 });
  } catch (error) {
    logRouteError('sample-sets.post', error);
    return internalServerError();
  }
}
