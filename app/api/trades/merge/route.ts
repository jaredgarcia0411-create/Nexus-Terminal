import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import {
  tradeExecutions,
  trades,
  tradeTags as tradeTagsTable,
  tags as tagsTable,
} from '@/lib/db/schema';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toTrade,
} from '@/lib/server-db-utils';
import { mergeTradesSchema } from '@/lib/validations/trades';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, mergeTradesSchema);
    if (bodyState.error) return bodyState.error;
    const { ids } = bodyState.data;

    const tradeRows = await db.select().from(trades)
      .where(and(eq(trades.userId, authState.user.id), inArray(trades.id, ids)));

    if (tradeRows.length !== ids.length) {
      return Response.json({ error: 'One or more trades not found or not owned by you' }, { status: 404 });
    }

    if (tradeRows.length < 2) {
      return Response.json({ error: 'Select at least 2 trades to merge' }, { status: 400 });
    }

    const symbols = new Set(tradeRows.map((trade) => trade.symbol));
    if (symbols.size > 1) {
      return Response.json({ error: 'Cannot merge trades with different symbols' }, { status: 400 });
    }

    const directions = new Set(tradeRows.map((trade) => trade.direction));
    if (directions.size > 1) {
      return Response.json({ error: 'Cannot merge trades with opposite directions (LONG vs SHORT)' }, { status: 400 });
    }

    const symbol = tradeRows[0].symbol;
    const direction = tradeRows[0].direction;
    const totalQty = tradeRows.reduce((sum, trade) => sum + trade.totalQuantity, 0);
    const avgEntryPrice = totalQty > 0
      ? tradeRows.reduce((sum, trade) => sum + trade.avgEntryPrice * trade.totalQuantity, 0) / totalQty
      : 0;
    const avgExitPrice = totalQty > 0
      ? tradeRows.reduce((sum, trade) => sum + trade.avgExitPrice * trade.totalQuantity, 0) / totalQty
      : 0;
    const totalGrossPnl = tradeRows.reduce((sum, trade) => sum + trade.grossPnl, 0);
    const totalNetPnl = tradeRows.reduce((sum, trade) => sum + trade.netPnl, 0);
    const totalCommission = tradeRows.reduce((sum, trade) => sum + (trade.commission ?? 0), 0);
    const totalFees = tradeRows.reduce((sum, trade) => sum + (trade.fees ?? 0), 0);
    const entryTimes = tradeRows.map((trade) => trade.entryTime).filter(Boolean);
    const exitTimes = tradeRows.map((trade) => trade.exitTime).filter(Boolean);
    const entryTime = entryTimes.length > 0 ? entryTimes.sort()[0] : '';
    const exitTime = exitTimes.length > 0 ? [...exitTimes].sort().reverse()[0] : '';
    const sorted = [...tradeRows].sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return (a.entryTime ?? '').localeCompare(b.entryTime ?? '');
    });
    const earliest = sorted[0];
    const initialRisk = earliest.initialRisk ?? null;
    const anyOpen = tradeRows.some((trade) => trade.isOpen);
    const remainingQty = anyOpen ? tradeRows.reduce((sum, trade) => sum + (trade.remainingQty ?? 0), 0) : 0;
    const closedAtValues = tradeRows
      .map((trade) => trade.closedAt)
      .filter((value): value is Date => value instanceof Date);
    const closedAt = anyOpen
      ? null
      : closedAtValues.length > 0
        ? closedAtValues.sort((a, b) => b.getTime() - a.getTime())[0]
        : null;
    const mergedId = `merged|${randomUUID().slice(0, 8)}|${symbol}|${direction}`;
    const tagMap = await loadTagsForTradeIds(db, authState.user.id, ids);
    const unionTags = Array.from(new Set(ids.flatMap((id) => tagMap.get(id) ?? [])));
    const noteFragments = tradeRows
      .map((trade) => trade.notes?.trim())
      .filter((note): note is string => !!note);
    const mergedNotes = noteFragments.length > 0 ? noteFragments.join(' --- ') : null;

    await db.transaction(async (tx) => {
      await tx.insert(trades).values({
        id: mergedId,
        userId: authState.user.id,
        date: earliest.date,
        sortKey: earliest.sortKey,
        symbol,
        direction,
        avgEntryPrice,
        avgExitPrice,
        totalQuantity: totalQty,
        grossPnl: totalGrossPnl,
        netPnl: totalNetPnl,
        entryTime,
        exitTime,
        executionCount: tradeRows.reduce((sum, trade) => sum + trade.executionCount, 0),
        pnl: totalNetPnl,
        executions: tradeRows.reduce((sum, trade) => sum + trade.executions, 0),
        commission: totalCommission,
        fees: totalFees,
        initialRisk,
        notes: mergedNotes,
        isOpen: anyOpen,
        closedAt,
        remainingQty,
      });

      await tx.update(tradeExecutions)
        .set({ tradeId: mergedId })
        .where(and(
          eq(tradeExecutions.userId, authState.user.id),
          inArray(tradeExecutions.tradeId, ids),
        ));

      for (const tag of unionTags) {
        await tx.insert(tagsTable)
          .values({ userId: authState.user.id, name: tag })
          .onConflictDoNothing();
        await tx.insert(tradeTagsTable)
          .values({ userId: authState.user.id, tradeId: mergedId, tag })
          .onConflictDoNothing();
      }

      await tx.delete(trades)
        .where(and(eq(trades.userId, authState.user.id), inArray(trades.id, ids)));
    });

    const [mergedRow] = await db.select().from(trades)
      .where(and(eq(trades.id, mergedId), eq(trades.userId, authState.user.id)))
      .limit(1);

    if (!mergedRow) {
      return Response.json({ error: 'Merge succeeded but could not reload merged trade' }, { status: 500 });
    }

    const mergedTags = await loadTagsForTradeIds(db, authState.user.id, [mergedId]);
    return Response.json({
      trade: toTrade(mergedRow, mergedTags.get(mergedId) ?? []),
      deletedIds: ids,
    });
  } catch (error) {
    logRouteError('trades.merge.post', error);
    return internalServerError();
  }
}
