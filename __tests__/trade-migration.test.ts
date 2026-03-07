import { describe, expect, it } from 'vitest';
import {
  acquireMigrationLock,
  createMigrationBatchKey,
  isDatabaseUnavailableError,
  releaseMigrationLock,
} from '@/lib/trade-migration';

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe('createMigrationBatchKey', () => {
  it('is deterministic and order-insensitive', () => {
    const batchA = createMigrationBatchKey(
      'user-1',
      [
        { id: 'b', date: '2026-03-05T10:00:00.000Z', netPnl: -12, executionCount: 2 },
        { id: 'a', date: '2026-03-04T10:00:00.000Z', netPnl: 45, executionCount: 1 },
      ],
      ['focus', 'breakout'],
    );

    const batchB = createMigrationBatchKey(
      'user-1',
      [
        { id: 'a', date: '2026-03-04T10:00:00.000Z', netPnl: 45, executionCount: 1 },
        { id: 'b', date: '2026-03-05T10:00:00.000Z', netPnl: -12, executionCount: 2 },
      ],
      ['breakout', 'focus'],
    );

    expect(batchA).toBe(batchB);
    expect(batchA.startsWith('local-migration:user-1:')).toBe(true);
  });
});

describe('migration lock helpers', () => {
  it('allows one lock holder within TTL and then expires', () => {
    const storage = makeStorage();
    const lockKey = 'nexus-cloud-migration-lock:user-1';

    expect(acquireMigrationLock(storage, lockKey, 1_000, 120_000)).toBe(true);
    expect(acquireMigrationLock(storage, lockKey, 1_010, 120_000)).toBe(false);
    expect(acquireMigrationLock(storage, lockKey, 130_001, 120_000)).toBe(true);

    releaseMigrationLock(storage, lockKey);
    expect(acquireMigrationLock(storage, lockKey, 130_002, 120_000)).toBe(true);
  });
});

describe('isDatabaseUnavailableError', () => {
  it('detects explicit database unavailable errors', () => {
    expect(isDatabaseUnavailableError({ status: 503, message: 'Database not configured' })).toBe(true);
    expect(isDatabaseUnavailableError(new Error('Database not configured'))).toBe(true);
    expect(isDatabaseUnavailableError(new Error('Authentication required'))).toBe(false);
  });
});
