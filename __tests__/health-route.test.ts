import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getDb: getDbMock }));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 503 when db client is not configured', async () => {
    getDbMock.mockReturnValueOnce(null);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ db: false });
  });

  it('returns 503 when ping query fails', async () => {
    getDbMock.mockReturnValueOnce({
      execute: vi.fn().mockRejectedValueOnce(new Error('connection refused')),
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ db: false });
  });

  it('returns healthy when db ping succeeds', async () => {
    const executeMock = vi.fn().mockResolvedValueOnce({ rows: [{ one: 1 }] });
    getDbMock.mockReturnValueOnce({ execute: executeMock });

    const response = await GET();
    const payload = await response.json();

    expect(executeMock).toHaveBeenCalledWith({ sql: 'select 1' });
    expect(response.status).toBe(200);
    expect(payload).toEqual({ db: true });
  });
});
