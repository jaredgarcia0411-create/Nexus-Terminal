export type SheetColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'url'
  | 'checkbox'
  | 'select'
  | 'report'
  | 'chart'
  | 'action';

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
];
