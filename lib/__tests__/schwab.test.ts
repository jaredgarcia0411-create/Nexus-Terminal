import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getValidSchwabToken, loadUserSchwabToken, logTokenEvent } from '@/lib/schwab';

function createSelectChain(rows: any[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, limit };
}

describe('logTokenEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('outputs structured JSON via console.info for success', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    logTokenEvent('user-1', true, 'refresh_token_rotated');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(infoSpy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload.event).toBe('schwab_token_refresh');
    expect(payload.userId).toBe('user-1');
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('refresh_token_rotated');
    expect(typeof payload.timestamp).toBe('string');
    expect(Number.isNaN(new Date(String(payload.timestamp)).getTime())).toBe(false);
  });

  it('outputs structured JSON via console.error for failure', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    logTokenEvent('user-2', false, 'refresh failed');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(errorSpy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload.event).toBe('schwab_token_refresh');
    expect(payload.userId).toBe('user-2');
    expect(payload.success).toBe(false);
    expect(payload.message).toBe('refresh failed');
    expect(typeof payload.timestamp).toBe('string');
    expect(Number.isNaN(new Date(String(payload.timestamp)).getTime())).toBe(false);
  });
});

describe('loadUserSchwabToken', () => {
  it('returns null when no row exists', async () => {
    const chain = createSelectChain([]);
    const result = await loadUserSchwabToken({ select: chain.select } as any, 'user-a');
    expect(result).toBeNull();
  });

  it('returns token shape when a row exists', async () => {
    const chain = createSelectChain([{
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00.000Z',
    }]);
    const result = await loadUserSchwabToken({ select: chain.select } as any, 'user-b');
    expect(result).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
  });
});

describe('getValidSchwabToken', () => {
  const originalClientId = process.env.SCHWAB_CLIENT_ID;
  const originalClientSecret = process.env.SCHWAB_CLIENT_SECRET;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SCHWAB_CLIENT_ID = 'client-id';
    process.env.SCHWAB_CLIENT_SECRET = 'client-secret';
  });

  afterEach(() => {
    process.env.SCHWAB_CLIENT_ID = originalClientId;
    process.env.SCHWAB_CLIENT_SECRET = originalClientSecret;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('calls db.transaction', async () => {
    const selectChain = createSelectChain([{
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: '2999-01-01T00:00:00.000Z',
    }]);
    const tx = {
      select: selectChain.select,
      update: vi.fn(),
    };
    const db = {
      transaction: vi.fn(async (cb: (trx: any) => Promise<any>) => cb(tx)),
    };

    const token = await getValidSchwabToken(db as any, 'user-c');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(token?.accessToken).toBe('access-token');
  });

  it('throws when refreshed.expiresAt is invalid', async () => {
    const expiredRow = {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: '2000-01-01T00:00:00.000Z',
    };
    const selectChain = createSelectChain([expiredRow]);
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));

    const tx = {
      select: selectChain.select,
      update,
    };
    const db = {
      transaction: vi.fn(async (cb: (trx: any) => Promise<any>) => cb(tx)),
    };

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 'not-a-number',
      }),
    })) as any;

    await expect(getValidSchwabToken(db as any, 'user-d')).rejects.toThrow(
      'Invalid expiresAt received from Schwab token refresh',
    );
  });
});
