'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

import ResearchTickerView from '@/components/trading/ResearchTickerView';

interface ResearchTabProps {
  pendingResearchTicker: string | null;
  onClearPendingTicker: () => void;
}

export default function ResearchTab({ pendingResearchTicker, onClearPendingTicker }: ResearchTabProps) {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(() => pendingResearchTicker);
  const [tickerInput, setTickerInput] = useState('');

  useEffect(() => {
    if (!pendingResearchTicker) return;

    let isCurrent = true;
    queueMicrotask(() => {
      if (!isCurrent) return;
      setSelectedTicker(pendingResearchTicker);
      onClearPendingTicker();
    });

    return () => {
      isCurrent = false;
    };
  }, [pendingResearchTicker, onClearPendingTicker]);

  const handleTickerSubmit = () => {
    const ticker = tickerInput.trim().toUpperCase();
    if (ticker) {
      setSelectedTicker(ticker);
      setTickerInput('');
    }
  };

  return (
    <motion.section
      key="research"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2 px-1">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            type="text"
            value={tickerInput}
            onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleTickerSubmit();
            }}
            placeholder="Search Symbol"
            className="w-48 rounded-lg border border-white/10 bg-[#121214] py-1.5 pr-3 pl-8 text-sm text-zinc-200 transition-colors focus:border-emerald-500/50 focus:outline-none"
          />
        </div>
      </div>

      {/* Height anchor only — no overflow here. ResearchTickerView owns the inner scroll, so the page
          shows one scrollbar (inside the sections), not two stacked. */}
      <div className="h-[calc(100vh-120px)]">
        {selectedTicker ? (
          <ResearchTickerView ticker={selectedTicker} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Search a Ticker or Select One From The Scanner in Dashboard
          </div>
        )}
      </div>
    </motion.section>
  );
}
