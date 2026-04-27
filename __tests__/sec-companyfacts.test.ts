import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock('@/lib/db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db')>('@/lib/db');
  return { ...actual, getDb: getDbMock };
});

vi.mock('@/lib/sec/cik-map', () => ({
  getCikForTicker: vi.fn(),
  padCik: (cik: string | number) => String(cik).padStart(10, '0'),
}));

function emptyDb() {
  return {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
  };
}

function dbWithRow(row: { cik: string; fetchedAt: Date; payload: unknown }) {
  return {
    select: () => ({ from: () => ({ where: async () => [row] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => undefined }) }),
  };
}

function makeFacts(override?: {
  deiShares?: { end: string; val: number; filed: string; accn: string; frame?: string }[];
  gaapOutstanding?: { end: string; val: number; filed: string; accn: string; frame?: string }[];
  gaapIssued?: { end: string; val: number; filed: string; accn: string; frame?: string }[];
}) {
  const facts: Record<string, unknown> = {};
  if (override?.deiShares) {
    facts['dei'] = {
      EntityCommonStockSharesOutstanding: { units: { shares: override.deiShares } },
    };
  }
  if (override?.gaapOutstanding || override?.gaapIssued) {
    facts['us-gaap'] = {
      ...(override.gaapOutstanding
        ? { CommonStockSharesOutstanding: { units: { shares: override.gaapOutstanding } } }
        : {}),
      ...(override.gaapIssued
        ? { CommonStockSharesIssued: { units: { shares: override.gaapIssued } } }
        : {}),
    };
  }
  return { facts };
}

function mockFetch(payload: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(payload), { status: 200 }),
  );
}

function mockFetchError(status: number) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(`SEC ${status}`, { status, statusText: `SEC ${status}` }),
  );
}

describe('sec-companyfacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
    getDbMock.mockReset();
    getDbMock.mockReturnValue(emptyDb());
  });

  it('returns dei entries when EntityCommonStockSharesOutstanding is present', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({ deiShares: [{ end: '2024-09-30', val: 15_000_000, filed: '2024-10-01', accn: 'A001' }] }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2024-09-30', outstanding: 15_000_000 });
  });

  it('falls back to us-gaap CommonStockSharesOutstanding when dei is empty', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({ deiShares: [], gaapOutstanding: [{ end: '2024-09-30', val: 9_000_000, filed: '2024-10-01', accn: 'B001' }] }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2024-09-30', outstanding: 9_000_000 });
  });

  it('falls back to CommonStockSharesIssued when dei and Outstanding are empty', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'GLND', cik: '0001234567', name: 'Galena', exchange: 'Nasdaq' });
    mockFetch(makeFacts({ deiShares: [], gaapOutstanding: [], gaapIssued: [{ end: '2024-06-30', val: 4_000_000, filed: '2024-07-15', accn: 'C001' }] }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('GLND');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2024-06-30', outstanding: 4_000_000 });
  });

  it('prefers framed entry over unframed for the same end date', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({
      deiShares: [
        { end: '2025-09-30', val: 10_000_000, filed: '2025-10-01', accn: 'D001' },
        { end: '2025-09-30', val: 11_000_000, filed: '2025-10-05', accn: 'D002', frame: 'CY2025Q3I' },
      ],
    }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.results[0]).toMatchObject({ date: '2025-09-30', outstanding: 11_000_000 });
  });

  it('picks entry with later filed date when no frame is present', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({
      deiShares: [
        { end: '2025-03-31', val: 5_000_000, filed: '2025-04-01', accn: 'E001' },
        { end: '2025-03-31', val: 5_100_000, filed: '2025-04-15', accn: 'E002' },
      ],
    }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.results[0]).toMatchObject({ date: '2025-03-31', outstanding: 5_100_000 });
  });

  it('limits results to 20 by default', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    const shares = Array.from({ length: 30 }, (_, i) => ({
      end: `202${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-28`,
      val: 1_000_000 + i,
      filed: `202${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-30`,
      accn: `F${String(i).padStart(3, '0')}`,
    }));
    mockFetch(makeFacts({ deiShares: shares }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.results.length).toBe(20);
  });

  it('returns results sorted newest-first', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'AAPL', cik: '0000320193', name: 'Apple', exchange: 'Nasdaq' });
    mockFetch(makeFacts({
      deiShares: [
        { end: '2023-12-31', val: 1_000_000, filed: '2024-01-15', accn: 'G001' },
        { end: '2024-12-31', val: 2_000_000, filed: '2025-01-15', accn: 'G002' },
        { end: '2024-06-30', val: 1_500_000, filed: '2024-07-15', accn: 'G003' },
      ],
    }));
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('AAPL');
    expect(result.results[0].date).toBe('2024-12-31');
    expect(result.results[1].date).toBe('2024-06-30');
    expect(result.results[2].date).toBe('2023-12-31');
  });

  it('returns success-empty and warns when CIK is not found', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('ZZZZZ');
    expect(result).toMatchObject({ status: 'success', count: 0, results: [] });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sec-companyfacts] no CIK for ticker ZZZZZ'));
  });

  it('returns success-empty and warns on SEC 404', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'FAKE', cik: '0000000001', name: 'Fake Co', exchange: null });
    mockFetchError(404);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('FAKE');
    expect(result).toMatchObject({ status: 'success', count: 0, results: [] });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sec-companyfacts] no companyfacts for CIK 0000000001'));
  });

  it('serves stale cache and warns when SEC fails and stale row exists', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'STALE', cik: '0000000002', name: 'Stale Co', exchange: null });
    const stalePayload = makeFacts({ deiShares: [{ end: '2024-01-01', val: 7_000_000, filed: '2024-01-10', accn: 'H001' }] });
    getDbMock.mockReturnValue(
      dbWithRow({ cik: '0000000002', fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), payload: stalePayload }),
    );
    mockFetchError(500);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('STALE');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2024-01-01', outstanding: 7_000_000 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[sec-companyfacts] SEC failed, serving stale cache for STALE'));
  });

  it('returns cached data without calling fetch when cache is fresh', async () => {
    const { getCikForTicker } = await import('@/lib/sec/cik-map');
    vi.mocked(getCikForTicker).mockResolvedValue({ ticker: 'WARM', cik: '0000000003', name: 'Warm Co', exchange: null });
    const freshPayload = makeFacts({ deiShares: [{ end: '2025-03-31', val: 8_000_000, filed: '2025-04-01', accn: 'I001' }] });
    getDbMock.mockReturnValue(
      dbWithRow({ cik: '0000000003', fetchedAt: new Date(Date.now() - 60 * 60 * 1000), payload: freshPayload }),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const mod = await import('@/lib/sec/companyfacts');
    const result = await mod.getHistoricalOutstanding('WARM');
    expect(result.status).toBe('success');
    expect(result.results[0]).toMatchObject({ date: '2025-03-31', outstanding: 8_000_000 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
