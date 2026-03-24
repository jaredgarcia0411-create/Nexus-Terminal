import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserMock,
  ensureUserMock,
  checkRateLimitMock,
  buildContextMock,
  callJarvisMock,
  getDbMock,
  runTradeAnalysisPipelineMock,
  fetchAndCacheRawReportMock,
  runResearchTldrMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  buildContextMock: vi.fn(),
  callJarvisMock: vi.fn(),
  getDbMock: vi.fn(),
  runTradeAnalysisPipelineMock: vi.fn(),
  fetchAndCacheRawReportMock: vi.fn(),
  runResearchTldrMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({
  requireUser: requireUserMock,
  ensureUser: ensureUserMock,
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
}));
vi.mock('@/lib/jarvis/rate-limit', () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock('@/lib/jarvis/context', () => ({ buildContext: buildContextMock }));
vi.mock('@/lib/jarvis/client', () => ({ callJarvis: callJarvisMock }));
vi.mock('@/lib/jarvis/trade-analysis', () => ({ runTradeAnalysisPipeline: runTradeAnalysisPipelineMock }));
vi.mock('@/lib/jarvis/research', () => ({
  fetchAndCacheRawReport: fetchAndCacheRawReportMock,
  runResearchTldr: runResearchTldrMock,
}));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { POST } from '@/app/api/jarvis/chat/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected a response');
  return response;
}

function insertPayloadAt(callIndex: number, calls: unknown[][]): { userId?: string } {
  const call = calls[callIndex];
  if (!call || call.length === 0) {
    throw new Error(`Missing insert payload at index ${callIndex}`);
  }
  return call[0] as { userId?: string };
}

describe('jarvis chat route', () => {
  const selectLimitMock = vi.fn(async () => []);
  const insertValuesMock = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u@x.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue({ id: 'canonical-u1', email: 'u@x.com', name: null, picture: null });
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 10, resetAt: Date.now() + 1000 });
    buildContextMock.mockResolvedValue({ user_trades: [], macro_summary: null, memory: [] });
    callJarvisMock.mockResolvedValue({ content: 'hello back', modelUsed: 'm' });
    runTradeAnalysisPipelineMock.mockResolvedValue({ analysis: { strengths: [], weaknesses: [], patterns: [], action_items: [] } });
    fetchAndCacheRawReportMock.mockResolvedValue({ ticker: 'AAPL', rawData: { screener: { status: 'success', results: [] } }, warnings: [], fromCache: false, generatedAt: new Date().toISOString() });
    runResearchTldrMock.mockResolvedValue({ tldr: 'summary', findings: [], actionSteps: [], risks: [] });
    selectLimitMock.mockResolvedValue([]);
    insertValuesMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimitMock })) })) })),
      insert: vi.fn(() => ({ values: insertValuesMock })),
    });
  });

  it('uses canonical user id for normal chat message', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    }));

    expect(ensureResponse(response).status).toBe(200);
    expect(ensureUserMock).toHaveBeenCalledTimes(1);
    expect(checkRateLimitMock).toHaveBeenCalledWith('canonical-u1');
    expect(insertValuesMock).toHaveBeenCalled();
    const firstInsertPayload = insertPayloadAt(0, insertValuesMock.mock.calls as unknown[][]);
    expect(firstInsertPayload.userId).toBe('canonical-u1');
  });

  it('uses canonical user id for /analyze command', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '/analyze' }),
    }));

	expect(ensureResponse(response).status).toBe(200);
	expect(runTradeAnalysisPipelineMock).toHaveBeenCalledWith('canonical-u1');
    const firstInsertPayload = insertPayloadAt(0, insertValuesMock.mock.calls as unknown[][]);
    const secondInsertPayload = insertPayloadAt(1, insertValuesMock.mock.calls as unknown[][]);
    expect(firstInsertPayload.userId).toBe('canonical-u1');
    expect(secondInsertPayload.userId).toBe('canonical-u1');
  });

  it('returns 503 when database is unavailable', async () => {
    getDbMock.mockReturnValueOnce(null);

    const response = await POST(new Request('http://localhost/api/jarvis/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    }));

    expect(ensureResponse(response).status).toBe(503);
    expect(ensureUserMock).not.toHaveBeenCalled();
  });

  it('runs raw fetch + TLDR pipeline for /research command', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '/research AAPL' }),
    }));

    expect(ensureResponse(response).status).toBe(200);
    expect(fetchAndCacheRawReportMock).toHaveBeenCalledWith('canonical-u1', 'AAPL');
    expect(runResearchTldrMock).toHaveBeenCalledWith({ screener: { status: 'success', results: [] } }, 'AAPL');
  });

  it('treats /research! as normal chat command text', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '/research! AAPL' }),
    }));

    expect(ensureResponse(response).status).toBe(200);
    expect(fetchAndCacheRawReportMock).not.toHaveBeenCalled();
    expect(callJarvisMock).toHaveBeenCalledTimes(1);
  });
});
