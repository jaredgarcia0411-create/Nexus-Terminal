'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';

import ResearchTickerView from '@/components/trading/ResearchTickerView';

interface ResearchTabProps {
  pendingResearchTicker: string | null;
  onClearPendingTicker: () => void;
}

export default function ResearchTab({ pendingResearchTicker, onClearPendingTicker }: ResearchTabProps) {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(() => pendingResearchTicker);
  const [tickerInput, setTickerInput] = useState('');
  const [companyName, setCompanyName] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingResearchTicker) return;

    let isCurrent = true;
    queueMicrotask(() => {
      if (!isCurrent) return;
      setSelectedTicker(pendingResearchTicker);
      setCompanyName(null);
      onClearPendingTicker();
    });

    return () => {
      isCurrent = false;
    };
  }, [pendingResearchTicker, onClearPendingTicker]);

  const handleCompanyName = useCallback((name: string | null) => {
    setCompanyName(name);
  }, []);

  const handleTickerSubmit = () => {
    const ticker = tickerInput.trim().toUpperCase();
    if (ticker) {
      setSelectedTicker(ticker);
      setCompanyName(null);
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
        <input
          value={tickerInput}
          onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleTickerSubmit();
          }}
          placeholder="Search ticker..."
          className="w-48 rounded-lg border border-white/10 bg-[#121214] px-3 py-1.5 text-sm text-zinc-200 transition-colors focus:border-emerald-500/50 focus:outline-none"
        />
        <span className="text-sm text-zinc-200">
          {selectedTicker
            ? companyName === null
              ? `Loading ${selectedTicker}...`
              : companyName || selectedTicker
            : 'Search a ticker above'}
        </span>
      </div>

      <div className="h-[calc(100vh-120px)] overflow-y-auto rounded-lg border border-white/10 bg-[#121214]">
        {selectedTicker ? (
          <ResearchTickerView ticker={selectedTicker} onCompanyName={handleCompanyName} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Search a ticker above or click a row in the Scanner
          </div>
        )}
      </div>
    </motion.section>
  );
}
