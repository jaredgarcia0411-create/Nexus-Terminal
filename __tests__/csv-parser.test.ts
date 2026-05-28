import { describe, it, expect } from 'vitest';
import { extractRawExecutions, processCsvData, parseDateFromFilename } from '@/lib/csv-parser';
import type { BrokerParserConfig } from '@/lib/parsers/types';

describe('parseDateFromFilename', () => {
  it('parses MM-DD-YY format', () => {
    const result = parseDateFromFilename('01-15-25.csv');
    expect(result).not.toBeNull();
    expect(result!.sortKey).toBe('2025-01-15');
  });

  it('uses the last three numeric groups when filename has extra numbers', () => {
    const result = parseDateFromFilename('acct-999-12-05-24.csv');
    expect(result).not.toBeNull();
    expect(result!.sortKey).toBe('2024-12-05');
  });

  it('parses YYYY-MM-DD format', () => {
    const result = parseDateFromFilename('2025-01-15.csv');
    expect(result).not.toBeNull();
    expect(result!.sortKey).toBe('2025-01-15');
  });

  it('parses YYYY_MM_DD format', () => {
    const result = parseDateFromFilename('trades_2025_01_15.csv');
    expect(result).not.toBeNull();
    expect(result!.sortKey).toBe('2025-01-15');
  });

  it('parses DD-MM-YY format when first segment exceeds 12', () => {
    const result = parseDateFromFilename('15-01-25.csv');
    expect(result).not.toBeNull();
    expect(result!.sortKey).toBe('2025-01-15');
  });

  it('returns null for invalid calendar dates', () => {
    expect(parseDateFromFilename('02-30-24.csv')).toBeNull();
  });

  it('returns null for unparseable filenames', () => {
    expect(parseDateFromFilename('readme.txt')).toBeNull();
  });
});

