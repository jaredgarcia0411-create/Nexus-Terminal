import { DEFAULT_SHEET_COLUMNS, type SheetColumn, type SheetColumnType } from '@/lib/sheets/columns';
import { nextColumnKey } from '@/lib/sheets/grid';

export type ImportColumnDraft = {
  header: string;
  key: string;
  name: string;
  type: SheetColumnType;
  options?: string[];
  // Raw textarea text while editing select options. Kept separate from `options`
  // so trailing spaces / newlines survive keystrokes (parsing them away mid-type
  // makes the space/Enter keys look broken). `options` stays the parsed payload value.
  optionsText?: string;
  drop: boolean;
  lockedKey?: string;
};

export function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/\s+/g, ' ');
}

export const HEADER_TYPE_OVERRIDES: Record<string, SheetColumnType> = {
  float: 'float',
  '$ vol': 'dollar_volume',
  '$vol': 'dollar_volume',
  'dollar vol': 'dollar_volume',
  'dollar volume': 'dollar_volume',
  'share vol': 'share_volume',
  'share volume': 'share_volume',
};

export const LOCKED_TARGETS: Record<string, string> = {
  date: 'date',
  ticker: 'ticker',
};

export const DROP_HEADERS = new Set(['reports', 'charts', 'sim trade', 'r']);

export function coerceImportNumber(raw: unknown): number | null {
  const stripped = String(raw ?? '').replace(/[$,\s]/g, '');
  if (!stripped) return null;
  const numeric = Number(stripped);
  return Number.isFinite(numeric) ? numeric : null;
}

function lockedColumnType(key: string): SheetColumnType {
  return DEFAULT_SHEET_COLUMNS.find((column) => column.key === key)?.type ?? 'text';
}

function inferType(samples: string[]): { type: SheetColumnType; options?: string[] } {
  if (samples.length === 0) return { type: 'text' };
  if (samples.every((sample) => /^\d{4}-\d{2}-\d{2}$/.test(sample))) return { type: 'date' };
  if (samples.every((sample) => /^(true|false)$/i.test(sample))) return { type: 'checkbox' };
  if (samples.every((sample) => coerceImportNumber(sample) != null)) return { type: 'number' };
  if (samples.every((sample) => /^https?:\/\//i.test(sample))) return { type: 'url' };

  const distinct = [...new Set(samples)];
  if (
    distinct.length <= 15
    && samples.every((sample) => sample.length <= 40)
    && distinct.length < samples.length
  ) {
    return { type: 'select', options: distinct.sort((a, b) => a.localeCompare(b)) };
  }

  return { type: 'text' };
}

export function detectImportColumns(headers: string[], dataRows: string[][]): ImportColumnDraft[] {
  const existingColumns: SheetColumn[] = [...DEFAULT_SHEET_COLUMNS];

  return headers.map((header, index) => {
    const normalized = normalizeHeader(header);
    const name = header.trim() || 'Column';

    if (DROP_HEADERS.has(normalized)) {
      return {
        header,
        key: `drop_${index + 1}`,
        name,
        type: 'text',
        drop: true,
      };
    }

    const lockedKey = LOCKED_TARGETS[normalized];
    if (lockedKey) {
      return {
        header,
        key: lockedKey,
        name,
        type: lockedColumnType(lockedKey),
        drop: false,
        lockedKey,
      };
    }

    const samples = dataRows
      .map((row) => String(row[index] ?? '').trim())
      .filter(Boolean);
    const overrideType = HEADER_TYPE_OVERRIDES[normalized];
    const inferred = overrideType ? { type: overrideType } : inferType(samples);
    const key = nextColumnKey(header, existingColumns);
    const draft: ImportColumnDraft = {
      header,
      key,
      name,
      type: inferred.type,
      drop: false,
    };
    if (inferred.options?.length) draft.options = inferred.options;

    existingColumns.push({
      key,
      name,
      type: inferred.type,
      ...(inferred.options?.length ? { options: inferred.options } : {}),
    });

    return draft;
  });
}

function coerceImportValue(type: SheetColumnType, raw: unknown): unknown {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return undefined;

  if (type === 'number' || type === 'share_volume' || type === 'dollar_volume' || type === 'float') {
    return coerceImportNumber(trimmed) ?? undefined;
  }

  if (type === 'checkbox') {
    if (/^true$/i.test(trimmed)) return true;
    if (/^false$/i.test(trimmed)) return false;
    return undefined;
  }

  return trimmed;
}

export function buildImportPayload(
  drafts: ImportColumnDraft[],
  dataRows: string[][],
): { columns: SheetColumn[]; rows: Record<string, unknown>[]; skipped: number } {
  const columns: SheetColumn[] = [
    ...DEFAULT_SHEET_COLUMNS,
    ...drafts
      .filter((draft) => !draft.drop && !draft.lockedKey)
      .map((draft) => ({
        key: draft.key,
        name: draft.name,
        type: draft.type,
        ...(draft.options?.length ? { options: draft.options } : {}),
      })),
  ];

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const dataRow of dataRows) {
    const values: Record<string, unknown> = {};

    drafts.forEach((draft, index) => {
      if (draft.drop) return;
      const value = coerceImportValue(draft.type, dataRow[index]);
      if (value === undefined) return;
      values[draft.lockedKey ?? draft.key] = value;
    });

    if (!String(values.ticker ?? '').trim()) {
      skipped += 1;
      continue;
    }

    rows.push(values);
  }

  return { columns, rows, skipped };
}
