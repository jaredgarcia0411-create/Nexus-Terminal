import type { WatchlistRow } from '@/components/trading/WatchlistEditor';

// Stored inside daily-review `reportData` under a reserved key.
// Underscore prefix avoids collision with user-defined template field ids.
export const WATCHLIST_REPORT_KEY = '__watchlist';

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function nextRowId(seed: number): string {
  // Deterministic-ish id when coercing legacy data without ids. We only need
  // uniqueness within the current edit session — React keys, not DB pkeys.
  return `wl_${Date.now()}_${seed.toString(36)}`;
}

// Defensive: rows live in jsonb. Anything could be in there from older saves,
// so coerce to the strict shape WatchlistEditor expects.
export function coerceWatchlistRows(input: unknown): WatchlistRow[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const id = isString(row.id) && row.id.trim() ? row.id : nextRowId(index);
    // reportId is optional — only present on rows added via the research page button.
    // Older watchlist saves predate this field, so guard for missing/empty values.
    const reportId = isString(row.reportId) && row.reportId.trim() ? row.reportId : undefined;
    return [{
      id,
      ticker: isString(row.ticker) ? row.ticker : '',
      thesis: isString(row.thesis) ? row.thesis : '',
      grade: isString(row.grade) ? row.grade : '',
      notes: isString(row.notes) ? row.notes : '',
      ...(reportId ? { reportId } : {}),
    }];
  });
}

// For the weekly aggregate: collapse the same ticker+thesis pair across days into one row.
// Newer notes/grade win; if newer fields are empty, keep the older non-empty value.
export function dedupeWatchlistRows(rows: WatchlistRow[]): WatchlistRow[] {
  const byKey = new Map<string, WatchlistRow>();
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase();
    const thesis = row.thesis.trim();
    // Skip completely empty rows (typical when a user added a row and didn't fill it in).
    if (!ticker && !thesis && !row.grade && !row.notes.trim()) continue;
    const key = `${ticker}__${thesis.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row, ticker, thesis });
      continue;
    }
    // Prefer the newer reportId when present; fall back to the older one.
    // Either side may be missing since manual rows don't carry a reportId.
    byKey.set(key, {
      ...existing,
      ticker: existing.ticker || ticker,
      thesis: existing.thesis || thesis,
      grade: row.grade || existing.grade,
      notes: row.notes.trim() ? row.notes : existing.notes,
      reportId: row.reportId ?? existing.reportId,
      // Rows are passed in date-ascending order in the weekly aggregator, so
      // the later (newer) `row.sourceDate` overwrites the earlier one — the
      // chart and save buttons then point at the most-recent session.
      sourceDate: row.sourceDate ?? existing.sourceDate,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}
