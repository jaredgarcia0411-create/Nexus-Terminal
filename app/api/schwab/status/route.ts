import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser } from '@/lib/server-db-utils';
import { requireUserOrService } from '@/lib/service-auth';
import { getValidSchwabToken } from '@/lib/schwab';

export async function GET(request: Request) {
  const db = getDb();
  if (!db) return dbUnavailable();

  const authState = await requireUserOrService(request, db);
  if ('error' in authState) return authState.error;

  if (authState.source === 'session') {
    await ensureUser(db, authState.user);
  }

  try {
    const token = await getValidSchwabToken(db, authState.user.id);
    if (!token) {
      return Response.json({ connected: false });
    }

    return Response.json({ connected: true, expiresAt: token.expiresAt });
  } catch (error) {
    console.error("Failed to check Schwab connection:", error);
    return Response.json({ connected: false });
  }
}
