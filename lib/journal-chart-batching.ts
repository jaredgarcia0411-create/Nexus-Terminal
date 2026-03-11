export function resolveInitialChartCount(existingCount: number | undefined, initialBatch: number): number {
  return existingCount ?? initialBatch;
}

export function resolveNextChartCount(totalTrades: number, currentCount: number, batchStep: number): number {
  return Math.min(totalTrades, currentCount + batchStep);
}

export function resolveLoadMoreCount(totalTrades: number, currentCount: number, batchStep: number): number {
  return Math.min(batchStep, Math.max(0, totalTrades - currentCount));
}