describe('processCsvData — basic FIFO pairing', () => {
  it('pairs a single long round-trip into one trade', () => {
    const rows = [
      { Symbol: 'AAPL', Side: 'MARGIN', Qty: '100', Price: '150.00', Time: '09:30:00', Commission: '1.00', Fees: '0.10' },
      { Symbol: 'AAPL', Side: 'S',      Qty: '100', Price: '155.00', Time: '10:00:00', Commission: '1.00', Fees: '0.10' },
    ];

    const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };
    const result = processCsvData(rows as Record<string, string>[], dateInfo);

    expect(result.trades).toHaveLength(1);

    const trade = result.trades[0];
    expect(trade.symbol).toBe('AAPL');
    expect(trade.direction).toBe('LONG');
    expect(trade.totalQuantity).toBe(100);
    expect(trade.avgEntryPrice).toBeCloseTo(150.0);
    expect(trade.avgExitPrice).toBeCloseTo(155.0);
    expect(trade.pnl).toBeCloseTo(500.0 - 2.0 - 0.2); // (155-150)*100 - commissions - fees
    expect(result.warnings).toHaveLength(0);
  });

  it('pairs a single short round-trip into one trade', () => {
    const rows = [
      { Symbol: 'TSLA', Side: 'SS', Qty: '50', Price: '200.00', Time: '09:31:00', Commission: '0.50', Fees: '0.05' },
      { Symbol: 'TSLA', Side: 'B',  Qty: '50', Price: '195.00', Time: '09:45:00', Commission: '0.50', Fees: '0.05' },
    ];

    const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };
    const result = processCsvData(rows as unknown as Record<string, string>[], dateInfo);

    expect(result.trades).toHaveLength(1);

    const trade = result.trades[0];
    expect(trade.symbol).toBe('TSLA');
    expect(trade.direction).toBe('SHORT');
    expect(trade.totalQuantity).toBe(50);
    expect(trade.avgEntryPrice).toBeCloseTo(200.0);
    expect(trade.avgExitPrice).toBeCloseTo(195.0);
    expect(trade.pnl).toBeCloseTo(250.0 - 1.0 - 0.1); // (200-195)*50 - commissions - fees
  });

  it('returns empty trades for rows with no matching exits', () => {
    const rows = [
      { Symbol: 'NVDA', Side: 'MARGIN', Qty: '10', Price: '500.00', Time: '09:30:00', Commission: '0', Fees: '0' },
    ];

    const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };
    const result = processCsvData(rows as unknown as Record<string, string>[], dateInfo);

    expect(result.trades).toHaveLength(0);
  });

  it('normalizes column aliases, side aliases, and cost formats', () => {
    const rows = [
      {
        ' ticker ': 'msft',
        ' action ': 'buy to open',
        quantity: '10',
        ' fill price ': '100',
        ' fill time ': '09:30:01',
        Comm: '($1.25)',
        Fee: '$0.25',
      },
      {
        Sym: 'MSFT',
        Type: 'sell to close',
        Size: '10',
        Price: '101',
        Time: '09:45:01',
        Commission: '1.25',
        Fees: '0.25',
      },
    ];

    const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };
    const result = processCsvData(rows as unknown as Record<string, string>[], dateInfo);

    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      symbol: 'MSFT',
      direction: 'LONG',
      totalQuantity: 10,
      avgEntryPrice: 100,
      avgExitPrice: 101,
      commission: 2.5,
      fees: 0.5,
      executionCount: 1,
    });
    expect(result.trades[0].pnl).toBeCloseTo(7);
  });

  it('pairs partial fills across multiple symbols and directions', () => {
    const rows = [
      { Symbol: 'AAPL', Side: 'MARGIN', Qty: '100', Price: '10', Time: '09:30:00', Commission: '1', Fees: '0.20' },
      { Symbol: 'AAPL', Side: 'S', Qty: '40', Price: '12', Time: '09:35:00', Commission: '0.4', Fees: '0.08' },
      { Symbol: 'AAPL', Side: 'S', Qty: '60', Price: '11', Time: '09:40:00', Commission: '0.6', Fees: '0.12' },
      { Symbol: 'TSLA', Side: 'SS', Qty: '50', Price: '20', Time: '09:31:00', Commission: '0.5', Fees: '0.10' },
      { Symbol: 'TSLA', Side: 'BTC', Qty: '20', Price: '18', Time: '09:36:00', Commission: '0.2', Fees: '0.04' },
      { Symbol: 'TSLA', Side: 'BUY TO COVER', Qty: '30', Price: '19', Time: '09:41:00', Commission: '0.3', Fees: '0.06' },
    ];

    const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };
    const result = processCsvData(rows, dateInfo);

    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(2);

    const longTrade = result.trades.find((trade) => trade.symbol === 'AAPL');
    const shortTrade = result.trades.find((trade) => trade.symbol === 'TSLA');

    expect(longTrade).toBeDefined();
    expect(longTrade).toMatchObject({
      direction: 'LONG',
      totalQuantity: 100,
      avgEntryPrice: 10,
      avgExitPrice: 11.4,
      commission: 2,
      fees: 0.4,
      executionCount: 2,
    });
    expect(longTrade!.pnl).toBeCloseTo(137.6);

    expect(shortTrade).toBeDefined();
    expect(shortTrade).toMatchObject({
      direction: 'SHORT',
      totalQuantity: 50,
      avgEntryPrice: 20,
      avgExitPrice: 18.6,
      commission: 1,
      fees: 0.2,
      executionCount: 2,
    });
    expect(shortTrade!.pnl).toBeCloseTo(68.8);
  });

  it('produces warnings for unknown sides, zero quantities, and unmatched executions', () => {
    const rows = [
      { Symbol: 'NVDA', Side: 'HOLD', Qty: '10', Price: '500', Time: '09:30:00' },
      { Symbol: 'AMD', Side: 'MARGIN', Qty: '0', Price: '100', Time: '09:31:00' },
      { Symbol: 'QQQ', Side: 'SS', Qty: '3', Price: '500', Time: '09:32:00' },
      { Symbol: 'SPY', Side: 'B', Qty: '2', Price: '400', Time: '09:33:00' },
      { Symbol: 'ORCL', Side: 'S', Qty: '5', Price: '50', Time: '09:34:00' },
    ];

    const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };
    const result = processCsvData(rows, dateInfo);

    expect(result.trades).toHaveLength(0);
    expect(result.warnings).toEqual([
      'QQQ: 3 unmatched SHORT SELL shares (1 fill) — position may still be open short',
      'SPY: 2 unmatched BUY shares (1 fill) — position may still be open long',
      'ORCL: 5 unmatched SELL shares (1 fill) — no matching long entries (carry-over from earlier session?)',
    ]);
  });

  it('collects parser exceptions as row warnings', () => {
    const parser: BrokerParserConfig = {
      id: 'throwing-parser',
      name: 'Throwing Parser',
      detect: () => true,
      normalizeRow: (_row, rowIndex) => {
        if (rowIndex === 1) {
          throw new Error('malformed row');
        }
        return {
          symbol: 'AAPL',
          side: rowIndex === 0 ? 'MARGIN' : 'S',
          qty: 10,
          price: rowIndex === 0 ? 100 : 101,
          time: '09:30:00',
          commission: 0,
          fees: 0,
        };
      },
    };

    const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };
    const result = processCsvData([{}, {}], dateInfo, parser);

    expect(result.trades).toHaveLength(0);
    expect(result.warnings).toEqual([
      'Row 2: Parse error — malformed row',
      'AAPL: 10 unmatched BUY shares (1 fill) — position may still be open long',
    ]);
  });

  it('does not emit NaN trades when parser yields zero-quantity executions', () => {
    const parser: BrokerParserConfig = {
      id: 'zero-qty-parser',
      name: 'Zero Qty Parser',
      detect: () => true,
      normalizeRow: (_row, rowIndex) => {
        if (rowIndex === 0) {
          return {
            symbol: 'AAPL',
            side: 'MARGIN',
            qty: 0,
            price: 100,
            time: '09:30:00',
            commission: 1,
            fees: 0.1,
          };
        }
        return {
          symbol: 'AAPL',
          side: 'S',
          qty: 10,
          price: 101,
          time: '09:31:00',
          commission: 1,
          fees: 0.1,
        };
      },
    };

    const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };
    const result = processCsvData([{}, {}], dateInfo, parser);

    expect(result.trades.every((trade) => Number.isFinite(trade.avgEntryPrice) && Number.isFinite(trade.avgExitPrice))).toBe(true);
    expect(result.trades.every((trade) => trade.totalQuantity > 0)).toBe(true);
  });

  it('computes gross/net pnl fields and keeps pnl alias in sync', () => {
    const rows = [
      { Symbol: 'NFLX', Side: 'MARGIN', Qty: '10', Price: '100', Time: '09:30:00', Commission: '1', Fees: '0.25' },
      { Symbol: 'NFLX', Side: 'S', Qty: '10', Price: '103', Time: '10:00:00', Commission: '1', Fees: '0.25' },
    ];

    const result = processCsvData(rows, { date: new Date('2025-01-15'), sortKey: '2025-01-15' });
    expect(result.trades).toHaveLength(1);

    const trade = result.trades[0];
    expect(trade.grossPnl).toBeCloseTo(30);
    expect(trade.netPnl).toBeCloseTo(27.5);
    expect(trade.pnl).toBeCloseTo(trade.netPnl);
    expect(trade.entryTime).toBe('09:30:00');
    expect(trade.exitTime).toBe('10:00:00');
    expect(trade.rawExecutions).toHaveLength(2);
  });

  it('orders non-zero-padded times chronologically when deriving entry/exit times', () => {
    const rows = [
      { Symbol: 'AAPL', Side: 'S', Qty: '100', Price: '102', Time: '10:00:00', Commission: '0', Fees: '0' },
      { Symbol: 'AAPL', Side: 'MARGIN', Qty: '40', Price: '100', Time: '9:05:00', Commission: '0', Fees: '0' },
      { Symbol: 'AAPL', Side: 'MARGIN', Qty: '60', Price: '101', Time: '09:30:00', Commission: '0', Fees: '0' },
    ];

    const result = processCsvData(rows, { date: new Date('2025-01-15'), sortKey: '2025-01-15' });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryTime).toBe('9:05:00');
    expect(result.trades[0].exitTime).toBe('10:00:00');
  });

  it('consolidates duplicate fills at same side/time/price without losing totals', () => {
    const rows = [
      { Symbol: 'AMD', Side: 'MARGIN', Qty: '40', Price: '100', Time: '09:30:00', Commission: '0.4', Fees: '0.04' },
      { Symbol: 'AMD', Side: 'MARGIN', Qty: '60', Price: '100', Time: '09:30:00', Commission: '0.6', Fees: '0.06' },
      { Symbol: 'AMD', Side: 'S', Qty: '100', Price: '101', Time: '10:00:00', Commission: '1', Fees: '0.1' },
    ];

    const result = processCsvData(rows, { date: new Date('2025-01-15'), sortKey: '2025-01-15' });
    expect(result.trades).toHaveLength(1);

    const trade = result.trades[0];
    expect(trade.totalQuantity).toBe(100);
    expect(trade.executionCount).toBe(2);
    expect(trade.rawExecutions).toHaveLength(2);

    const entry = trade.rawExecutions.find((exec) => exec.side === 'ENTRY');
    const exit = trade.rawExecutions.find((exec) => exec.side === 'EXIT');
    expect(entry?.qty).toBeCloseTo(100);
    expect(exit?.qty).toBeCloseTo(100);
    expect((entry?.commission ?? 0) + (exit?.commission ?? 0)).toBeCloseTo(trade.commission || 0);
    expect((entry?.fees ?? 0) + (exit?.fees ?? 0)).toBeCloseTo(trade.fees || 0);
  });

  it('matches reverse-chronological rows using chronological FIFO order', () => {
    const rows = [
      { Symbol: 'META', Side: 'S', Qty: '100', Price: '105', Time: '10:00:00', Commission: '1', Fees: '0.1' },
      { Symbol: 'META', Side: 'MARGIN', Qty: '100', Price: '100', Time: '09:30:00', Commission: '1', Fees: '0.1' },
    ];

    const result = processCsvData(rows, { date: new Date('2025-01-15'), sortKey: '2025-01-15' });
    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);

    const trade = result.trades[0];
    expect(trade.symbol).toBe('META');
    expect(trade.direction).toBe('LONG');
    expect(trade.entryTime).toBe('09:30:00');
    expect(trade.exitTime).toBe('10:00:00');
    expect(trade.executionCount).toBe(1);
    expect(trade.rawExecutions).toHaveLength(2);
    expect(trade.netPnl).toBeCloseTo(500 - 2 - 0.2);
  });
});

