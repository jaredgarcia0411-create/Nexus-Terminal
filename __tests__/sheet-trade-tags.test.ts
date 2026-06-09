import { describe, expect, it, vi } from 'vitest';

import { buildSheetMatchesForDates } from '@/lib/sheets/trade-tags';
import type { QueryDb } from '@/lib/server-db-utils';

function makeDb(rows: unknown[]) {
  const chain = {
    innerJoin: vi.fn(() => chain),
    where: vi.fn().mockResolvedValue(rows),
  };

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => chain),
    })),
  };
}

describe('buildSheetMatchesForDates', () => {
  it('maps flagged sheet values to trade tags and report ids', async () => {
    const db = makeDb([
      {
        columns: [
          { key: 'setup', name: 'Setup', type: 'select', asTags: true },
          { key: 'catalysts', name: 'Catalysts', type: 'multiselect', asTags: true },
          { key: 'notes', name: 'Notes', type: 'text' },
        ],
        values: {
          ticker: 'aapl',
          date: '2026-06-08',
          setup: 'Gapper',
          catalysts: ['News', 'Volume'],
          notes: 'ignored',
          research_report: 'report-1',
        },
      },
      {
        columns: [{ key: 'setup', name: 'Setup', type: 'select', asTags: true }],
        values: { ticker: 'MSFT', date: '2026-06-08', setup: 'Trend' },
      },
      {
        columns: [{ key: 'setup', name: 'Setup', type: 'select', asTags: true }],
        values: { ticker: 'AAPL', date: '2026-06-09', setup: 'Wrong day' },
      },
    ]);

    const matches = await buildSheetMatchesForDates(db as unknown as QueryDb, 'user-1', ['2026-06-08']);

    expect(matches.get('AAPL|2026-06-08')).toEqual({
      tags: ['Gapper', 'News', 'Volume'],
      reportId: 'report-1',
    });
    expect(matches.get('MSFT|2026-06-08')).toEqual({ tags: ['Trend'] });
    expect(matches.has('AAPL|2026-06-09')).toBe(false);
  });
});
