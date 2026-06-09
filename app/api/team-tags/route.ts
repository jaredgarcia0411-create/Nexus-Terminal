import { asc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { teamTags as teamTagsTable } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { tagBodySchema } from '@/lib/validations/system';

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const result = await db.select({ name: teamTagsTable.name })
      .from(teamTagsTable)
      .orderBy(asc(teamTagsTable.name));
    const tagNames = result.map((row) => row.name);
    return Response.json({ tags: tagNames });
  } catch (error) {
    logRouteError('team-tags.get', error);
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

    const bodyState = await parseAndValidate(request, tagBodySchema);
    if (bodyState.error) return bodyState.error;
    const { name } = bodyState.data;

    await db.insert(teamTagsTable)
      .values({ name })
      .onConflictDoNothing();
    return Response.json({ tag: name });
  } catch (error) {
    logRouteError('team-tags.post', error);
    return internalServerError();
  }
}

export async function DELETE(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, tagBodySchema);
    if (bodyState.error) return bodyState.error;
    const { name } = bodyState.data;

    await db.delete(teamTagsTable)
      .where(eq(teamTagsTable.name, name));

    return Response.json({ success: true, name });
  } catch (error) {
    logRouteError('team-tags.delete', error);
    return internalServerError();
  }
}
