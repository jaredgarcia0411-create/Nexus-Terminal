import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock, ensureUserMock, getDbMock, runResearchPipelineMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  getDbMock: vi.fn(),
  runResearchPipelineMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock, ensureUser: ensureUserMock }));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));
vi.mock('@/lib/jarvis/research', () => ({ runResearchPipeline: runResearchPipelineMock }));

import { POST } from '@/app/api/jarvis/research/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected a response');
  return response;
}

describe('jarvis research route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u@x.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    getDbMock.mockReturnValue({});
    runResearchPipelineMock.mockResolvedValue({ ticker: 'AAPL' });
  });

  it('validates ticker required', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(ensureResponse(response).status).toBe(400);
    expect(ensureUserMock).toHaveBeenCalledTimes(1);
  });

  it('ensures user exists before running pipeline', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'AAPL' }),
    }));

    expect(ensureResponse(response).status).toBe(200);
    expect(ensureUserMock).toHaveBeenCalledTimes(1);
    expect(runResearchPipelineMock).toHaveBeenCalledWith('u1', 'AAPL');
  });
});
