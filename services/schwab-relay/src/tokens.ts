import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { RelayDb } from './db.js';
import { schwabLinks } from './schema.js';

export type SchwabTokenPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
};

type LinkRow = {
  id: string;
  userId: string;
  encryptedTokens: string;
  tokenIv: string;
  tokenTag: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
};

type EncryptedTokens = {
  encrypted: string;
  iv: string;
  tag: string;
};

type RefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
};

function getEncryptionKey(): Buffer {
  const hexKey = process.env.SCHWAB_TOKEN_ENCRYPTION_KEY;
  if (!hexKey) {
    throw new Error('Missing SCHWAB_TOKEN_ENCRYPTION_KEY environment variable');
  }

  if (hexKey.length !== 64) {
    throw new Error('SCHWAB_TOKEN_ENCRYPTION_KEY must be a 64-character hex string');
  }

  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) {
    throw new Error('SCHWAB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  }

  return key;
}

function encryptTokens(payload: SchwabTokenPayload): EncryptedTokens {
  const key = getEncryptionKey();
  const iv = randomBytes(16);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encryptedBuffer = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);

  return {
    encrypted: encryptedBuffer.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

function parseTokenPayload(value: unknown): SchwabTokenPayload {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid decrypted token payload');
  }

  const candidate = value as Partial<SchwabTokenPayload>;
  if (
    typeof candidate.accessToken !== 'string' ||
    typeof candidate.refreshToken !== 'string' ||
    typeof candidate.expiresAt !== 'string' ||
    typeof candidate.refreshExpiresAt !== 'string'
  ) {
    throw new Error('Invalid decrypted token payload fields');
  }

  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    expiresAt: candidate.expiresAt,
    refreshExpiresAt: candidate.refreshExpiresAt,
  };
}

function decryptTokens(encrypted: string, iv: string, tag: string): SchwabTokenPayload {
  const key = getEncryptionKey();

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  const decryptedBuffer = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'hex')),
    decipher.final(),
  ]);

  return parseTokenPayload(JSON.parse(decryptedBuffer.toString('utf8')));
}

async function markExpired(db: RelayDb, userId: string): Promise<void> {
  await db
    .update(schwabLinks)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(eq(schwabLinks.userId, userId));
}

function getClientCredentialsHeader(): string {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing Schwab OAuth client credentials');
  }

  const encoded = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  return `Basic ${encoded}`;
}

export async function refreshAccessToken(
  db: RelayDb,
  row: LinkRow,
  decryptedTokens: SchwabTokenPayload,
): Promise<SchwabTokenPayload> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: decryptedTokens.refreshToken,
  });

  const response = await fetch('https://api.schwabapi.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: getClientCredentialsHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new Error(`Failed to refresh Schwab access token (${response.status}): ${body}`);
  }

  const data = (await response.json()) as RefreshResponse;
  if (!data.access_token || typeof data.expires_in !== 'number') {
    throw new Error('Schwab token refresh response missing required fields');
  }

  const now = Date.now();
  const nextAccessExpiry = new Date(now + data.expires_in * 1000);

  const refreshToken = data.refresh_token ?? decryptedTokens.refreshToken;
  const nextRefreshExpiry =
    typeof data.refresh_token_expires_in === 'number'
      ? new Date(now + data.refresh_token_expires_in * 1000)
      : row.refreshTokenExpiresAt;

  const nextPayload: SchwabTokenPayload = {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: nextAccessExpiry.toISOString(),
    refreshExpiresAt: nextRefreshExpiry.toISOString(),
  };

  const encrypted = encryptTokens(nextPayload);

  await db
    .update(schwabLinks)
    .set({
      encryptedTokens: encrypted.encrypted,
      tokenIv: encrypted.iv,
      tokenTag: encrypted.tag,
      status: 'active',
      accessTokenExpiresAt: nextAccessExpiry,
      refreshTokenExpiresAt: nextRefreshExpiry,
      updatedAt: new Date(),
    })
    .where(and(eq(schwabLinks.userId, row.userId), eq(schwabLinks.id, row.id)));

  return nextPayload;
}

export async function loadActiveTokens(
  db: RelayDb,
): Promise<{ userId: string; tokens: SchwabTokenPayload } | null> {
  const [row] = await db
    .select({
      id: schwabLinks.id,
      userId: schwabLinks.userId,
      encryptedTokens: schwabLinks.encryptedTokens,
      tokenIv: schwabLinks.tokenIv,
      tokenTag: schwabLinks.tokenTag,
      accessTokenExpiresAt: schwabLinks.accessTokenExpiresAt,
      refreshTokenExpiresAt: schwabLinks.refreshTokenExpiresAt,
    })
    .from(schwabLinks)
    .where(eq(schwabLinks.status, 'active'))
    // NOTE: Single-user relay - only one Schwab-linked user gets streaming at a time.
    // If multiple users have active links, selection is nondeterministic.
    // To support multi-user, remove .limit(1) and manage per-user streaming sessions.
    .limit(1);

  if (!row) {
    return null;
  }

  if (row.refreshTokenExpiresAt.getTime() <= Date.now()) {
    await markExpired(db, row.userId);
    return null;
  }

  const decrypted = decryptTokens(row.encryptedTokens, row.tokenIv, row.tokenTag);
  const shouldRefresh = row.accessTokenExpiresAt.getTime() - Date.now() <= 5 * 60 * 1000;

  const tokens = shouldRefresh ? await refreshAccessToken(db, row, decrypted) : decrypted;
  return { userId: row.userId, tokens };
}
