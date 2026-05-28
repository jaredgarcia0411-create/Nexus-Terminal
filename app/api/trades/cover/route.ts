import { randomUUID } from 'crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { computeCover, type CoverOpenInput } from '@/lib/cover-position';
import { getPoolDb } from '@/lib/db';
import { trades } from '@/lib/db/schema';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toTrade,
} from '@/lib/server-db-utils';
import { coverPositionSchema } from '@/lib/validations/trades';

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, coverPositionSchema);
    if (bodyState.error) return bodyState.error;
    const { symbol, coverDirection, price, qty, time, date, sortKey } = bodyState.data;

    const positionDirection = coverDirection === 'LONG' ? 'SHORT' : 'LONG';

    const opens = await db.select().from(trades)
      .where(and(
        eq(trades.userId, authState.user.id),
        eq(trades.symbol, symbol),
        eq(trades.direction, positionDirection),
        eq(trades.isOpen, true),
      ))
      .orderBy(asc(trades.date), asc(trades.entryTime), asc(trades.id));

    if (opens.length === 0) {
      return Response.json(
        { error: `No open ${positionDirection} position found for ${symbol}` },
        { status: 400 },
      );
    }

    const coverInputs: CoverOpenInput[] = opens.map((open) => ({
      id: open.id,
      totalQuantity: open.totalQuantity,
      avgEntryPrice: open.avgEntryPrice,
      commission: open.commission ?? 0,
      fees: open.fees ?? 0,
    }));

    const { matches, flipQty } = computeCover(positionDirection, price, qty, coverInputs);
    const affectedIds: string[] = [];

    await db.transaction(async (tx) => {
      for (const match of matches) {
        const open = opens.find((row) => row.id === match.id)!;

        if (match.remainingQty === 0) {
          await tx.update(trades).set({
            avgExitPrice: price,
            exitTime: time,
            grossPnl: match.grossPnl,
            netPnl: match.netPnl,
            pnl: match.netPnl,
            isOpen: false,
            closedAt: sql`now()`,
            remainingQty: 0,
          }).where(and(eq(trades.id, open.id), eq(trades.userId, authState.user.id)));
          affectedIds.push(open.id);
        } else {
          const keepRatio = open.totalQuantity > 0 ? match.remainingQty / open.totalQuantity : 0;
          await tx.update(trades).set({
            totalQuantity: match.remainingQty,
            remainingQty: match.remainingQty,
            commission: (open.commission ?? 0) * keepRatio,
            fees: (open.fees ?? 0) * keepRatio,
          }).where(and(eq(trades.id, open.id), eq(trades.userId, authState.user.id)));
          affectedIds.push(open.id);

          const closedId = `cover|${randomUUID().slice(0, 8)}|${symbol}|${positionDirection}`;
          await tx.insert(trades).values({
            id: closedId,
            userId: authState.user.id,
            date: open.date,
            sortKey: open.sortKey,
            symbol,
            direction: positionDirection,
            avgEntryPrice: open.avgEntryPrice,
            avgExitPrice: price,
            totalQuantity: match.matchedQty,
            grossPnl: match.grossPnl,
            netPnl: match.netPnl,
            entryTime: open.entryTime,
            exitTime: time,
            executionCount: 1,
            pnl: match.netPnl,
            executions: 1,
            initialRisk: open.initialRisk,
            commission: match.matchedCommission,
            fees: match.matchedFees,
            isOpen: false,
            closedAt: sql`now()`,
            remainingQty: 0,
          });
          affectedIds.push(closedId);
        }
      }

      if (flipQty > 0) {
        const flipId = `${sortKey}|${symbol}|${coverDirection}|cover-${randomUUID().slice(0, 4)}`;
        await tx.insert(trades).values({
          id: flipId,
          userId: authState.user.id,
          date,
          sortKey,
          symbol,
          direction: coverDirection,
          avgEntryPrice: price,
          avgExitPrice: 0,
          totalQuantity: flipQty,
          grossPnl: 0,
          netPnl: 0,
          entryTime: time,
          exitTime: '',
          executionCount: 1,
          pnl: 0,
          executions: 1,
          isOpen: true,
          remainingQty: flipQty,
        });
        affectedIds.push(flipId);
      }
    });

    const rows = await db.select().from(trades)
      .where(and(eq(trades.userId, authState.user.id), inArray(trades.id, affectedIds)));
    const tagMap = await loadTagsForTradeIds(db, authState.user.id, affectedIds);

    return Response.json({
      affected: rows.map((row) => toTrade(row, tagMap.get(row.id) ?? [])),
    });
  } catch (error) {
    logRouteError('trades.cover.post', error);
    return internalServerError();
  }
}
