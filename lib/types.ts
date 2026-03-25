export type Direction = 'LONG' | 'SHORT';

export interface Execution {
  id: string;
  side: 'ENTRY' | 'EXIT';
  price: number;
  qty: number;
  time: string;
  timestamp?: Date | string;
  commission: number;
  fees: number;
}

export interface Trade {
  id: string;
  date: Date;
  sortKey: string; // YYYY-MM-DD
  symbol: string;
  direction: Direction;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  grossPnl: number;
  netPnl: number;
  entryTime: string;
  exitTime: string;
  executionCount: number;
  rawExecutions: Execution[];
  // DB-compat aliases — always mirrored from netPnl/executionCount by normalizeTrade().
  // Use netPnl and executionCount in all new code.
  pnl: number;
  executions: number;
  mfe?: number;
  mae?: number;
  bestExitPnl?: number;
  exitEfficiency?: number;
  initialRisk?: number; // Initial risk in $
  commission?: number;
  fees?: number;
  tags: string[];
  notes?: string;
}

/**
 * Wire format of a trade returned by / sent to API routes.
 * Identical to Trade except `date` is an ISO string (JSON has no Date type).
 */
export type ApiTrade = {
  id: string;
  date: string;
  sortKey: string;
  symbol: string;
  direction: Direction;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  grossPnl: number;
  netPnl: number;
  entryTime: string;
  exitTime: string;
  executionCount: number;
  rawExecutions: Execution[];
  mfe?: number;
  mae?: number;
  bestExitPnl?: number;
  exitEfficiency?: number;
  pnl: number;
  executions: number;
  initialRisk?: number;
  commission?: number;
  fees?: number;
  tags: string[];
  notes?: string;
};

// Scanner types — shared between hooks/use-scanner.ts, hooks/use-market-stream.ts, and server routes
export type ScannerSortKey = 'symbol' | 'lastPrice' | 'netChange' | 'netChangePercent' | 'totalVolume';
export type ScannerSortDir = 'asc' | 'desc';

export type ScannerFilters = {
  minPrice?: number;
  maxPrice?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minVolume?: number;
  assetType?: string;
};

export type ScannerRow = {
  symbol: string;
  assetType: string;
  lastPrice: number | null;
  netChange: number | null;
  netChangePercent: number | null;
  totalVolume: number | null;
  updatedAt: string;
};
