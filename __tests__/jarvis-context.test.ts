import { describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { buildContext } from '@/lib/jarvis/context';

describe('jarvis context', () => {
  it('returns empty context when db missing', async () => {
    getDbMock.mockReturnValue(null);
    const context = await buildContext('u1', 'chat');
    expect(context).toEqual({ user_trades: [], macro_summary: null, memory: [] });
  });
});
