import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sec/cik-map', () => ({
  getCikForTicker: vi.fn(),
  padCik: (cik: string | number) => String(cik).padStart(10, '0'),
  normalizeTicker: (ticker: string) => ticker.trim().toUpperCase().replace(/\./g, '-'),
}));

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(() => null),
}));

const sampleSubmissions = {
  cik: '0000320193',
  filings: {
    recent: {
      accessionNumber: ['0000320193-26-000001', '0000320193-26-000002', '0000320193-25-999999'],
      filingDate: ['2026-04-20', '2026-04-15', '2025-01-01'],    // last entry is >90 days old
      reportDate: ['2026-04-20', '2026-03-31', '2024-12-31'],
      form: ['8-K', '10-Q', '10-K'],
      items: ['5.03,9.01', '', ''],
      primaryDocument: ['doc1.htm', 'doc2.htm', 'doc3.htm'],
      primaryDocDescription: ['Item 1.01', '', 'Annual report'],
      acceptanceDateTime: ['2026-04-20T20:00:00.000Z', '2026-04-15T20:00:00.000Z', '2025-01-01T20:00:00.000Z'],
    },
    files: [
      {
        name: 'CIK0000320193-submissions-001.json',
        filingCount: 2,
        filingFrom: '2024-01-01',
        filingTo: '2024-12-31',
      },
    ],
  },
};

const sampleArchive = {
  accessionNumber: ['0000320193-24-000010', '0000320193-24-000011', '0000320193-26-000001'],
  filingDate: ['2024-12-15', '2024-06-01', '2026-04-20'],
  reportDate: ['2024-12-15', '2024-03-31', '2026-04-20'],
  form: ['S-1', 'DEF 14A', '8-K'],
  items: ['', '', '5.03,9.01'],
  primaryDocument: ['s1.htm', 'def14a.htm', 'doc1.htm'],
  primaryDocDescription: ['Registration statement', 'Proxy statement', 'Duplicate 8-K'],
  acceptanceDateTime: ['2024-12-15T20:00:00.000Z', '2024-06-01T20:00:00.000Z', '2026-04-20T20:00:00.000Z'],
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
      cik: '0000320193',
      ticker_requested: 'AAPL',
      ticker_at_ingest: 'AAPL',
      form_type: '8-K',
      filed_at: '2026-04-20',
      report_date: '2026-04-20',
      acceptance_datetime: '2026-04-20T20:00:00.000Z',
      headline: 'charter/bylaw amendment',
      primary_document: 'doc1.htm',
      primary_doc_description: 'Item 1.01',
      items: '5.03,9.01',
      archive_source: null,
    });
    expect(result.results[0].url).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/doc1.htm');
  });

  it('uses deterministic labels when description is empty', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(sampleSubmissions), { status: 200 }),
    );
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', { sinceDays: 0 });

    expect(result.results[1].headline).toBe('quarterly report');
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

  it('hydrates archive shards, dedupes by accession, and preserves archive source metadata', async () => {
    const cikMap = await import('@/lib/sec/cik-map');
    vi.mocked(cikMap.getCikForTicker).mockResolvedValue({
      ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', exchange: 'Nasdaq',
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(sampleSubmissions), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(sampleArchive), { status: 200 }));
    const { getRecentFilings } = await import('@/lib/sec/submissions');

    const result = await getRecentFilings('AAPL', {
      sinceDays: 0,
      limit: 5,
      includeArchives: true,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('success');
    expect(result.results.map((row) => row.accession_number)).toEqual([
      '0000320193-26-000001',
      '0000320193-26-000002',
      '0000320193-25-999999',
      '0000320193-24-000010',
      '0000320193-24-000011',
    ]);
    expect(result.results[3]).toMatchObject({
      form_type: 'S-1',
      filed_at: '2024-12-15',
      report_date: '2024-12-15',
      archive_source: 'CIK0000320193-submissions-001.json',
      primary_document: 's1.htm',
      primary_doc_description: 'Registration statement',
    });
  });

  it('exposes profile limits for Research filings and event extraction callers', async () => {
    const { getSecFilingPullProfileConfig } = await import('@/lib/sec/submissions');

    expect(getSecFilingPullProfileConfig('research-filings')).toEqual({
      limit: 300,
      sinceDays: 730,
      parseCandidateLimit: 0,
      metadataOnly: true,
      enrichHeadlines: true,
    });
    expect(getSecFilingPullProfileConfig('completed-offerings').limit).toBe(5000);
    expect(getSecFilingPullProfileConfig('completed-offerings').parseCandidateLimit).toBe(300);
    expect(getSecFilingPullProfileConfig('reverse-splits').parseCandidateLimit).toBe(200);
    expect(getSecFilingPullProfileConfig('symbol-changes').parseCandidateLimit).toBe(200);
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
