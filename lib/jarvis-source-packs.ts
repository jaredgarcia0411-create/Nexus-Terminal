export interface SourcePack {
  id: string;
  name: string;
  description: string;
  icon: 'Newspaper' | 'CalendarClock' | 'Globe';
  category: 'earnings' | 'macro' | 'research';
  urls: string[];
  promptTemplate: string;
}

export const sourcePacks: SourcePack[] = [
  {
    id: 'earnings',
    name: 'Earnings',
    description: 'Earnings whispers, coverage, calendar, and filings.',
    icon: 'CalendarClock',
    category: 'earnings',
    urls: [
      'https://www.earningswhispers.com/calendar',
      'https://www.marketwatch.com/tools/earnings',
      'https://www.nasdaq.com/market-activity/earnings',
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&count=40&type=8-K',
    ],
    promptTemplate:
      'Summarize the upcoming earnings calendar, highlight any surprising whispers, and call out the most relevant filings for my current tickers.',
  },
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
