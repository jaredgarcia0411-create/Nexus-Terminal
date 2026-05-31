import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchGainersForDashboardMock,
  getDbMock,
  requireUserMock,
} = vi.hoisted(() => ({
  fetchGainersForDashboardMock: vi.fn(),
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/app/api/tradingview/gainers/route', () => ({
  fetchGainersForDashboard: fetchGainersForDashboardMock,
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  requireUser: requireUserMock,
}));

interface ScannerCacheRow {
  id: string;
  cacheType: string;
  ticker: string;
  dataJson: unknown;
  fetchedAt: Date;
  expiresAt: Date;
}

function createScannerStateDb(options: {
  initialRows?: ScannerCacheRow[];
  writeError?: unknown;
} = {}) {
  const rows = [...(options.initialRows ?? [])];

  const selectLimit = vi.fn(async (limit: number) => (
    rows
      .filter((row) => row.expiresAt > new Date())
      .slice(0, limit)
      .map((row) => ({ dataJson: row.dataJson }))
  ));
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));

  let pendingInsert: ScannerCacheRow | undefined;
  const onConflictDoUpdate = vi.fn(async ({ set }: { set: Partial<ScannerCacheRow> }) => {
    if (options.writeError) {
      throw options.writeError;
    }

    if (!pendingInsert) return;

    const pending = pendingInsert;
    const nextRow = { ...pending, ...set };
    const index = rows.findIndex((row) => row.cacheType === pending.cacheType && row.ticker === pending.ticker);
    if (index >= 0) {
      rows[index] = nextRow;
      return;
    }

    rows.push(nextRow);
  });
  const insertValues = vi.fn((value: ScannerCacheRow) => {
    pendingInsert = value;
    return { onConflictDoUpdate };
  });
  const insert = vi.fn(() => ({ values: insertValues }));

  return {
    insert,
    select,
    _spies: {
      insertValues,
      onConflictDoUpdate,
      selectLimit,
    },
  };
}

const gainer = {
  ticker: 'GAIN',
  price: 1,
  change: 50,
  volume: 12_000_000,
  avgVolume90d: null,
  marketCap: 100_000_000,
  sector: null,
  preMarketPrice: 1.5,
  preMarketChange: 50,
  preMarketVolume: 2_000_000,
  postMarketPrice: null,
  postMarketChange: null,
  postMarketVolume: null,
  extendedHoursVolume: 2_000_000,
  dayOneMovePercent: 50,
  dayOneMark: 1.5,
  dayOneMoveSource: 'pre-market',
};

async function loadGet() {
  const route = await import('@/app/api/dashboard/scanner-state/route');
  return route.GET;
}

function ensureResponse(response: Response | undefined): Response {
  if (!response) throw new Error('Expected response');
  return response;
}

function mockAuthenticatedUser() {
  requireUserMock.mockResolvedValue({
    user: {
      id: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      picture: null,
    },
  });
}

function mockSuccessfulHelpers() {
  fetchGainersForDashboardMock.mockResolvedValue({
    gainers: [gainer],
    count: 1,
    totalCount: 1,
    isRealtime: true,
    fetchedAt: '2026-05-01T12:00:00.000Z',
  });
}

describe('GET /api/dashboard/scanner-state', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAuthenticatedUser();
    getDbMock.mockReturnValue(createScannerStateDb());
    mockSuccessfulHelpers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a fresh cached aggregate row without calling fan-out helpers or leaking retired fields', async () => {
    const cachedPayload = {
      gainers: [gainer],
      isRealtime: true,
      fetchedAt: '2026-05-01T12:00:00.000Z',
    };
    const retiredLiveKey = 'mdr' + 'Live';
    const retiredRecentKey = 'mdr' + 'Recent';
    const cachedRowPayload = {
      ...cachedPayload,
      [retiredLiveKey]: [{ ticker: 'OLDLIVE' }],
      [retiredRecentKey]: [{ ticker: 'OLDRECENT' }],
    };
    getDbMock.mockReturnValue(createScannerStateDb({
      initialRows: [{
        id: 'dashboard-scanner-state',
        cacheType: 'dashboard-scanner-state',
        ticker: 'GLOBAL',
        dataJson: cachedRowPayload,
        fetchedAt: new Date('2026-05-01T12:00:00.000Z'),
        expiresAt: new Date(Date.now() + 8_000),
      }],
    }));
    const GET = await loadGet();

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(cachedPayload);
    expect(fetchGainersForDashboardMock).not.toHaveBeenCalled();
  });

  it('fans out, upserts, and returns the aggregate payload on cache miss', async () => {
    const db = createScannerStateDb();
    getDbMock.mockReturnValue(db);
    const GET = await loadGet();

    const first = ensureResponse(await GET());
    const second = ensureResponse(await GET());
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstPayload).toEqual({
      gainers: [gainer],
      isRealtime: true,
      fetchedAt: expect.any(String),
    });
    expect(secondPayload).toEqual(firstPayload);
    expect(fetchGainersForDashboardMock).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._spies.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it('refreshes the aggregate payload after the DB row TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
    getDbMock.mockReturnValue(createScannerStateDb());
    const GET = await loadGet();

    await GET();
    await vi.advanceTimersByTimeAsync(8_001);
    await GET();

    expect(fetchGainersForDashboardMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to an empty payload and caches it when the gainer helper fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchGainersForDashboardMock.mockRejectedValueOnce(new Error('TradingView down'));
    const GET = await loadGet();

    const first = ensureResponse(await GET());
    const second = ensureResponse(await GET());
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstPayload).toEqual({
      gainers: [],
      isRealtime: false,
      fetchedAt: expect.any(String),
    });
    expect(secondPayload).toEqual(firstPayload);
    expect(fetchGainersForDashboardMock).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[dashboard:scanner-state] gainers fetch failed:',
      expect.any(Error),
    );
  });

  it('returns the computed payload when the cache upsert fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const writeError = new Error('write failed');
    getDbMock.mockReturnValue(createScannerStateDb({ writeError }));
    const GET = await loadGet();

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      gainers: [gainer],
      isRealtime: true,
      fetchedAt: expect.any(String),
    });
    expect(fetchGainersForDashboardMock).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[dashboard:scanner-state] cache write failed:',
      writeError,
    );
  });

  it('returns 503 without calling helpers when the database is unavailable', async () => {
    getDbMock.mockReturnValueOnce(null);
    const GET = await loadGet();

    const response = ensureResponse(await GET());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: 'Database not configured' });
    expect(fetchGainersForDashboardMock).not.toHaveBeenCalled();
  });
});