describe('processCsvData — position-tracking B resolution', () => {
  const dateInfo = { date: new Date('2025-01-15'), sortKey: '2025-01-15' };

  it('treats lone B/S pair (no SS) as a long round-trip', () => {
    const rows = [
      { Symbol: 'ASTC', Side: 'B', Qty: '100', Price: '27', Time: '09:30:00', Commission: '0', Fees: '0' },
      { Symbol: 'ASTC', Side: 'S', Qty: '100', Price: '29', Time: '10:00:00', Commission: '0', Fees: '0' },
    ];

    const result = processCsvData(rows as Record<string, string>[], dateInfo);
    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].direction).toBe('LONG');
    expect(result.trades[0].pnl).toBeCloseTo(200);
  });

  it('treats SS-then-B as a short cover, not a long open', () => {
    const rows = [
      { Symbol: 'NCT', Side: 'SS', Qty: '100', Price: '5.50', Time: '08:56:00', Commission: '0', Fees: '0' },
      { Symbol: 'NCT', Side: 'B', Qty: '100', Price: '4.00', Time: '14:02:00', Commission: '0', Fees: '0' },
    ];

    const result = processCsvData(rows as Record<string, string>[], dateInfo);
    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].direction).toBe('SHORT');
    expect(result.trades[0].pnl).toBeCloseTo(150);
  });

  it('splits SS→B→B→S into one short and one long', () => {
    const rows = [
      { Symbol: 'SPRC', Side: 'SS', Qty: '100', Price: '12', Time: '09:24:00', Commission: '0', Fees: '0' },
      { Symbol: 'SPRC', Side: 'B', Qty: '100', Price: '15', Time: '09:46:00', Commission: '0', Fees: '0' },
      { Symbol: 'SPRC', Side: 'B', Qty: '50', Price: '12.50', Time: '11:46:00', Commission: '0', Fees: '0' },
      { Symbol: 'SPRC', Side: 'S', Qty: '50', Price: '10.30', Time: '12:58:00', Commission: '0', Fees: '0' },
    ];

    const result = processCsvData(rows as Record<string, string>[], dateInfo);
    expect(result.trades).toHaveLength(2);
    const short = result.trades.find((t) => t.direction === 'SHORT');
    const long = result.trades.find((t) => t.direction === 'LONG');
    expect(short?.totalQuantity).toBe(100);
    expect(short?.pnl).toBeCloseTo(-300);
    expect(long?.totalQuantity).toBe(50);
    expect(long?.pnl).toBeCloseTo(-110);
  });

  it('emits an open-position warning when B has no matching S in the same file', () => {
    const rows = [
      { Symbol: 'ARM', Side: 'B', Qty: '500', Price: '315', Time: '09:32:00', Commission: '0', Fees: '0' },
    ];

    const result = processCsvData(rows as Record<string, string>[], dateInfo);
    expect(result.trades).toHaveLength(0);
    expect(result.warnings).toContain(
      'ARM: 500 unmatched BUY shares (1 fill) — position may still be open long',
    );
  });

  it('resolves a raw B as a short cover when seeded with an open short', () => {
    const rows = [
      { Symbol: 'ARM', Side: 'B', Qty: '500', Price: '315', Time: '09:32:00', Commission: '0', Fees: '0' },
    ];

    const result = extractRawExecutions(rows as Record<string, string>[], undefined, [
      { symbol: 'ARM', direction: 'SHORT', qty: 500 },
    ]);

    expect(result.warnings).toHaveLength(0);
    expect(result.executions).toEqual([
      {
        symbol: 'ARM',
        side: 'SHORT_EXIT',
        qty: 500,
        price: 315,
        time: '09:32:00',
        commission: 0,
        fees: 0,
      },
    ]);
  });
});
