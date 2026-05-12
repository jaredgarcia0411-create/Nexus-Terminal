import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchGainersForDashboardMock,
  fetchMdrCandidatesForDashboardMock,
  fetchMdrRecentForDashboardMock,
  getDbMock,
  requireUserMock,
} = vi.hoisted(() => ({
  fetchGainersForDashboardMock: vi.fn(),
  fetchMdrCandidatesForDashboardMock: vi.fn(),
  fetchMdrRecentForDashboardMock: vi.fn(),
  getDbMock: vi.fn(),
  requireUserMock: vi.fn(),
}));

vi.mock('@/app/api/tradingview/gainers/route', () => ({
  fetchGainersForDashboard: fetchGainersForDashboardMock,
}));

vi.mock('@/app/api/tradingview/mdr-candidates/route', () => ({
  fetchMdrCandidatesForDashboard: fetchMdrCandidatesForDashboardMock,
}));

vi.mock('@/app/api/scanner/mdr-recent/route', () => ({
  fetchMdrRecentForDashboard: fetchMdrRecentForDashboardMock,
}));

vi.mock('@/lib/db', () => ({
  getDb: getDbMock,
}));

vi.mock('@/lib/server-db-utils', () => ({
  dbUnavailable: () => Response.json({ error: 'Database not configured' }, { status: 503 }),
  requireUser: requireUserMock,
}));

const dbStub = { id: 'db' };

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

const mdrLive = {
  ticker: 'LIVE',
  price: 2,
  change: 100,
  volume: 15_000_000,
  avgVolume90d: null,
  marketCap: 200_000_000,
  sector: null,
  preMarketPrice: null,
  preMarketChange: null,
  preMarketVolume: null,
  pmPriceNeeded: 2.5,
  openingGapNeededPercent: 25,
  intradayPriceNeeded: 2.5,
  basisPrice: 2.5,
  atr14: 0.2,
};

const mdrRecent = {
  ticker: 'RECENT',
  triggerDate: '2026-05-01',
  triggerClose: 1,
  mark: 1.5,
  pdc: 1,
  change: 50,
  volume: 12_000_000,
  pmPriceNeeded: 2.25,
  openingGapNeededPercent: 125,
  intradayPriceNeeded: 2.25,
  basisPrice: 2.25,
  atr14: 0.3,
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
  fetchMdrCandidatesForDashboardMock.mockResolvedValue({
    candidates: [mdrLive],
    count: 1,
    totalCount: 1,
    isRealtime: true,
    fetchedAt: '2026-05-01T12:00:00.000Z',
  });
  fetchMdrRecentForDashboardMock.mockResolvedValue({
    rows: [mdrRecent],
    fetchedAt: '2026-05-01T12:00:00.000Z',
  });
}

describe('GET /api/dashboard/scanner-state', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAuthenticatedUser();
    getDbMock.mockReturnValue(dbStub);
    mockSuccessfulHelpers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('caches the aggregate payload within the 8 second TTL', async () => {
    const GET = await loadGet();

    const first = ensureResponse(await GET());
    const second = ensureResponse(await GET());
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondPayload).toEqual(firstPayload);
    expect(fetchGainersForDashboardMock).toHaveBeenCalledTimes(1);
    expect(fetchMdrCandidatesForDashboardMock).toHaveBeenCalledTimes(1);
    expect(fetchMdrRecentForDashboardMock).toHaveBeenCalledTimes(1);
    expect(firstPayload).toEqual({
      gainers: [gainer],
      isRealtime: true,
      mdrLive: [mdrLive],
      mdrRecent: [mdrRecent],
      fetchedAt: expect.any(String),
    });
  });

  it('refreshes the aggregate payload after the TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00.000Z'));
    const GET = await loadGet();

    await GET();
    await vi.advanceTimersByTimeAsync(8_001);
    await GET();

    expect(fetchGainersForDashboardMock).toHaveBeenCalledTimes(2);
    expect(fetchMdrCandidatesForDashboardMock).toHaveBeenCalledTimes(2);
    expect(fetchMdrRecentForDashboardMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to partial payloads and caches them when one helper fails', async () => {
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
      mdrLive: [mdrLive],
      mdrRecent: [mdrRecent],
      fetchedAt: expect.any(String),
    });
    expect(secondPayload).toEqual(firstPayload);
    expect(fetchGainersForDashboardMock).toHaveBeenCalledTimes(1);
    expect(fetchMdrCandidatesForDashboardMock).toHaveBeenCalledTimes(1);
    expect(fetchMdrRecentForDashboardMock).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[dashboard:scanner-state] gainers fetch failed:',
      expect.any(Error),
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
    expect(fetchMdrCandidatesForDashboardMock).not.toHaveBeenCalled();
    expect(fetchMdrRecentForDashboardMock).not.toHaveBeenCalled();
  });
});
