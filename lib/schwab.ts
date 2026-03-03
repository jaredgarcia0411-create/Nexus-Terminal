import type { Client, InValue } from '@libsql/client';

type TokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

export type SchwabTokenState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

function readTokenRow(row: Record<string, InValue>): SchwabTokenState {
  return {
    accessToken: String(row.access_token),
    refreshToken: String(row.refresh_token),
    expiresAt: String(row.expires_at),
  };
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
      expires_in?: number;
      error?: string;
    };

    if (!res.ok || !payload.access_token) {
      throw new Error(payload.error || 'Failed to refresh Schwab token');
    }

    const expiresAt = new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString();
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

export async function loadUserSchwabToken(db: Client, userId: string): Promise<SchwabTokenState | null> {
  const rowRes = await db.execute({
    sql: 'SELECT user_id, access_token, refresh_token, expires_at FROM schwab_tokens WHERE user_id = ? LIMIT 1',
    args: [userId],
  });

  const row = rowRes.rows[0] as Record<string, InValue> | undefined;
  if (!row) return null;
  return readTokenRow(row);
}

async function logTokenRefresh(db: Client, userId: string, rotated: boolean, error?: string) {
  try {
    await db.execute({
      sql: `INSERT INTO token_refresh_log (user_id, rotated, error, created_at) VALUES (?, ?, ?, datetime('now'))`,
      args: [userId, rotated ? 1 : 0, error ?? null],
    });
  } catch {
    // Non-critical — don't break the refresh flow
  }
}

export async function getValidSchwabToken(db: Client, userId: string): Promise<SchwabTokenState | null> {
  // If another request is already refreshing for this user, wait on it
  const existing = refreshLocks.get(userId);
  if (existing) {
    return existing;
  }

  const doRefresh = async (): Promise<SchwabTokenState | null> => {
    try {
      const token = await loadUserSchwabToken(db, userId);
      if (!token) return null;

      if (!isTokenExpired(token.expiresAt)) {
        return token;
      }

      // Re-read from DB — another request may have already refreshed
      const freshToken = await loadUserSchwabToken(db, userId);
      if (freshToken && !isTokenExpired(freshToken.expiresAt)) {
        console.log(`[schwab] Token for user ${userId} was already refreshed by another request`);
        return freshToken;
      }

      const tokenToRefresh = freshToken ?? token;
      console.log(`[schwab] Refreshing token for user ${userId}`);

      const refreshed = await refreshSchwabToken(tokenToRefresh.refreshToken);
      const rotated = refreshed.refreshToken !== tokenToRefresh.refreshToken;

      console.log(`[schwab] Token refreshed for user ${userId}, rotation=${rotated}, expires=${refreshed.expiresAt}`);

      await db.execute({
        sql: `
          UPDATE schwab_tokens
          SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
          WHERE user_id = ?
        `,
        args: [refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt, userId],
      });

      await logTokenRefresh(db, userId, rotated);

      return {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown refresh error';
      console.error(`[schwab] Token refresh failed for user ${userId}: ${msg}`);
      await logTokenRefresh(db, userId, false, msg);
      throw error;
    } finally {
      refreshLocks.delete(userId);
    }
  };

  const promise = doRefresh();
  refreshLocks.set(userId, promise);
  return promise;
}

export type { TokenRow };
