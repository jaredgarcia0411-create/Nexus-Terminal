'use client';

import { motion } from 'motion/react';

import DashboardScannerTable from '@/components/trading/DashboardScannerTable';

interface DashboardTabProps {
  onNavigateToResearch: (ticker: string) => void;
}

export default function DashboardTab({ onNavigateToResearch }: DashboardTabProps) {
  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <DashboardScannerTable onNavigateToResearch={onNavigateToResearch} />
    </motion.div>
  );
}
