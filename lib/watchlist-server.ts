import { and, eq } from 'drizzle-orm';

import type { PoolDb } from '@/lib/db';
import { dailyReviews, tags as tagsTable, trades, tradeTags as tradeTagsTable } from '@/lib/db/schema';
import {
  buildWatchlistTradeTagAssignments,
  coerceWatchlistRows,
  WATCHLIST_REPORT_KEY,
} from '@/lib/watchlist';

export async function applyWatchlistTagsForDate(db: PoolDb, userId: string, date: string): Promise<void> {
  const [review] = await db
    .select({ reportData: dailyReviews.reportData })
    .from(dailyReviews)
    .where(and(eq(dailyReviews.userId, userId), eq(dailyReviews.date, date)))
    .limit(1);
  if (!review) return;

  const reportData = (review.reportData ?? {}) as Record<string, unknown>;
  const watchlist = coerceWatchlistRows(reportData[WATCHLIST_REPORT_KEY]);
  if (watchlist.length === 0) return;

  const rows = await db
    .select({ id: trades.id, symbol: trades.symbol })
    .from(trades)
    .where(and(eq(trades.userId, userId), eq(trades.date, date)));
  if (rows.length === 0) return;

  const assignments = buildWatchlistTradeTagAssignments(rows, watchlist);
  for (const assignment of assignments) {
    for (const name of assignment.tags) {
      await db
        .insert(tagsTable)
        .values({ userId, name })
        .onConflictDoNothing();
      await db
        .insert(tradeTagsTable)
        .values({ userId, tradeId: assignment.tradeId, tag: name })
        .onConflictDoNothing();
    }
  }
}
