export interface NormalizedExecution {
  symbol: string;
  side: 'SS' | 'B' | 'MARGIN' | 'S';
  qty: number;
  price: number;
  time: string;
  commission: number;
  fees: number;
}

export interface BrokerParserConfig {
  id: string;
  name: string;
  /** Detect whether this parser matches the given CSV headers and/or first rows */
  detect: (headers: string[], rows: Record<string, unknown>[]) => boolean;
  /** Optionally extract a date from the filename or row data */
  extractDate?: (filename: string, rows: Record<string, unknown>[]) => { date: Date; sortKey: string } | null;
  /** Normalize a single CSV row into a standardized execution */
  normalizeRow: (row: Record<string, unknown>, rowIndex: number) => NormalizedExecution | null;
}
