import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('sec client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the SEC-required User-Agent header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { secFetchJson } = await import('@/lib/sec/client');

    await secFetchJson('https://data.sec.gov/example.json');

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('Nexus Terminal jared.garcia0411@gmail.com');
    expect(headers['Accept']).toBe('application/json');
  });

  it('retries on 503 and succeeds on the second attempt', async () => {
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call++;
      if (call === 1) return new Response('boom', { status: 503 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { secFetchJson } = await import('@/lib/sec/client');

    const result = await secFetchJson<{ ok: boolean }>('https://data.sec.gov/example.json');

    expect(call).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('throws SecHttpError on 404 without retrying', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    const { secFetchJson, SecHttpError } = await import('@/lib/sec/client');

    await expect(secFetchJson('https://data.sec.gov/missing.json')).rejects.toBeInstanceOf(SecHttpError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('paces concurrent requests at least 100ms apart', async () => {
    const callTimes: number[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callTimes.push(Date.now());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { secFetchJson } = await import('@/lib/sec/client');

    await Promise.all([
      secFetchJson('https://data.sec.gov/a.json'),
      secFetchJson('https://data.sec.gov/b.json'),
      secFetchJson('https://data.sec.gov/c.json'),
    ]);

    expect(callTimes.length).toBe(3);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(100);
    expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(100);
  });
});
