'use client';

interface Props<T extends string> {
  tabs: Array<{ key: T; label: string }>;
  activeTab: T;
  onTabChange: (key: T) => void;
}

export default function ResearchSubNav<T extends string>({ tabs, activeTab, onTabChange }: Props<T>) {
  return (
    <div className="border-b border-border px-3 py-2">
      <div className="flex flex-wrap gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={`rounded-sm px-2.5 py-1 text-sm font-bold transition-colors ${
              activeTab === tab.key
                ? 'bg-card/60 text-foreground'
                : 'text-foreground hover:bg-accent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
