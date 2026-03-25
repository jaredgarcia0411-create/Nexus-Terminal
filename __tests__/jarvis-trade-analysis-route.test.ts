import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock, ensureUserMock, getDbMock, runTradeAnalysisPipelineMock, checkRateLimitMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
  runTradeAnalysisPipelineMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/jarvis/trade-analysis', () => ({ runTradeAnalysisPipeline: runTradeAnalysisPipelineMock }));
vi.mock('@/lib/jarvis/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/jarvis/rate-limit')>();
  return { ...actual, checkRateLimit: checkRateLimitMock };
});

import { POST } from '@/app/api/jarvis/trade-analysis/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected a response');
  return response;
}

describe('jarvis trade analysis route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u@x.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue({ id: 'canonical-u1', email: 'u@x.com', name: null, picture: null });
    getDbMock.mockReturnValue({});
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now() + 1_000 });
    runTradeAnalysisPipelineMock.mockResolvedValue({
      analysis: { strengths: [], weaknesses: [], patterns: [], action_items: [] },
    });
  });

  it('ensures user exists before running trade analysis', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis/trade-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
	expect(ensureResponse(response).status).toBe(200);
	expect(ensureUserMock).toHaveBeenCalledTimes(1);
	expect(runTradeAnalysisPipelineMock).toHaveBeenCalledWith('canonical-u1');
  });

  it('returns 503 when database is unavailable', async () => {
    getDbMock.mockReturnValueOnce(null);

    const response = await POST(new Request('http://localhost/api/jarvis/trade-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));

    expect(ensureResponse(response).status).toBe(503);
    expect(ensureUserMock).not.toHaveBeenCalled();
  });
});
