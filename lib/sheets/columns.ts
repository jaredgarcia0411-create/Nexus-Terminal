export type SheetColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'url'
  | 'checkbox'
  | 'select'
  | 'report'
  | 'chart'
  | 'action'
  | 'watchlist';

export type SheetColumn = {
  key: string;
  name: string;
  type: SheetColumnType;
  width?: number;
  options?: string[];
  locked?: boolean;
};

export const DEFAULT_SHEET_COLUMNS: SheetColumn[] = [
  { key: 'ticker', name: 'Ticker', type: 'text', locked: true },
  { key: 'date', name: 'Date', type: 'date', locked: true },
  { key: 'tag', name: 'Tag', type: 'select', options: [], locked: true },
  { key: 'research_report', name: 'Research Report', type: 'report', locked: true },
  { key: 'chart', name: 'Chart', type: 'chart', locked: true },
  { key: 'add_to_sample', name: 'Add to Sample', type: 'action', locked: true },
  { key: 'add_to_watchlist', name: 'Watch', type: 'watchlist', locked: true },
];

// Ensures every locked default column is present (older sheets snapshotted their
// columns before new defaults existed). Keeps existing order, appends missing
// locked defaults in canonical order. Pure — no DB.
export function ensureLockedColumns(columns: SheetColumn[]): SheetColumn[] {
  const existingKeys = new Set(columns.map((column) => column.key));
  const missing = DEFAULT_SHEET_COLUMNS.filter((column) => column.locked && !existingKeys.has(column.key));
  return missing.length === 0 ? columns : [...columns, ...missing];
}
