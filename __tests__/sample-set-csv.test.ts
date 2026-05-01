import { describe, expect, it } from 'vitest';

import { parseSampleSetCsv } from '@/lib/sample-set-csv';

describe('parseSampleSetCsv', () => {
  it('parses valid rows', () => {
    const csv = 'ticker,date\nAAPL,2024-01-01\nMSFT,2024-01-02';
    const { rows, skippedCount } = parseSampleSetCsv(csv);

    expect(rows).toEqual([
      { ticker: 'AAPL', date: '2024-01-01' },
      { ticker: 'MSFT', date: '2024-01-02' },
    ]);
    expect(skippedCount).toBe(0);
  });

  it('uppercases tickers', () => {
    const { rows } = parseSampleSetCsv('ticker,date\naapl,2024-01-01');
    expect(rows[0].ticker).toBe('AAPL');
  });

  it('skips rows with invalid date format and counts them', () => {
    const csv = 'ticker,date\nAAPL,01-01-2024\nMSFT,2024-01-02';
    const { rows, skippedCount } = parseSampleSetCsv(csv);

    expect(rows).toHaveLength(1);
    expect(skippedCount).toBe(1);
  });

  it('skips rows with empty ticker', () => {
    const csv = 'ticker,date\n,2024-01-01\nMSFT,2024-01-02';
    const { skippedCount } = parseSampleSetCsv(csv);

    expect(skippedCount).toBe(1);
  });

  it('throws if ticker column missing', () => {
    expect(() => parseSampleSetCsv('symbol,date\nAAPL,2024-01-01')).toThrow('ticker');
  });

  it('handles BOM prefix', () => {
    const csv = '\uFEFFticker,date\nAAPL,2024-01-01';
    const { rows } = parseSampleSetCsv(csv);

    expect(rows).toHaveLength(1);
  });

  it('returns zero rows and zero skipped for empty input', () => {
    const { rows, skippedCount } = parseSampleSetCsv('');

    expect(rows).toHaveLength(0);
    expect(skippedCount).toBe(0);
  });
});
