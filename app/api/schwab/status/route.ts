import { eq } from 'drizzle-orm';
import { internalServerError, logRouteError } from '@/lib/api-route-utils';
import { getDb } from '@/lib/db';
import { schwabLinks } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function GET() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();

    await ensureUser(db, authState.user);

    const [row] = await db.select({
      status: schwabLinks.status,
      linkedAt: schwabLinks.linkedAt,
      refreshTokenExpiresAt: schwabLinks.refreshTokenExpiresAt,
    }).from(schwabLinks)
      .where(eq(schwabLinks.userId, authState.user.id))
      .limit(1);

    if (!row) {
      return Response.json({ linked: false, status: null });
    }

    const refreshExpiresAt = row.refreshTokenExpiresAt;
    if (refreshExpiresAt.getTime() < Date.now()) {
      if (row.status !== 'expired') {
        await db.update(schwabLinks)
          .set({ status: 'expired', updatedAt: new Date() })
          .where(eq(schwabLinks.userId, authState.user.id));
      }

      return Response.json({
        linked: false,
        status: 'expired',
        expiredAt: refreshExpiresAt.toISOString(),
      });
    }

    if (row.status !== 'active') {
      return Response.json({ linked: false, status: row.status });
    }

    return Response.json({
      linked: true,
      status: 'active',
      linkedAt: row.linkedAt?.toISOString() ?? null,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    });
  } catch (error) {
    logRouteError('schwab.status.get', error);
    return internalServerError();
  }
}

export async function DELETE() {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();

    await ensureUser(db, authState.user);

    await db.delete(schwabLinks)
      .where(eq(schwabLinks.userId, authState.user.id));

    return Response.json({ unlinked: true });
  } catch (error) {
    logRouteError('schwab.status.delete', error);
    return internalServerError();
  }
}
