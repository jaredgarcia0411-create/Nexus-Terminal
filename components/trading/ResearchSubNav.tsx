'use client';

interface Props<T extends string> {
  tabs: Array<{ key: T; label: string }>;
  activeTab: T;
  onTabChange: (key: T) => void;
}

export default function ResearchSubNav<T extends string>({ tabs, activeTab, onTabChange }: Props<T>) {
  return (
    <div className="border-b border-white/10 px-3 py-2">
      <div className="flex flex-wrap gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={`rounded-sm px-2.5 py-1 text-sm font-bold transition-colors ${
              activeTab === tab.key
                ? 'bg-zinc-700/60 text-zinc-100'
                : 'text-white hover:bg-white/10'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
