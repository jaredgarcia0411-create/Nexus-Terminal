import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('schwab crypto', () => {
  const TEST_KEY = 'a'.repeat(64);

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SCHWAB_TOKEN_ENCRYPTION_KEY', TEST_KEY);
  });

  it('encrypt then decrypt returns original payload', async () => {
    const { encryptTokens, decryptTokens } = await import('@/lib/schwab/crypto');
    const payload = {
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: '2026-01-01T00:00:00Z',
      refreshExpiresAt: '2026-06-01T00:00:00Z',
    };

    const encrypted = encryptTokens(payload);
    const decrypted = decryptTokens(encrypted.encrypted, encrypted.iv, encrypted.tag);
    expect(decrypted).toEqual(payload);
  });

  it('throws on invalid key length', async () => {
    vi.stubEnv('SCHWAB_TOKEN_ENCRYPTION_KEY', 'tooshort');
    const { encryptTokens } = await import('@/lib/schwab/crypto');
    expect(() =>
      encryptTokens({
        accessToken: 'a',
        refreshToken: 'b',
        expiresAt: 'c',
        refreshExpiresAt: 'd',
      }),
    ).toThrow();
  });

  it('throws on tampered ciphertext', async () => {
    const { encryptTokens, decryptTokens } = await import('@/lib/schwab/crypto');
    const payload = {
      accessToken: 'access-123',
      refreshToken: 'refresh-456',
      expiresAt: '2026-01-01T00:00:00Z',
      refreshExpiresAt: '2026-06-01T00:00:00Z',
    };
    const encrypted = encryptTokens(payload);
    const tampered = `ff${encrypted.encrypted.slice(2)}`;
    expect(() => decryptTokens(tampered, encrypted.iv, encrypted.tag)).toThrow();
  });
});
