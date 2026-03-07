import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

import { GET as GET_MEMORY_STATS } from '@/app/api/jarvis/admin/memory/stats/route';
import { DELETE as DELETE_MEMORY_PURGE } from '@/app/api/jarvis/admin/memory/purge/route';

async function parseResponse(response: Response) {
  const payload = await response.json();
  return { status: response.status, payload };
}

describe('Jarvis admin memory routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.JARVIS_ADMIN_KEY;
  });

  it('rejects stats requests without an admin key configured', async () => {
    const response = await GET_MEMORY_STATS(new Request('http://localhost/api/jarvis/admin/memory/stats'));
    const { status, payload } = await parseResponse(response);

    expect(status).toBe(503);
    expect(payload.error).toContain('admin key');
  });

  it('rejects purge requests with an invalid admin key', async () => {
    process.env.JARVIS_ADMIN_KEY = 'expected';

    const response = await DELETE_MEMORY_PURGE(new Request('http://localhost/api/jarvis/admin/memory/purge', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-jarvis-admin-key': 'wrong',
      },
      body: JSON.stringify({ all: true }),
    }));
    const { status, payload } = await parseResponse(response);

    expect(status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 400 when purge filter is missing', async () => {
    process.env.JARVIS_ADMIN_KEY = 'expected';
    getDbMock.mockReturnValue({
      delete: vi.fn(),
    });

    const response = await DELETE_MEMORY_PURGE(new Request('http://localhost/api/jarvis/admin/memory/purge', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-jarvis-admin-key': 'expected',
      },
      body: JSON.stringify({}),
    }));
    const { status, payload } = await parseResponse(response);

    expect(status).toBe(400);
    expect(payload.error).toContain('Provide one of');
  });
});
