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
