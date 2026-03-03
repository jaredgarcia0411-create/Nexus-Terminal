import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { getValidSchwabToken } from '@/lib/schwab';

type SchwabAccountsResponse = {
  securitiesAccount?: {
    accountId?: string;
    type?: string;
  };
}[];

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  let token;
  try {
    token = await getValidSchwabToken(db, authState.user.id);
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Could not refresh Schwab token';
    return Response.json({ error: text }, { status: 502 });
  }

  if (!token) {
    return Response.json({ error: 'Schwab not connected' }, { status: 401 });
  }

  const apiBase = process.env.SCHWAB_API_BASE_URL || 'https://api.schwabapi.com';
  const res = await fetch(`${apiBase}/trader/v1/accounts`, {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 429) {
      return Response.json({ error: 'Schwab API rate limit reached' }, { status: 429 });
    }
    return Response.json({ error: 'Failed to fetch Schwab accounts' }, { status: 502 });
  }

  const data = (await res.json().catch(() => [])) as SchwabAccountsResponse;

  const accounts = data.map((acct) => ({
    accountId: acct.securitiesAccount?.accountId ?? '',
    type: acct.securitiesAccount?.type ?? 'UNKNOWN',
  })).filter((a) => a.accountId);

  return Response.json({ accounts });
}
