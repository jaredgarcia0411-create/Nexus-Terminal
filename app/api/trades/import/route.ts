import { desc, eq } from 'drizzle-orm';
import { getPoolDb } from '@/lib/db';
import { trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toTrade,
  type ApiTrade,
} from '@/lib/server-db-utils';

type ImportPayload = {
  trades: ApiTrade[];
};

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getPoolDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json()) as ImportPayload;
  if (!Array.isArray(body.trades)) {
    return Response.json({ error: 'trades must be an array' }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    for (const trade of body.trades) {
      await tx.insert(trades).values({
        id: trade.id,
        userId: authState.user.id,
        date: trade.date,
        sortKey: trade.sortKey,
        symbol: trade.symbol,
        direction: trade.direction,
        avgEntryPrice: trade.avgEntryPrice,
        avgExitPrice: trade.avgExitPrice,
        totalQuantity: trade.totalQuantity,
        pnl: trade.pnl,
        executions: trade.executions,
        initialRisk: trade.initialRisk ?? null,
        commission: trade.commission ?? 0,
        fees: trade.fees ?? 0,
        notes: trade.notes ?? null,
      }).onConflictDoUpdate({
        target: [trades.userId, trades.id],
        set: {
          avgEntryPrice: trade.avgEntryPrice,
          avgExitPrice: trade.avgExitPrice,
          totalQuantity: trade.totalQuantity,
          pnl: trade.pnl,
          executions: trade.executions,
          commission: trade.commission ?? 0,
          fees: trade.fees ?? 0,
        },
      });

      if (trade.tags?.length) {
        for (const tag of trade.tags) {
          await tx.insert(tagsTable).values({ userId: authState.user.id, name: tag }).onConflictDoNothing();
          await tx.insert(tradeTagsTable).values({
            userId: authState.user.id,
            tradeId: trade.id,
            tag,
          }).onConflictDoNothing();
        }
      }
    }
  });

  const tradeRows = await db.select().from(trades)
    .where(eq(trades.userId, authState.user.id))
    .orderBy(desc(trades.date));
  const tradeIds = tradeRows.map((row) => row.id);
  const tagMap = await loadTagsForTradeIds(db, authState.user.id, tradeIds);

  const tradeList = tradeRows.map((row) => toTrade(row, tagMap.get(row.id) ?? []));
  return Response.json({ trades: tradeList });
}
