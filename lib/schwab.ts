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

export async function getValidSchwabToken(db: Client, userId: string): Promise<SchwabTokenState | null> {
  const token = await loadUserSchwabToken(db, userId);
  if (!token) return null;

  if (!isTokenExpired(token.expiresAt)) {
    return token;
  }

  const refreshed = await refreshSchwabToken(token.refreshToken);

  await db.execute({
    sql: `
      UPDATE schwab_tokens
      SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
      WHERE user_id = ?
    `,
    args: [refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt, userId],
  });

  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
  };
}

export type { TokenRow };
