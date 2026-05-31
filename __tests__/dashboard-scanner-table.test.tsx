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
  postMarketPrice: number | null;
  postMarketChange: number | null;
  postMarketVolume: number | null;
  extendedHoursVolume: number;
  priorDayClose?: number | null;
  dayOneMovePercent: number;
  dayOneMark: number;
  dayOneMoveSource: 'pre-market' | 'after-hours';
};

const LEGACY_DAY1_STORAGE_KEY = 'nexus-dashboard-day1-latched';
const DAY1_STORAGE_KEY = 'nexus-dashboard-day1-latched-v2';

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
    postMarketPrice: 1.35,
    postMarketChange: 35,
    postMarketVolume: 1_000_000,
    extendedHoursVolume: 4_000_000,
    priorDayClose: 1,
    dayOneMovePercent: 40,
    dayOneMark: 1.4,
    dayOneMoveSource: 'pre-market',
    ...rest,
  };
}

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response);
}

function installFetchMock({
  gainerBatches,
}: {
  gainerBatches: TestGainer[][];
}) {
  let gainerIndex = 0;

  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith('/api/dashboard/scanner-state')) {
      const batch = gainerBatches[Math.min(gainerIndex, gainerBatches.length - 1)] ?? [];
      gainerIndex += 1;
      return jsonResponse({
        gainers: batch,
        isRealtime: true,
        fetchedAt: '2026-05-01T12:00:00.000Z',
      });
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
    expect(screen.queryByText('Potential MDR Setup')).toBeNull();
    expect(screen.queryByText('No MDR setups detected.')).toBeNull();
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

  it('ignores rows from the legacy Day 1 latch key', async () => {
    window.localStorage.setItem(LEGACY_DAY1_STORAGE_KEY, JSON.stringify({
      date: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
      rowsByTicker: {
        STALE: makeGainer({ ticker: 'STALE' }),
      },
    }));
    installFetchMock({ gainerBatches: [[]] });

    render(<DashboardScannerTable onNavigateToResearch={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('No Day 1 gainers detected.')).toBeTruthy());
    expect(screen.queryByText('STALE')).toBeNull();
  });

  it('renders Day 1 route-derived combined AH and PM volume', async () => {
    installFetchMock({
      gainerBatches: [[
        makeGainer({
          ticker: 'BDRX',
          volume: 7_700,
          preMarketVolume: 3_000_000,
          postMarketVolume: 400_000,
          extendedHoursVolume: 3_400_000,
          priorDayClose: 1.01,
          dayOneMovePercent: 42,
          dayOneMark: 1.42,
        }),
      ]],
    });

    render(<DashboardScannerTable onNavigateToResearch={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('BDRX')).toBeTruthy());
    expect(screen.getByText('Volume')).toBeTruthy();
    expect(screen.getByText('3.4M')).toBeTruthy();
    expect(screen.queryByText('7.7K')).toBeNull();
    expect(screen.getByText('$1.010')).toBeTruthy();
    expect(screen.getByText('+42.00%')).toBeTruthy();
  });
});
