import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyWatchlistTagsForDate } from '@/lib/watchlist-server';
import { tags as tagsTable, tradeTags as tradeTagsTable } from '@/lib/db/schema';
import { WATCHLIST_REPORT_KEY } from '@/lib/watchlist';
import type { PoolDb } from '@/lib/db';

function makeDb(selectResults: unknown[][]) {
  const selectQueue = [...selectResults];
  const tagValuesMock = vi.fn(() => ({
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  }));
  const tradeTagValuesMock = vi.fn(() => ({
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  }));

  const db = {
    select: vi.fn(() => {
      const result = selectQueue.shift() ?? [];
      const whereResult = {
        limit: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => whereResult),
        })),
      };
    }),
    insert: vi.fn((table: unknown) => {
      if (table === tagsTable) return { values: tagValuesMock };
      if (table === tradeTagsTable) return { values: tradeTagValuesMock };
      throw new Error('Unexpected insert table');
    }),
    _mocks: {
      tagValuesMock,
      tradeTagValuesMock,
    },
  };

  return db;
}

describe('applyWatchlistTagsForDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts watchlist tags for matching same-day trades', async () => {
    const db = makeDb([
      [{ reportData: { [WATCHLIST_REPORT_KEY]: [{ id: 'row-1', ticker: 'AAPL', tags: ['gap'], grade: '', notes: '' }] } }],
      [{ id: 'trade-1', symbol: 'aapl' }],
    ]);

    await applyWatchlistTagsForDate(db as unknown as PoolDb, 'user-1', '2026-06-02');

    expect(db._mocks.tagValuesMock).toHaveBeenCalledWith({ userId: 'user-1', name: 'gap' });
    expect(db._mocks.tradeTagValuesMock).toHaveBeenCalledWith({
      userId: 'user-1',
      tradeId: 'trade-1',
      tag: 'gap',
    });
  });

  it('does nothing when there is no daily review', async () => {
    const db = makeDb([[]]);

    await applyWatchlistTagsForDate(db as unknown as PoolDb, 'user-1', '2026-06-02');

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('does nothing when no trade symbols match the watchlist', async () => {
    const db = makeDb([
      [{ reportData: { [WATCHLIST_REPORT_KEY]: [{ id: 'row-1', ticker: 'AAPL', tags: ['gap'], grade: '', notes: '' }] } }],
      [{ id: 'trade-1', symbol: 'MSFT' }],
    ]);

    await applyWatchlistTagsForDate(db as unknown as PoolDb, 'user-1', '2026-06-02');

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('uses conflict-safe inserts for already-present tags', async () => {
    const db = makeDb([
      [{ reportData: { [WATCHLIST_REPORT_KEY]: [{ id: 'row-1', ticker: 'AAPL', tags: ['gap'], grade: '', notes: '' }] } }],
      [{ id: 'trade-1', symbol: 'AAPL' }],
    ]);

    await expect(applyWatchlistTagsForDate(db as unknown as PoolDb, 'user-1', '2026-06-02')).resolves.toBeUndefined();
    expect(db._mocks.tagValuesMock).toHaveBeenCalledTimes(1);
    expect(db._mocks.tradeTagValuesMock).toHaveBeenCalledTimes(1);
  });
});
