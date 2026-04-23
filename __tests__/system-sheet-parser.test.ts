import { describe, expect, it } from 'vitest';
import { parseSystemSheet } from '@/lib/system-sheet-parser';

function makeCsv(
  headerOverrides: Partial<Record<number, string>>,
  dataRows: Array<Partial<Record<number, string>>>,
) {
  const totalCols = 211;
  const header = Array.from({ length: totalCols }, (_, i) => headerOverrides[i] ?? `col_${i}`);
  header[2] = 'Ticker';
  header[3] = 'Day 1 Date';
  const lines = [header.join(',')];

  for (const row of dataRows) {
    const cells = Array.from({ length: totalCols }, (_, i) => row[i] ?? '');
    lines.push(cells.map((cell) => (cell.includes(',') ? `"${cell}"` : cell)).join(','));
  }

  return lines.join('\n');
}

describe('parseSystemSheet', () => {
  it('skips rows with blank ticker silently', () => {
    const csv = makeCsv({}, [
      { 2: '', 3: '2026-04-23' },
      { 2: 'AUUD', 3: '2026-04-23' },
    ]);

    const { rows, warnings } = parseSystemSheet(csv);

    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe('AUUD');
    expect(warnings.filter((warning) => warning.includes('blank'))).toHaveLength(0);
  });

  it('warns and skips rows with invalid date', () => {
    const csv = makeCsv({}, [
      { 2: 'AUUD', 3: 'not-a-date' },
    ]);

    const { rows, warnings } = parseSystemSheet(csv);

    expect(rows).toHaveLength(0);
    expect(warnings.some((warning) => warning.includes('AUUD') && warning.includes('invalid'))).toBe(true);
  });

  it('warns on duplicate (ticker, date) within one upload', () => {
    const csv = makeCsv({}, [
      { 2: 'AUUD', 3: '2026-04-23' },
      { 2: 'AUUD', 3: '2026-04-23' },
    ]);

    const { rows, warnings } = parseSystemSheet(csv);

    expect(rows).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes('duplicate'))).toBe(true);
  });

  it('normalizes #DIV/0!, $, and % values', () => {
    const csv = makeCsv({}, [
      { 2: 'AUUD', 3: '2026-04-23', 12: '23.5%', 22: '$1,250', 23: '3' },
    ]);

    const { rows } = parseSystemSheet(csv);

    expect(rows[0].day1GapPct).toBe(23.5);
    expect(rows[0].tickerR).toBe(1250);
    expect(rows[0].triggerCount).toBe(3);

    const csv2 = makeCsv({}, [
      { 2: 'AUUD', 3: '2026-04-23', 12: '#DIV/0!', 22: '', 23: '#N/A' },
    ]);

    const { rows: rows2 } = parseSystemSheet(csv2);

    expect(rows2[0].day1GapPct).toBeNull();
    expect(rows2[0].tickerR).toBeNull();
    expect(rows2[0].triggerCount).toBeNull();
  });

  it('accepts ISO and US date formats', () => {
    const csv = makeCsv({}, [
      { 2: 'AUUD', 3: '2026-04-23' },
      { 2: 'SPRC', 3: '4/23/2026' },
      { 2: 'AGPU', 3: '2026-4-5' },
    ]);

    const { rows } = parseSystemSheet(csv);

    expect(rows.map((row) => row.date)).toEqual(['2026-04-23', '2026-04-23', '2026-04-05']);
  });

  it('builds attempts array and omits empty attempt slots', () => {
    const csv = makeCsv({}, [
      {
        2: 'AUUD',
        3: '2026-04-23',
        27: '$100',
        28: '9:31',
        35: 'Big Trig',
        71: '1.5',
      },
    ]);

    const { rows } = parseSystemSheet(csv);

    expect(rows[0].attempts).toHaveLength(1);
    expect(rows[0].attempts[0].attemptIndex).toBe(1);
    expect(rows[0].attempts[0].starter.riskDollars).toBe(100);
    expect(rows[0].attempts[0].starter.time).toBe('9:31');
    expect(rows[0].attempts[0].triggerType).toBe('Big Trig');
    expect(rows[0].attempts[0].exit.r).toBe(1.5);
  });

  it('preserves full row in rawJson keyed by header names', () => {
    const csv = makeCsv(
      { 5: 'Grade' },
      [{ 2: 'AUUD', 3: '2026-04-23', 5: 'A+' }],
    );

    const { rows } = parseSystemSheet(csv);

    expect(rows[0].rawJson.Grade).toBe('A+');
  });
});
