import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock, ensureUserMock, checkRateLimitMock, buildContextMock, callJarvisMock, getDbMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  ensureUserMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  buildContextMock: vi.fn(),
  callJarvisMock: vi.fn(),
  getDbMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock, ensureUser: ensureUserMock }));
vi.mock('@/lib/jarvis/rate-limit', () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock('@/lib/jarvis/context', () => ({ buildContext: buildContextMock }));
vi.mock('@/lib/jarvis/client', () => ({ callJarvis: callJarvisMock }));
vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { POST } from '@/app/api/jarvis/chat/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected a response');
  return response;
}

describe('jarvis chat route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u@x.com', name: null, picture: null } });
    ensureUserMock.mockResolvedValue(undefined);
    checkRateLimitMock.mockReturnValue({ allowed: true, remaining: 10, resetAt: Date.now() + 1000 });
    buildContextMock.mockResolvedValue({ user_trades: [], macro_summary: null, memory: [] });
    callJarvisMock.mockResolvedValue({ content: 'hello back', modelUsed: 'm' });
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    });
  });

  it('returns 200 for normal chat message', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    }));
    expect(ensureResponse(response).status).toBe(200);
    expect(ensureUserMock).toHaveBeenCalledTimes(1);
  });
});
