import { describe, expect, it } from 'vitest';

import { getSourcePack, sourcePacks } from '@/lib/jarvis-source-packs';

describe('jarvis source packs', () => {
  it('includes a preloaded earnings pack with multiple URLs', () => {
    const earningsPack = sourcePacks.find((pack) => pack.id === 'earnings');

    expect(earningsPack).toBeDefined();
    expect(earningsPack?.urls.length).toBe(4);
    expect(earningsPack?.urls).toEqual([
      'https://www.earningswhispers.com/calendar',
      'https://www.marketwatch.com/tools/earnings',
      'https://www.nasdaq.com/market-activity/earnings',
      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&count=40&type=8-K',
    ]);
  });

  it('resolves packs by id', () => {
    const earningsPack = getSourcePack('earnings');

    expect(earningsPack?.id).toBe('earnings');
    expect(earningsPack?.promptTemplate).toContain('earnings');
  });

  it('returns undefined for an unknown pack id', () => {
    expect(getSourcePack('not-found')).toBeUndefined();
  });
});
