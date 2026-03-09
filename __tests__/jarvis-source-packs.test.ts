import { describe, expect, it } from 'vitest';

import { getSourcePack, sourcePacks } from '@/lib/jarvis-source-packs';

describe('jarvis source packs', () => {
  it('does not include the deprecated earnings pack', () => {
    const earningsPack = sourcePacks.find((pack) => pack.id === 'earnings');
    expect(earningsPack).toBeUndefined();
  });

  it('resolves dilution pack by id', () => {
    const dilutionPack = getSourcePack('dilution-research');

    expect(dilutionPack?.id).toBe('dilution-research');
    expect(dilutionPack?.category).toBe('dilution');
    expect(dilutionPack?.icon).toBe('Search');
    expect(dilutionPack?.urls).toEqual([]);
  });

  it('returns undefined for an unknown pack id', () => {
    expect(getSourcePack('not-found')).toBeUndefined();
  });

  it('includes macro-daily pack and resolves by id', () => {
    const macroPack = getSourcePack('macro-daily');

    expect(macroPack).toBeDefined();
    expect(macroPack?.category).toBe('macro');
    expect(macroPack?.urls).toHaveLength(4);
    expect(macroPack?.urls).toEqual([
      'https://www.cnbc.com/economy/',
      'https://www.reuters.com/markets/',
      'https://www.investing.com/news/economy',
      'https://tradingeconomics.com/calendar',
    ]);
  });
});
