import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { getValidSchwabToken } from '@/lib/schwab';

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  try {
    const token = await getValidSchwabToken(db, authState.user.id);
    if (!token) {
      return Response.json({ connected: false });
    }

    return Response.json({ connected: true, expiresAt: token.expiresAt });
  } catch {
    return Response.json({ connected: false });
  }
}
