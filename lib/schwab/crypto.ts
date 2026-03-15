import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type SchwabTokenPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
};

function getEncryptionKey() {
  const rawKey = process.env.SCHWAB_TOKEN_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error('SCHWAB_TOKEN_ENCRYPTION_KEY is not configured');
  }

  if (rawKey.length !== 64) {
    throw new Error('SCHWAB_TOKEN_ENCRYPTION_KEY must be a 64-character hex string');
  }

  if (!/^[0-9a-fA-F]+$/.test(rawKey)) {
    throw new Error('SCHWAB_TOKEN_ENCRYPTION_KEY must contain only hex characters');
  }

  const key = Buffer.from(rawKey, 'hex');
  if (key.length !== 32) {
    throw new Error('SCHWAB_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  return key;
}

export function encryptTokens(payload: SchwabTokenPayload) {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

export function decryptTokens(encrypted: string, iv: string, tag: string): SchwabTokenPayload {
  const key = getEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'hex')),
    decipher.final(),
  ]).toString('utf8');

  return JSON.parse(decrypted) as SchwabTokenPayload;
}
