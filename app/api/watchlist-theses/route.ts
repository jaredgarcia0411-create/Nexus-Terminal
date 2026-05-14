import { and, asc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { watchlistTheses } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { tagBodySchema } from '@/lib/validations/system';

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const result = await db.select({ name: watchlistTheses.name })
      .from(watchlistTheses)
      .where(eq(watchlistTheses.userId, authState.user.id))
      .orderBy(asc(watchlistTheses.name));
    return Response.json({ theses: result.map((row) => row.name) });
  } catch (error) {
    logRouteError('watchlist-theses.get', error);
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

    await db.insert(watchlistTheses)
      .values({ userId: authState.user.id, name })
      .onConflictDoNothing();
    return Response.json({ thesis: name });
  } catch (error) {
    logRouteError('watchlist-theses.post', error);
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

    await db.delete(watchlistTheses)
      .where(and(eq(watchlistTheses.userId, authState.user.id), eq(watchlistTheses.name, name)));

    return Response.json({ success: true, name });
  } catch (error) {
    logRouteError('watchlist-theses.delete', error);
    return internalServerError();
  }
}
