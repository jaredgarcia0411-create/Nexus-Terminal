import { eq, sql } from 'drizzle-orm';

import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { sampleSets } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { sampleSetDuplicateSchema } from '@/lib/validations/sample-sets';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const { id } = await context.params;
    const bodyState = await parseAndValidate(request, sampleSetDuplicateSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const [source] = await db
      .select()
      .from(sampleSets)
      .where(eq(sampleSets.id, id))
      .limit(1);

    if (!source) return Response.json({ error: 'Sample set not found' }, { status: 404 });

    const [collision] = await db
      .select({ id: sampleSets.id })
      .from(sampleSets)
      .where(sql`${sampleSets.userId} = ${authState.user.id} AND lower(${sampleSets.name}) = lower(${body.name})`)
      .limit(1);

    if (collision) {
      return Response.json({ error: 'A sample set with that name already exists' }, { status: 409 });
    }

    const [created] = await db
      .insert(sampleSets)
      .values({
        userId: authState.user.id,
        name: body.name,
        rows: source.rows,
        rowCount: source.rowCount,
        updatedAt: new Date(),
      })
      .returning();

    return Response.json({ sampleSet: created }, { status: 201 });
  } catch (error) {
    logRouteError('sample-sets.id.duplicate.post', error);
    return internalServerError();
  }
}
