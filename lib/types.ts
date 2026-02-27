export type Direction = 'LONG' | 'SHORT';

export interface Trade {
  id: string;
  date: Date;
  sortKey: string; // YYYY-MM-DD
  symbol: string;
  direction: Direction;
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  pnl: number;
  executions: number;
  initialRisk?: number; // Initial risk in $
  rMultiple?: number;
  tags: string[];
  notes?: string;
}

export interface DateRisk {
  [date: string]: number; // Risk amount in $ for a specific date
}

export interface TradeTags {
  [tradeId: string]: string[];
}

export interface JournalState {
  rawTrades: Trade[];
  dateRisks: DateRisk;
  tradeTags: TradeTags;
  savedTags: string[];
  importedFiles: string[];
}
