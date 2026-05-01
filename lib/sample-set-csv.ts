export type SampleSetRow = {
  ticker: string;
  date: string;
};

export type ParseSampleSetCsvResult = {
  rows: SampleSetRow[];
  skippedCount: number;
};

export function parseSampleSetCsv(text: string): ParseSampleSetCsvResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return { rows: [], skippedCount: 0 };

  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
  const tickerIdx = header.indexOf('ticker');
  const dateIdx = header.indexOf('date');

  if (tickerIdx < 0 || dateIdx < 0) {
    throw new Error('CSV must include "ticker" and "date" columns');
  }

  const rows: SampleSetRow[] = [];
  let skippedCount = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(',').map((cell) => cell.trim());
    const ticker = (cols[tickerIdx] ?? '').toUpperCase();
    const date = cols[dateIdx] ?? '';

    if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skippedCount += 1;
      continue;
    }

    rows.push({ ticker, date });
  }

  return { rows, skippedCount };
}
