import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import { tradeExecutions, tradeImportBatches, trades } from '@/lib/db/schema';
import {
  dbUnavailable,
  ensureUser,
  requireUser,
} from '@/lib/server-db-utils';
import {
  matchExecutions,
  type MatcherExecution,
  type OpenPositionInput,
} from '@/lib/position-matcher';
import { importRawSchema } from '@/lib/validations/trades';
import { applyWatchlistTagsForDate } from '@/lib/watchlist-server';

function makeId(parts: string[]): string {
  return parts.join('|');
}

function hex4(): string {
  return randomUUID().replace(/-/g, '').slice(0, 4);
}

function compactTimeForId(time: string): string {
  const digits = time.replace(/\D/g, '');
  return digits.padEnd(6, '0').slice(0, 6);
}

// Anchor closedAt at noon UTC so the calendar day is stable in any local
// timezone — midnight UTC shifts to the previous day west of GMT, which
// pushed trades onto Sunday in the journal calendar.
function dayToClosedAt(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function toStoredExecutionSide(side: MatcherExecution['side']): 'ENTRY' | 'EXIT' {
  return side.endsWith('_ENTRY') ? 'ENTRY' : 'EXIT';
}

function toExecutionRows(userId: string, tradeId: string, rawExecutions: MatcherExecution[] = []) {
  return rawExecutions.map((execution, index) => ({
    id: `${tradeId}|raw|${index}-${hex4()}`,
    userId,
    tradeId,
    side: toStoredExecutionSide(execution.side),
    price: execution.price,
    qty: execution.qty,
    time: execution.time,
    timestamp: null,
    commission: execution.commission ?? 0,
    fees: execution.fees ?? 0,
  }));
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, importRawSchema);
    if (bodyState.error) return bodyState.error;
    const { date: sortKey, executions, batchKey } = bodyState.data;

    const symbols = Array.from(new Set(executions.map((execution) => execution.symbol)));
    const openRows = await db.select().from(trades).where(and(
      eq(trades.userId, authState.user.id),
      eq(trades.isOpen, true),
      inArray(trades.symbol, symbols),
    ));

    const openPositions: OpenPositionInput[] = openRows.map((row) => {
      const outstandingQty = row.remainingQty > 0 ? row.remainingQty : row.totalQuantity;
      return {
        id: row.id,
        symbol: row.symbol,
        direction: row.direction,
        totalQuantity: outstandingQty,
        avgEntryPrice: row.avgEntryPrice,
        entryTime: row.entryTime,
        entryDate: new Date(`${row.sortKey}T00:00:00Z`),
        commission: row.commission ?? 0,
        fees: row.fees ?? 0,
      };
    });

    const { trades: matchedClosed, newOpenPositions, closingFills, warnings } =
      matchExecutions(executions, openPositions);
    const closedAt = dayToClosedAt(sortKey);
    let importSkipped = false;

    await db.transaction(async (tx) => {
      if (batchKey) {
        const inserted = await tx.insert(tradeImportBatches)
          .values({ userId: authState.user.id, batchKey })
          .onConflictDoNothing()
          .returning({ batchKey: tradeImportBatches.batchKey });

        if (inserted.length === 0) {
          importSkipped = true;
          return;
        }
      }

      for (const trade of matchedClosed) {
        const tradeId = makeId([sortKey, trade.symbol, trade.direction]);
        const executionRows = toExecutionRows(authState.user.id, tradeId, trade.rawExecutions);

        await tx.insert(trades).values({
          id: tradeId,
          userId: authState.user.id,
          date: sortKey,
          sortKey,
          symbol: trade.symbol,
          direction: trade.direction,
          avgEntryPrice: trade.avgEntryPrice,
          avgExitPrice: trade.avgExitPrice,
          totalQuantity: trade.totalQuantity,
          grossPnl: trade.grossPnl,
          netPnl: trade.netPnl,
          entryTime: trade.entryTime,
          exitTime: trade.exitTime,
          executionCount: Math.max(1, executionRows.length),
          pnl: trade.netPnl,
          executions: Math.max(1, executionRows.length),
          commission: trade.commission,
          fees: trade.fees,
          isOpen: false,
          closedAt,
          remainingQty: 0,
        }).onConflictDoUpdate({
          target: [trades.userId, trades.id],
          set: {
            avgEntryPrice: trade.avgEntryPrice,
            avgExitPrice: trade.avgExitPrice,
            totalQuantity: trade.totalQuantity,
            grossPnl: trade.grossPnl,
            netPnl: trade.netPnl,
            entryTime: trade.entryTime,
            exitTime: trade.exitTime,
            executionCount: Math.max(1, executionRows.length),
            pnl: trade.netPnl,
            executions: Math.max(1, executionRows.length),
            commission: trade.commission,
            fees: trade.fees,
          },
        });

        if (executionRows.length > 0) {
          await tx.delete(tradeExecutions).where(and(
            eq(tradeExecutions.userId, authState.user.id),
            eq(tradeExecutions.tradeId, tradeId),
          ));

          await tx.insert(tradeExecutions).values(executionRows);
        }
      }

      for (const position of newOpenPositions) {
        const tradeId = makeId([
          sortKey,
          position.symbol,
          position.direction,
          `${compactTimeForId(position.entryTime)}-${hex4()}`,
        ]);
        const executionRows = toExecutionRows(authState.user.id, tradeId, position.rawExecutions);

        await tx.insert(trades).values({
          id: tradeId,
          userId: authState.user.id,
          date: sortKey,
          sortKey,
          symbol: position.symbol,
          direction: position.direction,
          avgEntryPrice: position.avgEntryPrice,
          avgExitPrice: 0,
          totalQuantity: position.totalQuantity,
          grossPnl: 0,
          netPnl: 0,
          entryTime: position.entryTime,
          exitTime: '',
          executionCount: Math.max(1, executionRows.length),
          pnl: 0,
          executions: Math.max(1, executionRows.length),
          commission: position.commission,
          fees: position.fees,
          isOpen: true,
          closedAt: null,
          remainingQty: position.remainingQty ?? position.totalQuantity,
        });

        if (executionRows.length > 0) {
          await tx.insert(tradeExecutions).values(executionRows);
        }
      }

      for (const fill of closingFills) {
        const open = openRows.find((row) => row.id === fill.openPositionId);
        if (!open) continue;

        const originalQty = open.remainingQty > 0 ? open.remainingQty : open.totalQuantity;
        const isFullClose = fill.matchedQty >= originalQty - 1e-9;

        if (isFullClose) {
          await tx.update(trades).set({
            avgExitPrice: fill.exitPrice,
            exitTime: fill.exitTime,
            grossPnl: fill.grossPnl,
            netPnl: fill.netPnl,
            pnl: fill.netPnl,
            commission: (open.commission ?? 0) + fill.exitCommission,
            fees: (open.fees ?? 0) + fill.exitFees,
            isOpen: false,
            closedAt,
            remainingQty: 0,
          }).where(and(
            eq(trades.userId, authState.user.id),
            eq(trades.id, open.id),
          ));
        } else {
          const newOpenQty = originalQty - fill.matchedQty;
          await tx.update(trades).set({
            totalQuantity: newOpenQty,
            remainingQty: newOpenQty,
            commission: (open.commission ?? 0) - fill.entryCommissionAllocated,
            fees: (open.fees ?? 0) - fill.entryFeesAllocated,
          }).where(and(
            eq(trades.userId, authState.user.id),
            eq(trades.id, open.id),
          ));

          const realizedId = makeId([sortKey, fill.symbol, fill.direction, `p-${hex4()}`]);
          await tx.insert(trades).values({
            id: realizedId,
            userId: authState.user.id,
            date: open.date,
            sortKey: open.sortKey,
            symbol: fill.symbol,
            direction: fill.direction,
            avgEntryPrice: open.avgEntryPrice,
            avgExitPrice: fill.exitPrice,
            totalQuantity: fill.matchedQty,
            grossPnl: fill.grossPnl,
            netPnl: fill.netPnl,
            entryTime: open.entryTime,
            exitTime: fill.exitTime,
            executionCount: 1,
            pnl: fill.netPnl,
            executions: 1,
            commission: fill.entryCommissionAllocated + fill.exitCommission,
            fees: fill.entryFeesAllocated + fill.exitFees,
            isOpen: false,
            closedAt,
            remainingQty: 0,
          });
        }

        const baseId = `${fill.openPositionId}|x|${sortKey}`;
        for (let index = 0; index < fill.exitExecutions.length; index += 1) {
          const execution = fill.exitExecutions[index];
          await tx.insert(tradeExecutions).values({
            id: `${baseId}|${index}-${hex4()}`,
            userId: authState.user.id,
            tradeId: fill.openPositionId,
            side: 'EXIT',
            price: execution.price,
            qty: execution.qty,
            time: execution.time,
            timestamp: null,
            commission: execution.commission ?? 0,
            fees: execution.fees ?? 0,
          }).onConflictDoNothing();
        }
      }
    });

    try {
      await applyWatchlistTagsForDate(db, authState.user.id, sortKey);
    } catch (err) {
      logRouteError('trades.import-raw.watchlist-tags', err);
    }

    return Response.json({ warnings, importSkipped });
  } catch (error) {
    if (error instanceof Response) return error;
    logRouteError('trades.import-raw.post', error);
    return internalServerError();
  }
}
