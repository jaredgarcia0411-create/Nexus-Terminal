export type SheetColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'url'
  | 'checkbox'
  | 'select'
  | 'multiselect'
  | 'report'
  | 'chart'
  | 'rmultiple'
  | 'action'
  | 'watchlist'
  | 'share_volume'
  | 'dollar_volume'
  | 'float';

export type SheetColumn = {
  key: string;
  name: string;
  type: SheetColumnType;
  width?: number;
  options?: string[];
  locked?: boolean;
  // Values from asTags columns are copied onto matching trades as tags.
  asTags?: boolean;
};

export const DEFAULT_SHEET_COLUMNS: SheetColumn[] = [
  { key: 'ticker', name: 'Ticker', type: 'text', locked: true },
  { key: 'date', name: 'Date', type: 'date', locked: true },
  { key: 'research_report', name: 'Report', type: 'report', locked: true },
  { key: 'chart', name: 'Chart', type: 'chart', locked: true },
  { key: 'r', name: 'R', type: 'rmultiple', locked: true },
];

const RETIRED_LOCKED_KEYS = new Set(['add_to_sample', 'add_to_watchlist']);

// Locked defaults that have since become optional. The "use values as trade
// tags" toggle (asTags) replaced the dedicated Tag column, so we no longer force
// it onto sheets. Existing sheets keep their Tag column (it may hold data) but
// we strip `locked` so it behaves like any other column and can be deleted.
const UNLOCKED_LEGACY_KEYS = new Set(['tag']);

// Ensures every locked default column is present (older sheets snapshotted their
// columns before new defaults existed). Keeps existing order, appends missing
// locked defaults in canonical order. Also re-syncs locked column names from the
// defaults — locked columns are system-owned, so a default rename should reach
// older sheets at read-time without a migration. Pure — no DB. Only allocates a
// new array when something actually changed, so unchanged input keeps its
// reference (callers/tests rely on this).
export function ensureLockedColumns(columns: SheetColumn[]): SheetColumn[] {
  let changed = false;
  const kept = columns.filter((column) => {
    if (column.locked && RETIRED_LOCKED_KEYS.has(column.key)) {
      changed = true;
      return false;
    }
    return true;
  });

  const lockedNames = new Map(
    DEFAULT_SHEET_COLUMNS.filter((column) => column.locked).map((column) => [column.key, column.name]),
  );
  const synced = kept.map((column) => {
    if (column.locked && UNLOCKED_LEGACY_KEYS.has(column.key)) {
      changed = true;
      return { ...column, locked: false };
    }
    const name = lockedNames.get(column.key);
    if (name !== undefined && name !== column.name) {
      changed = true;
      return { ...column, name };
    }
    return column;
  });

  const existingKeys = new Set(synced.map((column) => column.key));
  const missing = DEFAULT_SHEET_COLUMNS.filter((column) => column.locked && !existingKeys.has(column.key));
  if (missing.length > 0) changed = true;
  return changed ? [...synced, ...missing] : columns;
}
