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

function installFetchMock(gainerBatches: TestGainer[][], eligibleMdrTickers = new Set<string>()) {
  let gainerIndex = 0;

  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);

    if (url.startsWith('/api/tradingview/gainers')) {
      const batch = gainerBatches[Math.min(gainerIndex, gainerBatches.length - 1)] ?? [];
      gainerIndex += 1;
      return jsonResponse({ gainers: batch, isRealtime: true });
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

    if (url.startsWith('/api/scanner/mdr-eligibility')) {
      const ticker = new URL(url, 'http://localhost').searchParams.get('ticker') ?? 'UNKNOWN';
      return jsonResponse({
        ticker,
        eligible: eligibleMdrTickers.has(ticker),
        hadPriorBigDay: true,
        isUp3xFromBase: true,
        isNew20dHigh: true,
        priorBase20Low: 0.2,
        priorHigh20: 0.8,
        priorClose: 0.5,
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
    installFetchMock([
      [makeGainer({ ticker: 'DAY1' })],
      [],
    ]);

    render(<DashboardScannerTable onNavigateToResearch={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('DAY1')).toBeTruthy());

    await act(async () => {
      poll?.();
    });

    await waitFor(() => expect(screen.getByText('DAY1')).toBeTruthy());
    expect(screen.queryByText('No Day 1 gainers detected.')).toBeNull();
  });

  it('keeps an MDR row visible when a later gainers payload omits it', async () => {
    installFetchMock([
      [makeGainer({ ticker: 'MDRX', marketCap: 500_000_000, volume: 25_000_000 })],
      [],
    ], new Set(['MDRX']));

    render(<DashboardScannerTable onNavigateToResearch={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('MDRX')).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('No MDR setups detected.')).toBeNull());

    await act(async () => {
      poll?.();
    });

    await waitFor(() => expect(screen.getByText('MDRX')).toBeTruthy());
    expect(screen.queryByText('No MDR setups detected.')).toBeNull();
  });

  it('prunes stored rows from a different ET date', async () => {
    window.localStorage.setItem(DAY1_STORAGE_KEY, JSON.stringify({
      date: '2000-01-01',
      rowsByTicker: {
        STALE: makeGainer({ ticker: 'STALE' }),
      },
    }));
    installFetchMock([[]]);

    render(<DashboardScannerTable onNavigateToResearch={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('No Day 1 gainers detected.')).toBeTruthy());
    expect(screen.queryByText('STALE')).toBeNull();
  });
});
