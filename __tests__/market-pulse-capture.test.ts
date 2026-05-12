import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketPulseDailyBars, marketPulseDailyStats } from '@/lib/db/schema';
import { captureMarketPulseForDate, normalizeGroupedDailyBar } from '@/lib/market-pulse/capture';
import type { MarketPulseBar } from '@/lib/market-pulse/types';

const fetchGroupedDailyAggregatesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/massive-market', () => ({
  fetchGroupedDailyAggregates: fetchGroupedDailyAggregatesMock,
}));

function createFakeDb() {
  const bars = new Map<string, MarketPulseBar>();
  const statsRows: Record<string, unknown>[] = [];

  return {
    bars,
    statsRows,
    db: {
      execute: vi.fn(async () => ({
        rows: [...new Set([...bars.values()].map((row) => row.tradeDate))]
          .sort()
          .reverse()
          .slice(0, 90)
          .map((tradeDate) => ({ tradeDate })),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((rows: MarketPulseBar[] | Record<string, unknown>) => ({
          onConflictDoUpdate: vi.fn(async () => {
            if (table === marketPulseDailyBars) {
              for (const row of rows as MarketPulseBar[]) {
                bars.set(`${row.tradeDate}:${row.ticker}`, row);
              }
            }
            if (table === marketPulseDailyStats) {
              statsRows.push(rows as Record<string, unknown>);
            }
          }),
        })),
      })),
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(async () => (table === marketPulseDailyBars ? [...bars.values()] : [])),
        })),
      })),
    },
  };
}

describe('market pulse capture', () => {
  beforeEach(() => {
    fetchGroupedDailyAggregatesMock.mockReset();
  });

  it('normalizes grouped bars and drops invalid rows', () => {
    expect(normalizeGroupedDailyBar('2026-05-08', {
      ticker: ' abcd ',
      open: 1,
      high: 2,
      low: 0.9,
      close: 1.5,
      volume: 100,
      vwap: 1.2,
      timestamp: Date.parse('2026-05-08T20:00:00Z'),
    })).toMatchObject({
      tradeDate: '2026-05-08',
      ticker: 'ABCD',
      dollarVolume: 150,
    });
    expect(normalizeGroupedDailyBar('2026-05-08', {
      ticker: '',
      open: 1,
      high: 2,
      low: 1,
      close: Number.NaN,
      volume: 100,
      vwap: null,
      timestamp: 0,
    })).toBeNull();
  });

  it('upserts bars idempotently and writes one stats row for a trading day', async () => {
    const fake = createFakeDb();
    fetchGroupedDailyAggregatesMock.mockResolvedValue([
      { ticker: 'AAA', open: 10, high: 12, low: 9, close: 11, volume: 1000, vwap: 10.5, timestamp: 1 },
      { ticker: 'BBB', open: 10, high: 11, low: 8, close: 9, volume: 500, vwap: null, timestamp: 1 },
    ]);

    const first = await captureMarketPulseForDate(fake.db as never, '2026-05-08');
    const second = await captureMarketPulseForDate(fake.db as never, '2026-05-08');

    expect(first).toMatchObject({ skipped: false, barsUpserted: 2, statsUpserted: 1 });
    expect(second).toMatchObject({ skipped: false, barsUpserted: 2, statsUpserted: 1 });
    expect(fake.bars).toHaveLength(2);
    expect(fake.statsRows).toHaveLength(2);
  });

  it('treats empty grouped results as a non-trading skip', async () => {
    const fake = createFakeDb();
    fetchGroupedDailyAggregatesMock.mockResolvedValue([]);

    const result = await captureMarketPulseForDate(fake.db as never, '2026-05-09');

    expect(result).toEqual({
      tradeDate: '2026-05-09',
      skipped: true,
      barsUpserted: 0,
      statsUpserted: 0,
      stats: null,
    });
    expect(fake.bars).toHaveLength(0);
    expect(fake.statsRows).toHaveLength(0);
  });
});
