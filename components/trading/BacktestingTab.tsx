'use client';

import ChartsTab from '@/components/trading/ChartsTab';
import type { Trade } from '@/lib/types';

interface BacktestingTabProps {
  trades: Trade[];
}

export default function BacktestingTab({ trades }: BacktestingTabProps) {
  return <ChartsTab trades={trades} />;
}
