import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, requireJarvisAdminMock, getCircuitBreakerStateMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  requireJarvisAdminMock: vi.fn(),
  getCircuitBreakerStateMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/jarvis-admin', () => ({
  requireJarvisAdmin: requireJarvisAdminMock,
}));

vi.mock('@/lib/jarvis-circuit-breaker', () => ({
  getCircuitBreakerState: getCircuitBreakerStateMock,
}));

import { GET } from '@/app/api/jarvis/admin/stats/route';

async function parseResponse(response: Response) {
  const payload = await response.json();
  return { status: response.status, payload };
}

describe('GET /api/jarvis/admin/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireJarvisAdminMock.mockReturnValue(null);
    getCircuitBreakerStateMock.mockReturnValue({
      status: 'closed',
      consecutiveFailures: 0,
      lastFailureAt: null,
      openedAt: null,
    });
  });

  it('returns 503 when admin key is not configured', async () => {
    requireJarvisAdminMock.mockReturnValueOnce(Response.json({ error: 'Jarvis admin key is not configured.' }, { status: 503 }));

    const response = await GET(new Request('http://localhost/api/jarvis/admin/stats'));
    const { status, payload } = await parseResponse(response);

    expect(status).toBe(503);
    expect(payload.error).toContain('admin key');
  });

  it('returns 401 when admin key is invalid', async () => {
    requireJarvisAdminMock.mockReturnValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await GET(new Request('http://localhost/api/jarvis/admin/stats'));
    const { status, payload } = await parseResponse(response);

    expect(status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 200 with expected shape when authorized', async () => {
    const todayWhere = vi.fn(async () => [{
      totalRequests: 10,
      totalTokens: 5000,
      successCount: 8,
      avgDurationMs: 420,
    }]);
    const todayFrom = vi.fn(() => ({ where: todayWhere }));

    const userLimit = vi.fn(async () => [
      { userId: 'u1', requestCount: 6, totalTokens: 3000, avgDurationMs: 400 },
      { userId: 'u2', requestCount: 4, totalTokens: 2000, avgDurationMs: 450 },
    ]);
    const userOrderBy = vi.fn(() => ({ limit: userLimit }));
    const userGroupBy = vi.fn(() => ({ orderBy: userOrderBy }));
    const userWhere = vi.fn(() => ({ groupBy: userGroupBy }));
    const userFrom = vi.fn(() => ({ where: userWhere }));

    const selectMock = vi.fn()
      .mockReturnValueOnce({ from: todayFrom })
      .mockReturnValueOnce({ from: userFrom });

    getDbMock.mockReturnValue({ select: selectMock });

    const response = await GET(new Request('http://localhost/api/jarvis/admin/stats'));
    const { status, payload } = await parseResponse(response);

    expect(status).toBe(200);
    expect(payload).toMatchObject({
      circuitBreaker: {
        status: 'closed',
      },
      today: {
        totalRequests: 10,
        totalTokens: 5000,
        successRate: 0.8,
        avgDurationMs: 420,
      },
    });
    expect(payload.userBreakdown).toEqual([
      { userId: 'u1', requestCount: 6, totalTokens: 3000, avgDurationMs: 400 },
      { userId: 'u2', requestCount: 4, totalTokens: 2000, avgDurationMs: 450 },
    ]);
  });

  it('includes circuitBreaker state in response', async () => {
    getCircuitBreakerStateMock.mockReturnValueOnce({
      status: 'open',
      consecutiveFailures: 5,
      lastFailureAt: 100,
      openedAt: 100,
    });

    const selectMock = vi.fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => [{ totalRequests: 0, totalTokens: 0, successCount: 0, avgDurationMs: 0 }]) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ groupBy: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })) })) });

    getDbMock.mockReturnValue({ select: selectMock });

    const response = await GET(new Request('http://localhost/api/jarvis/admin/stats'));
    const { payload } = await parseResponse(response);

    expect(payload.circuitBreaker.status).toBe('open');
  });

  it('includes today aggregate and userBreakdown array', async () => {
    const selectMock = vi.fn()
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(async () => [{ totalRequests: 2, totalTokens: 10, successCount: 1, avgDurationMs: 100 }]) })) })
      .mockReturnValueOnce({ from: vi.fn(() => ({ where: vi.fn(() => ({ groupBy: vi.fn(() => ({ orderBy: vi.fn(() => ({ limit: vi.fn(async () => [{ userId: 'u1', requestCount: 2, totalTokens: 10, avgDurationMs: 100 }]) })) })) })) })) });

    getDbMock.mockReturnValue({ select: selectMock });

    const response = await GET(new Request('http://localhost/api/jarvis/admin/stats'));
    const { status, payload } = await parseResponse(response);

    expect(status).toBe(200);
    expect(payload.today).toBeDefined();
    expect(Array.isArray(payload.userBreakdown)).toBe(true);
  });
});
