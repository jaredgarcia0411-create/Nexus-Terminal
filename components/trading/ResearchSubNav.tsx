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
            className={`grid place-items-center rounded-sm px-2.5 py-1 text-sm transition-colors ${
              activeTab === tab.key
                ? 'bg-zinc-700/60 text-zinc-100'
                : 'text-white hover:bg-white/10'
            }`}
          >
            {/* Ghost label reserves the bold-width so toggling weight doesn't shift layout.
                Both spans share grid cell (1,1); visible label sits on top. */}
            <span aria-hidden className="invisible col-start-1 row-start-1 font-bold">
              {tab.label}
            </span>
            <span className={`col-start-1 row-start-1 ${activeTab === tab.key ? '' : 'font-bold'}`}>
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
