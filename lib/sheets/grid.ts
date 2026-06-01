import type { SheetColumn, SheetColumnType } from '@/lib/sheets/columns';

export type SheetRole = 'owner' | 'editor' | 'viewer';

export type GridRow = { __id: string; __version: number } & Record<string, unknown>;

export type SheetRowRecord = {
  id: string;
  position: number;
  values: Record<string, unknown>;
  version: number;
};

export function gridRowsFromSheet(rows: SheetRowRecord[]): GridRow[] {
  return rows.map((row) => ({ __id: row.id, __version: row.version, ...row.values }));
}

export function valuesFromGridRow(gridRow: GridRow, columns: SheetColumn[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of columns) {
    if (gridRow[column.key] !== undefined) values[column.key] = gridRow[column.key];
  }
  return values;
}

export const USER_COLUMN_TYPES: SheetColumnType[] = ['text', 'number', 'date', 'url', 'checkbox', 'select'];

export const TEXT_EDIT_TYPES: SheetColumnType[] = ['text', 'number', 'date', 'url'];

export function slugifyColumnKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function nextColumnKey(name: string, existing: SheetColumn[]): string {
  const base = slugifyColumnKey(name) || 'column';
  const taken = new Set(existing.map((column) => column.key));
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}
