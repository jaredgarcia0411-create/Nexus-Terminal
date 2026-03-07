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
  // Transitional aliases kept until all consumers migrate.
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
