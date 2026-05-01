import { and, eq, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sampleSets } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sampleSetPatchSchema } from '@/lib/validations/sample-sets';

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
      .from(sampleSets)
      .where(eq(sampleSets.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });

    return Response.json({ sampleSet: row });
  } catch (error) {
    logRouteError('sample-sets.id.get', error);
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
    const bodyState = await parseAndValidate(request, sampleSetPatchSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [row] = await db
      .select({ id: sampleSets.id, userId: sampleSets.userId })
      .from(sampleSets)
      .where(eq(sampleSets.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });
    if (row.userId !== authState.user.id) return Response.json({ error: 'Forbidden' }, { status: 403 });

    if (body.name !== undefined) {
      const [collision] = await db
        .select({ id: sampleSets.id })
        .from(sampleSets)
        .where(
          sql`${sampleSets.userId} = ${authState.user.id} AND lower(${sampleSets.name}) = lower(${body.name}) AND ${sampleSets.id} <> ${id}`,
        )
        .limit(1);

      if (collision) {
        return Response.json({ error: 'A sample set with that name already exists' }, { status: 409 });
      }
    }

    if (body.name === undefined) {
      return Response.json({ sampleSet: row });
    }

    const [updated] = await db
      .update(sampleSets)
      .set({ name: body.name, updatedAt: new Date() })
      .where(and(eq(sampleSets.id, id), eq(sampleSets.userId, authState.user.id)))
      .returning();

    return Response.json({ sampleSet: updated });
  } catch (error) {
    logRouteError('sample-sets.id.patch', error);
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
      .select({ id: sampleSets.id, userId: sampleSets.userId })
      .from(sampleSets)
      .where(eq(sampleSets.id, id))
      .limit(1);

    if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });
    if (row.userId !== authState.user.id) return Response.json({ error: 'Forbidden' }, { status: 403 });

    await db.delete(sampleSets).where(and(eq(sampleSets.id, id), eq(sampleSets.userId, authState.user.id)));

    return Response.json({ deleted: true, id });
  } catch (error) {
    logRouteError('sample-sets.id.delete', error);
    return internalServerError();
  }
}
