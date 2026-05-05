// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardScannerTable from '@/components/trading/DashboardScannerTable';

type TestGainer = {
  ticker: string;
  price: number;
  change: number;
  volume: number;
  avgVolume90d: number | null;
  marketCap: number | null;
  sector: string | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketVolume: number | null;
};

const DAY1_STORAGE_KEY = 'nexus-dashboard-day1-latched';
const MDR_STORAGE_KEY = 'nexus-dashboard-mdr-latched';

function makeGainer(overrides: Partial<TestGainer> & { ticker: string }): TestGainer {
  const { ticker, ...rest } = overrides;
  return {
    ticker,
    price: 1,
    change: 25,
    volume: 15_000_000,
    avgVolume90d: null,
    marketCap: 100_000_000,
    sector: null,
    preMarketPrice: 1.4,
    preMarketChange: 40,
    preMarketVolume: 3_000_000,
    ...rest,
  };
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response);
}

type TestMdrRecentRow = {
  ticker: string;
  triggerDate: string;
  triggerClose: number;
  mark: number | null;
  pdc: number | null;
  change: number | null;
  volume: number | null;
};

function installFetchMock({
  gainerBatches,
  mdrLiveBatches = [[]],
  mdrRecentRows = [],
}: {
  gainerBatches: TestGainer[][];
  mdrLiveBatches?: TestGainer[][];
  mdrRecentRows?: TestMdrRecentRow[];
}) {
  let gainerIndex = 0;
  let mdrLiveIndex = 0;

  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith('/api/tradingview/gainers')) {
      const batch = gainerBatches[Math.min(gainerIndex, gainerBatches.length - 1)] ?? [];
      gainerIndex += 1;
      return jsonResponse({ gainers: batch, isRealtime: true });
    }

    if (url.startsWith('/api/tradingview/mdr-candidates')) {
      const batch = mdrLiveBatches[Math.min(mdrLiveIndex, mdrLiveBatches.length - 1)] ?? [];
      mdrLiveIndex += 1;
      return jsonResponse({ candidates: batch, isRealtime: true });
    }

    if (url.startsWith('/api/scanner/mdr-recent')) {
      return jsonResponse({ rows: mdrRecentRows, fetchedAt: '2026-05-01T12:00:00.000Z' });
    }

    if (url.startsWith('/api/askedgar/scanner-summary')) {
      const ticker = new URL(url, 'http://localhost').searchParams.get('ticker') ?? 'UNKNOWN';
      return jsonResponse({
        ticker,
        cashRemainingMonths: null,
        hasAtm: false,
        hasEl: false,
        hasWarrants: false,
        hasS1: false,
        fetchedAt: '2026-05-01T12:00:00.000Z',
      });
    }

    return jsonResponse({});
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('DashboardScannerTable', () => {
  let poll: (() => void) | null;

  beforeEach(() => {
    poll = null;
    vi.spyOn(globalThis, 'setInterval').mockImplementation((callback: TimerHandler) => {
      poll = typeof callback === 'function' ? () => callback() : null;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps a Day 1 row visible when a later gainers payload omits it', async () => {
    installFetchMock({
      gainerBatches: [
        [makeGainer({ ticker: 'DAY1' })],
        [],
      ],
    });

    render(<DashboardScannerTable onNavigateToResearch={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('DAY1')).toBeTruthy());

    await act(async () => {
      poll?.();
    });

    await waitFor(() => expect(screen.getByText('DAY1')).toBeTruthy());
    expect(screen.queryByText('No Day 1 gainers detected.')).toBeNull();
  });

  it('renders merged MDR live and recent rows without using the old eligibility latch', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');
    const fetchMock = installFetchMock({
      gainerBatches: [[]],
      mdrLiveBatches: [[
        makeGainer({
          ticker: 'LIVE',
          price: 2,
          change: 100,
          marketCap: 500_000_000,
          preMarketPrice: null,
        }),
      ]],
      mdrRecentRows: [
        {
          ticker: 'RECENT',
          triggerDate: '2026-05-01',
          triggerClose: 1,
          mark: 1.5,
          pdc: 1,
          change: 50,
          volume: 12_000_000,
        },
        {
          ticker: 'LIVE',
          triggerDate: '2026-05-01',
          triggerClose: 1,
          mark: 10,
          pdc: 1,
          change: 900,
          volume: 20_000_000,
        },
      ],
    });

    render(<DashboardScannerTable onNavigateToResearch={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText('LIVE').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('RECENT')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('No MDR setups detected.')).toBeNull());

    expect(screen.getByText('+100.00%')).toBeTruthy();
    expect(screen.getByText('+50.00%')).toBeTruthy();
    expect(screen.queryByText('+900.00%')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/scanner/mdr-eligibility'))).toBe(false);
    expect(window.localStorage.getItem(MDR_STORAGE_KEY)).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalledWith(MDR_STORAGE_KEY, expect.any(String));
    expect(removeItemSpy).not.toHaveBeenCalledWith(MDR_STORAGE_KEY);
  });

  it('prunes stored rows from a different ET date', async () => {
    window.localStorage.setItem(DAY1_STORAGE_KEY, JSON.stringify({
      date: '2000-01-01',
      rowsByTicker: {
        STALE: makeGainer({ ticker: 'STALE' }),
      },
    }));
    installFetchMock({ gainerBatches: [[]] });

    render(<DashboardScannerTable onNavigateToResearch={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('No Day 1 gainers detected.')).toBeTruthy());
    expect(screen.queryByText('STALE')).toBeNull();
  });
});
