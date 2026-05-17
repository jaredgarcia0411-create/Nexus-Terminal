import type { SampleSetRow } from '@/lib/sample-set-csv';

function rowKey(row: SampleSetRow): string {
  return `${row.ticker.toUpperCase()}|${row.date}`;
}

/**
 * Append `incoming` to `existing` while skipping any (ticker,date) pair already
 * present in `existing` or earlier in `incoming`.
 */
export function mergeDedupedRows(
  existing: ReadonlyArray<SampleSetRow>,
  incoming: ReadonlyArray<SampleSetRow>,
): { merged: SampleSetRow[]; skippedCount: number } {
  const seen = new Set<string>(existing.map(rowKey));
  const merged: SampleSetRow[] = [...existing];
  let skippedCount = 0;

  for (const row of incoming) {
    const key = rowKey(row);
    if (seen.has(key)) {
      skippedCount += 1;
      continue;
    }

    seen.add(key);
    merged.push({ ticker: row.ticker.toUpperCase(), date: row.date });
  }

  return { merged, skippedCount };
}

export function dedupeRows(incoming: ReadonlyArray<SampleSetRow>): {
  rows: SampleSetRow[];
  skippedCount: number;
} {
  const { merged, skippedCount } = mergeDedupedRows([], incoming);
  return { rows: merged, skippedCount };
}
