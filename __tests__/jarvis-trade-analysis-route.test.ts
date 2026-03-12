import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock, ensureUserMock, getDbMock, runTradeAnalysisPipelineMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
  runTradeAnalysisPipelineMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock, ensureUser: ensureUserMock }));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/jarvis/trade-analysis', () => ({ runTradeAnalysisPipeline: runTradeAnalysisPipelineMock }));

import { POST } from '@/app/api/jarvis/trade-analysis/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected a response');
  return response;
}

describe('jarvis trade analysis route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u@x.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue({});
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
    expect(runTradeAnalysisPipelineMock).toHaveBeenCalledWith('u1', undefined);
  });
});
