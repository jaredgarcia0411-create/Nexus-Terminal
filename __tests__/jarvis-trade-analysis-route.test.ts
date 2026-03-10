import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));

vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock }));

import { POST } from '@/app/api/jarvis/trade-analysis/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected a response');
  return response;
}

describe('jarvis trade analysis route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'u1', email: 'u@x.com', name: null, picture: null } });
  });

  it('returns server error when db is unavailable', async () => {
    const response = await POST(new Request('http://localhost/api/jarvis/trade-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect([500, 503]).toContain(ensureResponse(response).status);
  });
});
