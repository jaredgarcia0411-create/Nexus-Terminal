import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/market-data/route';

describe('GET /api/market-data', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 when symbol is missing', async () => {
    const response = await GET(new Request('http://localhost/api/market-data'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: 'Missing symbol' });
  });

  it('returns 502 when upstream fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network unavailable'));

    const response = await GET(new Request('http://localhost/api/market-data?symbol=AAPL'));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({ error: 'Market data provider unavailable' });
  });
});
