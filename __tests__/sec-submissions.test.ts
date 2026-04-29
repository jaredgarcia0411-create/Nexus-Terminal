import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sec/cik-map', () => ({
  getCikForTicker: vi.fn(),
  padCik: (cik: string | number) => String(cik).padStart(10, '0'),
  normalizeTicker: (ticker: string) => ticker.trim().toUpperCase().replace(/\./g, '-'),
}));

const sampleSubmissions = {
  cik: '0000320193',
  filings: {
    recent: {
      accessionNumber: ['0000320193-26-000001', '0000320193-26-000002', '0000320193-25-999999'],
      filingDate: ['2026-04-20', '2026-04-15', '2025-01-01'],    // last entry is >90 days old
      form: ['8-K', '10-Q', '10-K'],
      items: ['5.03,9.01'],
      primaryDocument: ['doc1.htm', 'doc2.htm', 'doc3.htm'],
      primaryDocDescription: ['Item 1.01', '', 'Annual report'],
      acceptanceDateTime: ['2026-04-20T20:00:00.000Z', '2026-04-15T20:00:00.000Z', '2025-01-01T20:00:00.000Z'],
    },
  },
};

describe('sec submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('zips column-oriented filings into row objects', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleSubmissions), { status: 200 }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', { sinceDays: 0 });

    expect(result.status).toBe('success');
    expect(result.count).toBe(3);
    expect(result.results[0]).toMatchObject({
      accession_number: '0000320193-26-000001',
      form_type: '8-K',
      filed_at: '2026-04-20',
      headline: 'Item 1.01',
      primary_doc_description: 'Item 1.01',
      items: '5.03,9.01',
    });
    expect(result.results[0].url).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/doc1.htm');
  });

  it('falls back to "${formType} filing" when description is empty', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleSubmissions), { status: 200 }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', { sinceDays: 0 });

    expect(result.results[1].headline).toBe('10-Q filing');
    expect(result.results[1].primary_doc_description).toBeNull();
    expect(result.results[1].items).toBeNull();
  });

  it('filters out filings older than sinceDays', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-27T12:00:00.000Z'));

    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleSubmissions), { status: 200 }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', { sinceDays: 90 });

    // 10-K from 2025-01-01 is excluded.
    expect(result.results.map((row) => row.form_type)).toEqual(['8-K', '10-Q']);
  });

  it('respects the limit parameter', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleSubmissions), { status: 200 }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', { sinceDays: 0, limit: 1 });

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it('returns empty success for unknown tickers', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('NOTREAL');

    expect(result).toEqual({ status: 'success', count: 0, results: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns error status on SEC HTTP failure', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL');

    expect(result.status).toBe('error');
    expect(result.count).toBe(0);
    expect(result.error).toContain('404');
  });
});
