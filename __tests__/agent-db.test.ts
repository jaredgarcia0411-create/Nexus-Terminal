import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolConstructorMock = vi.hoisted(() => vi.fn());
const drizzleMock = vi.hoisted(() => vi.fn());

vi.mock('@neondatabase/serverless', () => ({
  Pool: class MockPool {
    constructor(config: unknown) {
      return poolConstructorMock(config);
    }
  },
}));

vi.mock('drizzle-orm/neon-serverless', () => ({
  drizzle: drizzleMock,
}));

describe('getAgentDb', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns null when DATABASE_URL is missing', async () => {
    const { getAgentDb } = await import('@/lib/agents/db');

    expect(getAgentDb()).toBeNull();
    expect(poolConstructorMock).not.toHaveBeenCalled();
    expect(drizzleMock).not.toHaveBeenCalled();
  });

  it('creates and memoizes the pool-backed agent db singleton', async () => {
    process.env.DATABASE_URL = 'postgres://example';
    const poolInstance = { kind: 'pool' };
    const dbInstance = { kind: 'agent-db' };
    poolConstructorMock.mockReturnValue(poolInstance);
    drizzleMock.mockReturnValue(dbInstance);

    const { getAgentDb } = await import('@/lib/agents/db');

    const first = getAgentDb();
    const second = getAgentDb();

    expect(poolConstructorMock).toHaveBeenCalledTimes(1);
    expect(poolConstructorMock).toHaveBeenCalledWith({ connectionString: process.env.DATABASE_URL });
    expect(drizzleMock).toHaveBeenCalledTimes(1);
    expect(drizzleMock).toHaveBeenCalledWith(poolInstance, expect.objectContaining({ schema: expect.any(Object) }));
    expect(first).toBe(dbInstance);
    expect(second).toBe(dbInstance);
  });
});
