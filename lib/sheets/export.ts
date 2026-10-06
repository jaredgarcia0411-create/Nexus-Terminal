import Papa from 'papaparse';

import type { SheetColumn, SheetColumnType } from '@/lib/sheets/columns';
import type { GridRow } from '@/lib/sheets/grid';

// Button-only columns render an icon in the grid but hold no data worth
// exporting, so they're left out of the CSV.
const SKIPPED_EXPORT_TYPES: SheetColumnType[] = ['report', 'chart', 'action', 'watchlist'];

// Builds the CSV text for a sheet export. Numbers stay raw (not "1.2M") so
// math works after the file lands in Google Sheets. R comes from the
// client-computed rResults map because it isn't stored on the row.
export function buildSheetCsv(
  columns: SheetColumn[],
  rows: GridRow[],
  rResults: Record<string, number | null>,
): string {
  const exportColumns = columns.filter((column) => !SKIPPED_EXPORT_TYPES.includes(column.type));

  const header = exportColumns.map((column) => column.name);
  const body = rows.map((row) =>
    exportColumns.map((column) => {
      const value = row[column.key];

      if (column.type === 'rmultiple') {
        const r = rResults[row.__id];
        return r != null && Number.isFinite(r) ? Number(r.toFixed(2)) : '';
      }
      if (column.type === 'checkbox') return value ? 'TRUE' : 'FALSE';
      if (column.type === 'multiselect') {
        return Array.isArray(value) ? value.join(', ') : String(value ?? '');
      }
      return value == null ? '' : String(value);
    }),
  );

  // Papa.unparse handles quoting for cells that contain commas, quotes, or newlines.
  return Papa.unparse([header, ...body]);
}
