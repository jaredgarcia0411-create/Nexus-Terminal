import { and, eq, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb, getPoolDb } from '@/lib/db';
import { sampleSets } from '@/lib/db/schema';
import { mergeDedupedRows } from '@/lib/sample-set-rows';
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

    const bodyState = await parseAndValidate(request, sampleSetPatchSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const { id } = await context.params;

    if (body.name !== undefined && body.appendRows === undefined) {
      const db = getDb();
      if (!db) return dbUnavailable();
      await ensureUser(db, authState.user);

      const [row] = await db
        .select({ id: sampleSets.id, userId: sampleSets.userId })
        .from(sampleSets)
        .where(eq(sampleSets.id, id))
        .limit(1);

      if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });
      if (row.userId !== authState.user.id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }

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

      const [updated] = await db
        .update(sampleSets)
        .set({ name: body.name, updatedAt: new Date() })
        .where(and(eq(sampleSets.id, id), eq(sampleSets.userId, authState.user.id)))
        .returning();

      return Response.json({ sampleSet: updated, skippedCount: 0 });
    }

    if (body.appendRows !== undefined) {
      const poolDb = getPoolDb();
      if (!poolDb) return dbUnavailable();
      await ensureUser(poolDb, authState.user);

      const result = await poolDb.transaction(async (tx) => {
        const lockRows = await tx.execute(
          sql`SELECT id, rows FROM sample_sets WHERE id = ${id} FOR UPDATE`,
        );
        const locked = (Array.isArray(lockRows) ? lockRows : lockRows.rows) as Array<{
          id: string;
          rows: unknown;
        }>;

        if (locked.length === 0) {
          return { notFound: true as const };
        }

        const existingRows = (locked[0].rows as Array<{ ticker: string; date: string }>) ?? [];
        const { merged, skippedCount } = mergeDedupedRows(existingRows, body.appendRows ?? []);

        const updates: {
          rows: typeof merged;
          rowCount: number;
          updatedAt: Date;
          name?: string;
        } = {
          rows: merged,
          rowCount: merged.length,
          updatedAt: new Date(),
        };

        if (body.name !== undefined) {
          const [ownerRow] = await tx
            .select({ userId: sampleSets.userId })
            .from(sampleSets)
            .where(eq(sampleSets.id, id))
            .limit(1);

          if (ownerRow?.userId !== authState.user.id) {
            return { forbidden: true as const };
          }

          const [collision] = await tx
            .select({ id: sampleSets.id })
            .from(sampleSets)
            .where(
              sql`${sampleSets.userId} = ${authState.user.id} AND lower(${sampleSets.name}) = lower(${body.name}) AND ${sampleSets.id} <> ${id}`,
            )
            .limit(1);

          if (collision) {
            return { collision: true as const };
          }

          updates.name = body.name;
        }

        const [updated] = await tx
          .update(sampleSets)
          .set(updates)
          .where(eq(sampleSets.id, id))
          .returning();

        return { updated, skippedCount };
      });

      if ('notFound' in result) {
        return Response.json({ error: 'Sample set not found' }, { status: 404 });
      }
      if ('forbidden' in result) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      if ('collision' in result) {
        return Response.json({ error: 'A sample set with that name already exists' }, { status: 409 });
      }

      return Response.json({ sampleSet: result.updated, skippedCount: result.skippedCount });
    }

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const [row] = await db.select().from(sampleSets).where(eq(sampleSets.id, id)).limit(1);
    if (!row) return Response.json({ error: 'Sample set not found' }, { status: 404 });

    return Response.json({ sampleSet: row, skippedCount: 0 });
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
