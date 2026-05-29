import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tradeExecutions, trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
import { internalServerError, logRouteError, parseAndValidate } from '@/lib/api-route-utils';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toExecutionRowId,
  toTrade,
} from '@/lib/server-db-utils';
import { normalizeTimestamp } from '@/lib/time-utils';
import { createTradeSchema } from '@/lib/validations/trades';

export async function GET(request: Request) {
  void request;

  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const tradeRows = await db.select().from(trades)
      .where(eq(trades.userId, authState.user.id))
      .orderBy(desc(trades.date));

    const tradeIds = tradeRows.map((row) => row.id);
    const tagMap = await loadTagsForTradeIds(db, authState.user.id, tradeIds);

    // Executions are intentionally NOT loaded here. They are the bulk of the
    // payload and the heaviest query, and are only needed in per-trade views
    // (detail sheet, replay charts), which lazy-load them via /api/trades/[id].
    const tradeList = tradeRows.map((row) => toTrade(row, tagMap.get(row.id) ?? [], []));
    return Response.json({ trades: tradeList });
  } catch (error) {
    logRouteError('trades.get', error);
    return internalServerError();
  }
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseAndValidate(request, createTradeSchema);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    const commission = body.commission ?? 0;
    const fees = body.fees ?? 0;
    const netPnl = body.netPnl ?? body.pnl ?? 0;
    const grossPnl = body.grossPnl ?? netPnl + commission + fees;
    const executionCount = body.executionCount ?? body.executions ?? 1;

    await db.insert(trades).values({
      id: body.id,
      userId: authState.user.id,
      date: body.date,
      sortKey: body.sortKey,
      symbol: body.symbol,
      direction: body.direction,
      avgEntryPrice: body.avgEntryPrice ?? 0,
      avgExitPrice: body.avgExitPrice ?? 0,
      totalQuantity: body.totalQuantity ?? 0,
      grossPnl,
      netPnl,
      entryTime: body.entryTime ?? '',
      exitTime: body.exitTime ?? '',
      executionCount,
      mfe: body.mfe ?? null,
      mae: body.mae ?? null,
      bestExitPnl: body.bestExitPnl ?? null,
      exitEfficiency: body.exitEfficiency ?? null,
      pnl: netPnl,
      executions: executionCount,
      initialRisk: body.initialRisk ?? null,
      commission,
      fees,
      notes: body.notes ?? null,
      isOpen: body.isOpen ?? false,
      closedAt: body.closedAt ? new Date(body.closedAt) : null,
      remainingQty: body.remainingQty ?? 0,
    }).onConflictDoUpdate({
      target: [trades.userId, trades.id],
      set: {
        date: body.date,
        sortKey: body.sortKey,
        symbol: body.symbol,
        direction: body.direction,
        avgEntryPrice: body.avgEntryPrice ?? 0,
        avgExitPrice: body.avgExitPrice ?? 0,
        totalQuantity: body.totalQuantity ?? 0,
        grossPnl,
        netPnl,
        entryTime: body.entryTime ?? '',
        exitTime: body.exitTime ?? '',
        executionCount,
        mfe: body.mfe ?? null,
        mae: body.mae ?? null,
        bestExitPnl: body.bestExitPnl ?? null,
        exitEfficiency: body.exitEfficiency ?? null,
        pnl: netPnl,
        executions: executionCount,
        initialRisk: body.initialRisk ?? null,
        commission,
        fees,
        notes: body.notes ?? null,
        isOpen: body.isOpen ?? false,
        closedAt: body.closedAt ? new Date(body.closedAt) : null,
        remainingQty: body.remainingQty ?? 0,
      },
    });

    if (Array.isArray(body.rawExecutions) && body.rawExecutions.length > 0) {
      await db.delete(tradeExecutions).where(and(
        eq(tradeExecutions.userId, authState.user.id),
        eq(tradeExecutions.tradeId, body.id),
      ));

      await db.insert(tradeExecutions).values(
        body.rawExecutions.map((execution, index) => ({
          id: toExecutionRowId(authState.user.id, body.id, execution.id, index),
          userId: authState.user.id,
          tradeId: body.id,
          side: execution.side,
          price: execution.price,
          qty: execution.qty,
          time: execution.time,
          timestamp: normalizeTimestamp(execution.timestamp),
          commission: execution.commission ?? 0,
          fees: execution.fees ?? 0,
        })),
      );
    }

    if (Array.isArray(body.tags)) {
      await db.delete(tradeTagsTable).where(and(
        eq(tradeTagsTable.userId, authState.user.id),
        eq(tradeTagsTable.tradeId, body.id),
      ));
      for (const tag of body.tags) {
        await db.insert(tradeTagsTable).values({
          userId: authState.user.id,
          tradeId: body.id,
          tag,
        }).onConflictDoNothing();
        await db.insert(tagsTable).values({ userId: authState.user.id, name: tag }).onConflictDoNothing();
      }
    }

    const [created] = await db.select().from(trades)
      .where(and(eq(trades.userId, authState.user.id), eq(trades.id, body.id)))
      .limit(1);
    if (!created) return Response.json({ error: 'Trade not found after save' }, { status: 500 });

    const trade = toTrade(created, body.tags ?? [], body.rawExecutions ?? []);
    return Response.json({ trade });
  } catch (error) {
    logRouteError('trades.post', error);
    return internalServerError();
  }
}
