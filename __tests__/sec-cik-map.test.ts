import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return { ...actual, getDb: getDbMock };
});

function emptyDb() {
  return {
    select: () => ({ from: async () => [] }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => undefined,
      }),
    }),
  };
}

const SEC_PAYLOAD = {
  fields: ['cik', 'name', 'ticker', 'exchange'],
  data: [
    [320193, 'Apple Inc.', 'AAPL', 'Nasdaq'],
    [1067983, 'BERKSHIRE HATHAWAY INC', 'BRK-B', 'NYSE'],
  ],
};

describe('sec cik map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
    getDbMock.mockReset();
    getDbMock.mockReturnValue(emptyDb());
  });

  it('maps tickers to padded CIKs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEC_PAYLOAD), { status: 200 }),
    );
    const mod = await import('@/lib/sec/cik-map');
    mod.__resetCikMapForTests();

    const entry = await mod.getCikForTicker('AAPL');

    expect(entry).toEqual({
      ticker: 'AAPL',
      cik: '0000320193',
      name: 'Apple Inc.',
      exchange: 'Nasdaq',
    });
  });

  it('normalizes lowercase and dot-suffix tickers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEC_PAYLOAD), { status: 200 }),
    );
    const mod = await import('@/lib/sec/cik-map');
    mod.__resetCikMapForTests();

    const lowercased = await mod.getCikForTicker('aapl');
    const dotted = await mod.getCikForTicker('brk.b');

    expect(lowercased?.cik).toBe('0000320193');
    expect(dotted?.cik).toBe('0001067983');
  });

  it('returns null for unknown tickers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEC_PAYLOAD), { status: 200 }),
    );
    const mod = await import('@/lib/sec/cik-map');
    mod.__resetCikMapForTests();

    const entry = await mod.getCikForTicker('NOTREAL');

    expect(entry).toBeNull();
  });

  it('dedupes parallel loads into a single SEC fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEC_PAYLOAD), { status: 200 }),
    );
    const mod = await import('@/lib/sec/cik-map');
    mod.__resetCikMapForTests();

    await Promise.all([mod.getCikForTicker('AAPL'), mod.getCikForTicker('BRK-B')]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
