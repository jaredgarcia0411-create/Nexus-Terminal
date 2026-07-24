// Stored inside review `reportData` under a reserved key.
// Underscore prefix avoids collision with user-defined template field ids.
export const MISSED_SETUPS_REPORT_KEY = '__missedSetups';

export interface MissedSetupRow {
  id: string;
  ticker: string;
  tags: string[];
  grade: string;
  // Set only on the weekly aggregate so each row's chart knows its session.
  sourceDate?: string;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function newMissedSetupId(): string {
  return `ms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

// Rows live in jsonb — coerce defensively to the strict shape.
export function coerceMissedSetupRows(input: unknown): MissedSetupRow[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const id = isString(row.id) && row.id.trim() ? row.id : `${newMissedSetupId()}_${index}`;
    return [{
      id,
      ticker: isString(row.ticker) ? row.ticker : '',
      tags: normalizeTags(row.tags),
      grade: isString(row.grade) ? row.grade : '',
    }];
  });
}

// Weekly aggregate: collapse the same ticker across days into one row.
// Newer grade/tags win; keep the latest sourceDate so the chart points at the
// most-recent session. Rows are passed in date-ascending order.
export function dedupeMissedSetupRows(rows: MissedSetupRow[]): MissedSetupRow[] {
  const byKey = new Map<string, MissedSetupRow>();
  for (const row of rows) {
    const ticker = row.ticker.trim().toUpperCase();
    const tags = normalizeTags(row.tags);
    if (!ticker && tags.length === 0 && !row.grade) continue;
    const existing = byKey.get(ticker);
    if (!existing) {
      byKey.set(ticker, { ...row, ticker, tags });
      continue;
    }
    byKey.set(ticker, {
      ...existing,
      ticker: existing.ticker || ticker,
      tags: Array.from(new Set([...existing.tags, ...tags])),
      grade: row.grade || existing.grade,
      sourceDate: row.sourceDate ?? existing.sourceDate,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
}
