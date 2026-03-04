import { describe, expect, it } from 'vitest';
import { dasTraderParser } from '@/lib/parsers/das-trader';
import { processCsvData } from '@/lib/csv-parser';

describe('dasTraderParser', () => {
  it('detects DAS headers including trailing empty header key', () => {
    const headers = ['Time', 'Symbol', 'Qty', 'Price', 'Side', 'Route', 'Account', 'Type', ''];
    expect(dasTraderParser.detect(headers, [])).toBe(true);
  });

  it('does not detect non-DAS headers', () => {
    const headers = ['Time', 'Symbol', 'Qty', 'Price', 'Side'];
    expect(dasTraderParser.detect(headers, [])).toBe(false);
  });

  it('builds row-level side context using time-ordered position state', () => {
    const ctx = dasTraderParser.buildContext?.([
      { Time: '10:15:00', Symbol: 'AAPL', Side: 'S', Qty: '50', Price: '202' },
      { Time: '10:00:00', Symbol: 'AAPL', Side: 'B', Qty: '50', Price: '200' },
      { Time: '09:45:00', Symbol: 'AAPL', Side: 'B', Qty: '100', Price: '198' },
      { Time: '09:30:00', Symbol: 'AAPL', Side: 'SS', Qty: '100', Price: '201' },
    ]) as { resolvedSideByRow: Record<number, 'SS' | 'S' | 'B' | 'MARGIN'>; warnings: string[] };

    expect(ctx.resolvedSideByRow[3]).toBe('SS');
    expect(ctx.resolvedSideByRow[2]).toBe('B');
    expect(ctx.resolvedSideByRow[1]).toBe('MARGIN');
    expect(ctx.resolvedSideByRow[0]).toBe('S');
    expect(ctx.warnings).toHaveLength(0);
  });

  it('maps SS to short entry', () => {
    const result = dasTraderParser.normalizeRow(
      { Symbol: 'USEG', Side: 'SS', Qty: '100', Price: '1.50', Time: '09:30:00' },
      0,
      { resolvedSideByRow: { 0: 'SS' }, warnings: [] },
    );

    expect(result?.side).toBe('SS');
  });

  it('maps S to long exit', () => {
    const result = dasTraderParser.normalizeRow(
      { Symbol: 'AAPL', Side: 'S', Qty: '100', Price: '200', Time: '10:00:00' },
      0,
      { resolvedSideByRow: { 0: 'S' }, warnings: [] },
    );

    expect(result?.side).toBe('S');
  });

  it('maps B to short cover when context resolves to cover', () => {
    const result = dasTraderParser.normalizeRow(
      { Symbol: 'USEG', Side: 'B', Qty: '100', Price: '1.30', Time: '10:00:00' },
      0,
      { resolvedSideByRow: { 0: 'B' }, warnings: [] },
    );

    expect(result?.side).toBe('B');
  });

  it('maps B to long entry when context resolves to long entry', () => {
    const result = dasTraderParser.normalizeRow(
      { Symbol: 'AAPL', Side: 'B', Qty: '100', Price: '200', Time: '09:30:00' },
      0,
      { resolvedSideByRow: { 0: 'MARGIN' }, warnings: [] },
    );

    expect(result?.side).toBe('MARGIN');
  });

  it('ignores Type values and uses Side for mapping', () => {
    const result = dasTraderParser.normalizeRow(
      { Symbol: 'AAPL', Side: 'S', Type: 'Short', Qty: '100', Price: '200', Time: '11:00:00' },
      0,
      { resolvedSideByRow: { 0: 'S' }, warnings: [] },
    );

    expect(result?.side).toBe('S');
  });

  it('returns null for invalid row data', () => {
    const result = dasTraderParser.normalizeRow(
      { Symbol: 'AAPL', Side: 'B', Qty: '0', Price: '0', Time: '11:00:00' },
      0,
      { resolvedSideByRow: {}, warnings: [] },
    );

    expect(result).toBeNull();
  });

  it('integrates with processCsvData to produce SHORT trade with execution details', () => {
    const rows = [
      { Time: '15:22:31', Symbol: 'USEG', Qty: '2380', Price: '1.2', Side: 'B', Route: 'INET', Account: '2LD16758', Type: 'Margin' },
      { Time: '09:30:00', Symbol: 'USEG', Qty: '2380', Price: '1.5', Side: 'SS', Route: 'INET', Account: '2LD16758', Type: 'Short' },
    ];

    const result = processCsvData(rows, { date: new Date('2026-03-02'), sortKey: '2026-03-02' }, dasTraderParser);
    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].direction).toBe('SHORT');
    expect(result.trades[0].executionCount).toBe(1);
    expect(result.trades[0].rawExecutions.length).toBeGreaterThan(0);
    expect(result.trades[0].netPnl).toBeCloseTo((1.5 - 1.2) * 2380);
  });

  it('handles mixed short and long sequences for same symbol in reverse chronological CSV order', () => {
    const rows = [
      { Time: '10:15:00', Symbol: 'AAPL', Qty: '50', Price: '202', Side: 'S', Route: 'INET', Account: 'X', Type: 'Margin' },
      { Time: '10:00:00', Symbol: 'AAPL', Qty: '50', Price: '200', Side: 'B', Route: 'INET', Account: 'X', Type: 'Margin' },
      { Time: '09:45:00', Symbol: 'AAPL', Qty: '100', Price: '198', Side: 'B', Route: 'INET', Account: 'X', Type: 'Margin' },
      { Time: '09:30:00', Symbol: 'AAPL', Qty: '100', Price: '201', Side: 'SS', Route: 'INET', Account: 'X', Type: 'Short' },
    ];

    const result = processCsvData(rows, { date: new Date('2026-03-03'), sortKey: '2026-03-03' }, dasTraderParser);

    expect(result.warnings).toHaveLength(0);
    expect(result.trades).toHaveLength(2);

    const shortTrade = result.trades.find((trade) => trade.direction === 'SHORT');
    const longTrade = result.trades.find((trade) => trade.direction === 'LONG');
    expect(shortTrade?.totalQuantity).toBe(100);
    expect(shortTrade?.netPnl).toBeCloseTo((201 - 198) * 100);
    expect(longTrade?.totalQuantity).toBe(50);
    expect(longTrade?.netPnl).toBeCloseTo((202 - 200) * 50);
  });

  it('emits deterministic warning when BUY quantity exceeds open short quantity', () => {
    const rows = [
      { Time: '09:30:00', Symbol: 'TSLA', Qty: '50', Price: '300', Side: 'SS', Route: 'INET', Account: 'X', Type: 'Short' },
      { Time: '09:31:00', Symbol: 'TSLA', Qty: '100', Price: '295', Side: 'B', Route: 'INET', Account: 'X', Type: 'Margin' },
    ];

    const result = processCsvData(rows, { date: new Date('2026-03-03'), sortKey: '2026-03-03' }, dasTraderParser);

    expect(result.warnings.some((warning) => warning.includes('Ambiguous BUY for TSLA'))).toBe(true);
  });
});
