import { eq } from 'drizzle-orm';
import { type Db } from '@/lib/db';
import { schwabTokens } from '@/lib/db/schema';

export type SchwabTokenState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export function logTokenEvent(userId: string, success: boolean, message?: string) {
  const payload = {
    event: 'schwab_token_refresh',
    userId,
    success,
    timestamp: new Date().toISOString(),
    ...(message ? { message } : {}),
  };

  if (success) {
    console.info(JSON.stringify(payload));
    return;
  }

  console.error(JSON.stringify(payload));
}

export function isTokenExpired(expiresAtIso: string): boolean {
  const expiresAt = new Date(expiresAtIso).getTime();
  return Number.isNaN(expiresAt) || expiresAt <= Date.now() + 30_000;
}

// Per-user mutex to prevent concurrent refresh races
const refreshLocks = new Map<string, Promise<SchwabTokenState | null>>();

async function refreshSchwabToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Schwab integration not configured');
  }

  const oauthBase = process.env.SCHWAB_OAUTH_BASE_URL || 'https://api.schwab.com';
  const tokenUrl = `${oauthBase.replace(/\/$/, '')}/v1/oauth/token`;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const attempt = async (): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> => {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const payload = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number | string;
      error?: string;
    };

    if (!res.ok || !payload.access_token) {
      throw new Error(payload.error || 'Failed to refresh Schwab token');
    }

    const expiresInSeconds = Number(payload.expires_in ?? 3600);
    const expiresAtDate = new Date(Date.now() + expiresInSeconds * 1000);
    const expiresAt = Number.isNaN(expiresAtDate.getTime()) ? 'invalid' : expiresAtDate.toISOString();
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || refreshToken,
      expiresAt,
    };
  };

  // Single retry with 1s delay for transient network errors
  try {
    return await attempt();
  } catch (error) {
    const isNetworkError = error instanceof TypeError || (error instanceof Error && /fetch|network|ECONNR/i.test(error.message));
    if (!isNetworkError) throw error;

    console.log('[schwab] Refresh failed with network error, retrying in 1s...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return await attempt();
  }
}

type TokenReader = Pick<Db, 'select'>;

export async function loadUserSchwabToken(db: TokenReader, userId: string): Promise<SchwabTokenState | null> {
  const rows = await db.select()
    .from(schwabTokens)
    .where(eq(schwabTokens.userId, userId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
  };
}

export async function getValidSchwabToken(db: Db, userId: string): Promise<SchwabTokenState | null> {
  // If another request is already refreshing for this user, wait on it
  const existing = refreshLocks.get(userId);
  if (existing) {
    return existing;
  }

  const doRefresh = async (): Promise<SchwabTokenState | null> => {
    try {
      return await db.transaction(async (tx) => {
        const token = await loadUserSchwabToken(tx, userId);
        if (!token) return null;

        if (!isTokenExpired(token.expiresAt)) {
          return token;
        }

        // Re-read from DB — another request may have already refreshed
        const freshToken = await loadUserSchwabToken(tx, userId);
        if (freshToken && !isTokenExpired(freshToken.expiresAt)) {
          console.log(`[schwab] Token for user ${userId} was already refreshed by another request`);
          return freshToken;
        }

        const tokenToRefresh = freshToken ?? token;
        console.log(`[schwab] Refreshing token for user ${userId}`);

        const refreshed = await refreshSchwabToken(tokenToRefresh.refreshToken);
        const rotated = refreshed.refreshToken !== tokenToRefresh.refreshToken;

        if (Number.isNaN(new Date(refreshed.expiresAt).getTime())) {
          throw new Error('Invalid expiresAt received from Schwab token refresh');
        }

        await tx.update(schwabTokens)
          .set({
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAt,
          })
          .where(eq(schwabTokens.userId, userId));

        logTokenEvent(userId, true, rotated ? 'refresh_token_rotated' : 'refresh_token_reused');

        return {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
        };
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown refresh error';
      logTokenEvent(userId, false, msg);
      throw error;
    } finally {
      refreshLocks.delete(userId);
    }
  };

  const promise = doRefresh();
  refreshLocks.set(userId, promise);
  return promise;
}
