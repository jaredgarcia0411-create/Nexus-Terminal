'use client';

import { useCallback, useState } from 'react';
import { motion } from 'motion/react';

import ResearchGainersList from '@/components/trading/ResearchGainersList';
import ResearchTickerView from '@/components/trading/ResearchTickerView';

export default function ResearchTab() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickerInput, setTickerInput] = useState('');
  const [companyName, setCompanyName] = useState<string | null>(null);

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
        <span className="text-xs text-zinc-500">
          {selectedTicker
            ? companyName ?? `Loading ${selectedTicker}...`
            : 'Select a gainer or search a ticker'}
        </span>
      </div>

      <div className="flex gap-2">
        <div className="sticky top-0 h-[calc(100vh-120px)] w-56 shrink-0 overflow-y-auto rounded-lg border border-white/10 bg-[#121214]">
          <ResearchGainersList selectedTicker={selectedTicker} onSelectTicker={(t) => { setSelectedTicker(t); setCompanyName(null); }} />
        </div>

        <div className="h-[calc(100vh-120px)] min-w-0 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-[#121214]">
          {selectedTicker ? (
            <ResearchTickerView ticker={selectedTicker} onCompanyName={handleCompanyName} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Select a ticker from the gainers list or search above
            </div>
          )}
        </div>
      </div>
    </motion.section>
  );
}
