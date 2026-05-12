// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(payload: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(payload),
  } as Response);
}

function reportPayload() {
  return {
    pulse: {
      generated_at: '2026-05-08T22:00:00.000Z',
      status: 'published',
      deliveryError: null,
      content: {
        tradingDate: '2026-05-08',
        marketStrength: 'strong',
        confidence: 'medium',
        tldr: ['Breadth expanded.'],
        summary: 'Market strength improved.',
        breadth: { advancers: 120, decliners: 60, unchanged: 20, advancerPct: 60, upVolumePct: 64 },
        rolling30: {
          tradingDays: 30,
          avgAdvancerPct: 54.2,
          medianAdvancerPct: 53,
          strongDays: 12,
          weakDays: 6,
          newHigh30dAvg: 18,
          newLow30dAvg: 7,
        },
        leaders: [{ ticker: 'AAA', changePct: 24, volume: 1_000_000, dollarVolume: 2_000_000, sector: 'Tech' }],
        laggards: [{ ticker: 'BBB', changePct: -12, volume: 900_000, dollarVolume: 1_000_000, sector: null }],
        sectorNotes: [],
        riskFlags: ['Late-day breadth faded.'],
        sourceIndex: [{ id: 'computed:1', label: 'Computed', source: 'computed', asOf: '2026-05-08' }],
      },
    },
  };
}

describe('MarketPulsePanel', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('fetches latest report once, renders rolling metrics, and hides absent 90-day overview', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      expect(String(input)).not.toContain('generate');
      return jsonResponse(reportPayload());
    });
    vi.stubGlobal('fetch', fetchMock);
    const { default: MarketPulsePanel } = await import('@/components/trading/MarketPulsePanel');

    render(<MarketPulsePanel />);

    await waitFor(() => expect(screen.getByText('Market strength improved.')).toBeTruthy());
    expect(screen.getByText('Rolling 30')).toBeTruthy();
    expect(screen.getByText('+54.20%')).toBeTruthy();
    expect(screen.queryByText('90-Day Overview')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the Macro Summary shell classes for empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ pulse: null })));
    const { default: MarketPulsePanel } = await import('@/components/trading/MarketPulsePanel');

    render(<MarketPulsePanel />);

    const empty = await screen.findByText('Market pulse not available yet.');
    expect(empty.className).toContain('rounded border border-white/10 bg-white/5');
  });

  it('is placed in DashboardTab with the expand dialog pattern', async () => {
    const fetchMock = vi.fn(() => jsonResponse(reportPayload()));
    vi.stubGlobal('fetch', fetchMock);
    const { default: DashboardTab } = await import('@/components/trading/DashboardTab');

    render(<DashboardTab onNavigateToResearch={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Market strength improved.')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Expand market strength'));

    await waitFor(() => expect(screen.getAllByText('Market Strength').length).toBeGreaterThanOrEqual(2));
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL]>;
    expect(calls.filter((call) => String(call[0]) === '/api/agents/market-pulse/latest')).toHaveLength(1);
  });
});
