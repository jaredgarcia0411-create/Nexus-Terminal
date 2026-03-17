'use client';

import { motion } from 'motion/react';
import JarvisChat from '@/components/trading/JarvisChat';

export default function JarvisTab() {
  return (
    <motion.section key="jarvis" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <p className="text-sm text-zinc-400">Chat-powered trading assistant workspace.</p>

      <div className="h-[calc(100vh-240px)] min-h-[480px] rounded-xl border border-white/10 bg-[#121214] p-4">
        <JarvisChat />
      </div>
    </motion.section>
  );
}
