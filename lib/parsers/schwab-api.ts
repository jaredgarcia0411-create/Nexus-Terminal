import type { NormalizedExecution } from './types';

// Schwab transaction instruction → internal side code
const INSTRUCTION_MAP: Record<string, NormalizedExecution['side']> = {
  BUY: 'MARGIN',
  SELL: 'S',
  BUY_TO_COVER: 'B',
  SELL_SHORT: 'SS',
  BUY_TO_OPEN: 'MARGIN',
  SELL_TO_CLOSE: 'S',
};

export interface SchwabTransaction {
  activityId?: number;
  type?: string;
  subAccount?: string;
  tradeDate?: string;
  netAmount?: number;
  transactionItem?: {
    instruction?: string;
    amount?: number;
    price?: number;
    cost?: number;
    instrument?: {
      symbol?: string;
      assetType?: string;
    };
  };
  transferItems?: Array<{
    instrument?: {
      symbol?: string;
      assetType?: string;
    };
    amount?: number;
    price?: number;
    cost?: number;
  }>;
  fees?: Record<string, number>;
  description?: string;
}

export function normalizeSchwabTransaction(txn: SchwabTransaction): NormalizedExecution | null {
  const item = txn.transactionItem;
  if (!item) return null;

  const symbol = item.instrument?.symbol?.toUpperCase();
  if (!symbol) return null;

  const instruction = item.instruction?.toUpperCase().replace(/\s+/g, '_') ?? '';
  const side = INSTRUCTION_MAP[instruction];
  if (!side) return null;

  const qty = Math.abs(item.amount ?? 0);
  const price = item.price ?? 0;
  if (qty === 0 || price === 0) return null;

  // Sum all fee types
  const totalFees = txn.fees
    ? Object.values(txn.fees).reduce((sum, val) => sum + Math.abs(val ?? 0), 0)
    : 0;

  // Schwab splits commission from fees, but commission is often in fees.commission
  const commission = Math.abs(txn.fees?.commission ?? 0);
  const fees = totalFees - commission;

  const time = txn.tradeDate
    ? new Date(txn.tradeDate).toLocaleTimeString('en-US', { hour12: false })
    : '';

  return { symbol, side, qty, price, time, commission, fees };
}
