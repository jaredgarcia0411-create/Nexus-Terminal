import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireUserMock, fetchSplitHistoryMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  fetchSplitHistoryMock: vi.fn(),
}));

vi.mock('@/lib/server-db-utils', () => ({ requireUser: requireUserMock }));
vi.mock('@/lib/massive-market', () => ({
  fetchSplitHistory: fetchSplitHistoryMock,
  isMassiveConfigured: () => true,
}));

import { GET } from '@/app/api/splits/route';

function request(symbol: string) {
  return new Request(`http://localhost/api/splits?symbol=${encodeURIComponent(symbol)}`);
}

describe('GET /api/splits symbol check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com', name: null, picture: null } });
    fetchSplitHistoryMock.mockResolvedValue([]);
  });

  it.each(['../../v3/reference/tickers', 'A B', 'A?B=1'])('rejects %s before calling Massive', async (symbol) => {
    const response = await GET(request(symbol));
    expect(response.status).toBe(400);
    expect(fetchSplitHistoryMock).not.toHaveBeenCalled();
  });

  it.each(['AAPL', 'BRK.B', 'BF-B', '^SPX', 'I:SPX'])('accepts %s', async (symbol) => {
    const response = await GET(request(symbol));
    expect(response.status).toBe(200);
    expect(fetchSplitHistoryMock).toHaveBeenCalledWith(symbol);
  });
});
