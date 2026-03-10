import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { upsertMemory } from '@/lib/jarvis/memory';

describe('jarvis memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts memory row', async () => {
    const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }));
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    getDbMock.mockReturnValue({ insert: insertMock });

    await upsertMemory('u1', 'trade_insight', 'k1', 'v1');

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
  });
});
