import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { DELETE as memoryDelete, GET as memoryGet } from '@/app/api/jarvis/admin/memory/route';
import { GET as statsGet } from '@/app/api/jarvis/admin/stats/route';

function ensureResponse(response: Response | undefined): Response {
  if (!response) {
    throw new Error('Expected response');
  }

  return response;
}

describe('jarvis admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JARVIS_ADMIN_KEY = 'admin-secret';
    getDbMock.mockReturnValue(null);
  });

  it('rejects jarvis stats when admin key is missing', async () => {
    const response = await statsGet(new Request('http://localhost/api/jarvis/admin/stats', { method: 'GET' }));
    expect(ensureResponse(response).status).toBe(401);
  });

  it('returns db unavailable for jarvis stats when authorized but db missing', async () => {
    const response = await statsGet(new Request('http://localhost/api/jarvis/admin/stats', {
      method: 'GET',
      headers: { 'x-jarvis-admin-key': 'admin-secret' },
    }));
    expect(ensureResponse(response).status).toBe(503);
  });

  it('rejects jarvis memory routes when admin key is missing', async () => {
    const response = await memoryGet(new Request('http://localhost/api/jarvis/admin/memory?userId=u1', { method: 'GET' }));
    expect(ensureResponse(response).status).toBe(401);
  });

  it('validates memory delete payload', async () => {
    getDbMock.mockReturnValue({
      delete: vi.fn(() => ({
        returning: vi.fn(async () => []),
        where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
      })),
    });

    const response = await memoryDelete(new Request('http://localhost/api/jarvis/admin/memory', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-jarvis-admin-key': 'admin-secret',
      },
      body: JSON.stringify({}),
    }));

    expect(ensureResponse(response).status).toBe(400);
  });
});
