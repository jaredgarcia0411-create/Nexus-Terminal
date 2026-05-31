import type { WatchlistRow } from '@/components/trading/WatchlistEditor';
import type { Trade } from '@/lib/types';

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

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const result: string[] = [];
  for (const value of input) {
    if (!isString(value)) continue;
    const tag = value.trim();
    if (!tag || result.includes(tag)) continue;
    result.push(tag);
  }
  return result;
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
    const tags = normalizeTags(row.tags);
    const legacyThesis = isString(row.thesis) ? row.thesis.trim() : '';
    return [{
      id,
      ticker: isString(row.ticker) ? row.ticker : '',
      tags: tags.length > 0 ? tags : legacyThesis ? [legacyThesis] : [],
      grade: isString(row.grade) ? row.grade : '',
      notes: isString(row.notes) ? row.notes : '',
      ...(reportId ? { reportId } : {}),
    }];
  });
}

// For the weekly aggregate: collapse the same ticker across days into one row.
// Newer notes/grade win; if newer fields are empty, keep the older non-empty value.
export function dedupeWatchlistRows(rows: WatchlistRow[]): WatchlistRow[] {
  const byKey = new Map<string, WatchlistRow>();
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase();
    const tags = normalizeTags(row.tags);
    // Skip completely empty rows (typical when a user added a row and didn't fill it in).
    if (!ticker && tags.length === 0 && !row.grade && !row.notes.trim()) continue;
    const key = ticker;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row, ticker, tags });
      continue;
    }
    // Prefer the newer reportId when present; fall back to the older one.
    // Either side may be missing since manual rows don't carry a reportId.
    byKey.set(key, {
      ...existing,
      ticker: existing.ticker || ticker,
      tags: Array.from(new Set([...(existing.tags ?? []), ...tags])),
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

export function buildWatchlistTradeTagAssignments(
  trades: Trade[],
  watchlistRows: WatchlistRow[],
): Array<{ tradeId: string; tags: string[] }> {
  const tagsByTicker = new Map<string, string[]>();

  for (const row of watchlistRows) {
    const ticker = row.ticker.trim().toUpperCase();
    if (!ticker) continue;

    const existing = tagsByTicker.get(ticker) ?? [];
    for (const tag of normalizeTags(row.tags)) {
      if (!existing.includes(tag)) existing.push(tag);
    }
    if (existing.length > 0) tagsByTicker.set(ticker, existing);
  }

  const assignments: Array<{ tradeId: string; tags: string[] }> = [];
  for (const trade of trades) {
    const ticker = trade.symbol.trim().toUpperCase();
    const watchlistTags = tagsByTicker.get(ticker);
    if (!watchlistTags || watchlistTags.length === 0) continue;

    const currentTags = trade.tags ?? [];
    const missingTags = watchlistTags.filter((tag) => !currentTags.includes(tag));
    if (missingTags.length > 0) {
      assignments.push({ tradeId: trade.id, tags: missingTags });
    }
  }

  return assignments;
}
