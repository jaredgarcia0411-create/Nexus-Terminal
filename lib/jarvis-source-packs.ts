export interface SourcePack {
  id: string;
  name: string;
  description: string;
  icon: 'Newspaper' | 'CalendarClock' | 'Globe' | 'Search';
  category: 'macro' | 'dilution';
  urls: string[];
  promptTemplate: string;
}

export const sourcePacks: SourcePack[] = [
  {
    id: 'macro-daily',
    name: 'Macro Daily',
    description: 'Daily macro market overview across US, EU, Asia, and global.',
    icon: 'Globe',
    category: 'macro',
    urls: [
      'https://www.cnbc.com/economy/',
      'https://www.reuters.com/markets/',
      'https://www.investing.com/news/economy',
      'https://tradingeconomics.com/calendar',
    ],
    promptTemplate:
      'Provide a daily macro market summary. Break down by region (US, Europe, Asia-Pacific, Global). For each region: headline development, market sentiment, and key risks. End with overall portfolio implications.',
  },
  {
    id: 'dilution-research',
    name: 'Dilution Research',
    description: 'SEC filings, dilution risk, scam indicators, and float analysis for a single ticker.',
    icon: 'Search',
    category: 'dilution',
    urls: [],
    promptTemplate: 'Generate a comprehensive dilution research report for the specified ticker.',
  },
];

export const sourcePackRegistry = {
  packs: sourcePacks,
  getById(id: string) {
    return this.packs.find((pack) => pack.id === id);
  },
  getByCategory(category: SourcePack['category']) {
    return this.packs.filter((pack) => pack.category === category);
  },
};

export function getSourcePack(id: string) {
  return sourcePackRegistry.getById(id);
}
