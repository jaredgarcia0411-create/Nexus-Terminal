import type { Direction } from '@/lib/types';

export interface CoverOpenInput {
  id: string;
  totalQuantity: number;
  avgEntryPrice: number;
  commission: number;
  fees: number;
}

export interface CoverMatch {
  id: string;
  matchedQty: number;
  remainingQty: number;
  grossPnl: number;
  netPnl: number;
  matchedCommission: number;
  matchedFees: number;
}

export interface CoverResult {
  matches: CoverMatch[];
  flipQty: number;
}

// `opens` must be sorted oldest-first by the caller for FIFO behavior.
export function computeCover(
  positionDirection: Direction,
  coverPrice: number,
  coverQty: number,
  opens: CoverOpenInput[],
): CoverResult {
  const matches: CoverMatch[] = [];
  let remainingCover = coverQty;

  for (const open of opens) {
    if (remainingCover <= 0) break;
    const matchedQty = Math.min(remainingCover, open.totalQuantity);
    if (matchedQty <= 0) continue;

    const ratio = open.totalQuantity > 0 ? matchedQty / open.totalQuantity : 0;
    const matchedCommission = open.commission * ratio;
    const matchedFees = open.fees * ratio;
    const grossPnl = positionDirection === 'LONG'
      ? (coverPrice - open.avgEntryPrice) * matchedQty
      : (open.avgEntryPrice - coverPrice) * matchedQty;
    const netPnl = grossPnl - matchedCommission - matchedFees;

    matches.push({
      id: open.id,
      matchedQty,
      remainingQty: open.totalQuantity - matchedQty,
      grossPnl,
      netPnl,
      matchedCommission,
      matchedFees,
    });
    remainingCover -= matchedQty;
  }

  return { matches, flipQty: Math.max(0, remainingCover) };
}
