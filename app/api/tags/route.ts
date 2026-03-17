import { and, asc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { tags as tagsTable, tradeTags as tradeTagsTable } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { tagBodySchema } from '@/lib/validations/system';

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const result = await db.select({ name: tagsTable.name })
      .from(tagsTable)
      .where(eq(tagsTable.userId, authState.user.id))
      .orderBy(asc(tagsTable.name));
    const tagNames = result.map((r) => r.name);
    return Response.json({ tags: tagNames });
  } catch (error) {
    logRouteError('tags.get', error);
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

    await db.insert(tagsTable)
      .values({ userId: authState.user.id, name })
      .onConflictDoNothing();
    return Response.json({ tag: name });
  } catch (error) {
    logRouteError('tags.post', error);
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

    await db.delete(tagsTable)
      .where(and(eq(tagsTable.userId, authState.user.id), eq(tagsTable.name, name)));
    await db.delete(tradeTagsTable)
      .where(and(eq(tradeTagsTable.userId, authState.user.id), eq(tradeTagsTable.tag, name)));

    return Response.json({ success: true, name });
  } catch (error) {
    logRouteError('tags.delete', error);
    return internalServerError();
  }
}
