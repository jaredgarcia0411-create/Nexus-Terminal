import { describe, expect, it } from 'vitest';

import { backtestSessionReviewSchema, backtestSessionUpsertSchema } from '@/lib/validations/backtest';
import { backtestCreateSchema } from '@/lib/validations/backtests';
import { chartDrawingsPutSchema } from '@/lib/validations/chart-drawings';
import { createStrategySchema } from '@/lib/validations/playbook';
import { sampleSetCreateSchema, sampleSetPatchSchema } from '@/lib/validations/sample-sets';
import { rowCreateSchema, rowPatchSchema } from '@/lib/validations/sheets';

// PostgreSQL text/jsonb columns have no inherent limit, so every
// user-controlled string and collection must carry an explicit bound.
describe('validation bounds on user-controlled input', () => {
  it('rejects oversized sample set tickers and row lists', () => {
    expect(sampleSetCreateSchema.safeParse({ name: 'Gappers', rows: [{ ticker: 'A'.repeat(21), date: '2026-05-01' }] }).success).toBe(false);
    expect(sampleSetCreateSchema.safeParse({ name: 'Gappers', rows: [{ ticker: 'AAPL', date: '2026-05-01' }] }).success).toBe(true);

    const tooManyRows = Array.from({ length: 5001 }, (_, index) => ({ ticker: `T${index}`, date: '2026-05-01' }));
    expect(sampleSetPatchSchema.safeParse({ appendRows: tooManyRows }).success).toBe(false);
  });

  it('rejects oversized backtest ids, labels and notes', () => {
    expect(backtestSessionUpsertSchema.safeParse({
      ticker: 'AAPL', date: '2026-05-01', riskDollars: 100, sheetRowId: 'x'.repeat(129),
    }).success).toBe(false);
    expect(backtestSessionReviewSchema.safeParse({ sessionId: 's1', notes: 'n'.repeat(10001) }).success).toBe(false);
    expect(backtestSessionReviewSchema.safeParse({ sessionId: 's1', label: 'ok', notes: 'fine' }).success).toBe(true);
    expect(backtestCreateSchema.safeParse({ name: 'BT', description: 'd'.repeat(2001) }).success).toBe(false);
  });

  it('bounds playbook sections and chart drawings', () => {
    expect(createStrategySchema.safeParse({ name: 'S', sections: { overview: 'x'.repeat(50001) } }).success).toBe(false);
    expect(createStrategySchema.safeParse({ name: 'S', sections: { overview: 'short' } }).success).toBe(true);

    const tooManyDrawings = Array.from({ length: 2001 }, () => ({ type: 'line' }));
    expect(chartDrawingsPutSchema.safeParse({ drawings: tooManyDrawings, indicators: {} }).success).toBe(false);
    expect(chartDrawingsPutSchema.safeParse({ drawings: [], indicators: { primary: ['VWAP'] } }).success).toBe(true);
  });

  it('bounds the serialized size of a sheet row', () => {
    expect(rowCreateSchema.safeParse({ values: { notes: 'x'.repeat(60_000) } }).success).toBe(false);
    expect(rowPatchSchema.safeParse({ values: { ticker: 'AAPL', notes: 'fine' }, version: 0 }).success).toBe(true);
    expect(rowPatchSchema.safeParse({ values: { ['k'.repeat(41)]: 'v' }, version: 0 }).success).toBe(false);
  });
});
