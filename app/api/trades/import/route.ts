import { and, desc, eq } from 'drizzle-orm';
import { internalServerError, logRouteError, parseJsonBody } from '@/lib/api-route-utils';
import { getPoolDb } from '@/lib/db';
import {
  tradeExecutions,
  tradeImportBatches,
  trades,
  tradeTags as tradeTagsTable,
  tags as tagsTable,
} from '@/lib/db/schema';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toExecutionRowId,
  toTrade,
  type ApiTrade,
} from '@/lib/server-db-utils';

type ImportPayload = {
  trades: ApiTrade[];
  batchKey?: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateTradePayload(trade: Partial<ApiTrade>, index: number): string | null {
  if (!trade.id || !trade.date || !trade.sortKey || !trade.symbol) {
    return `trades[${index}] is missing required string fields`;
  }

  if (trade.direction !== 'LONG' && trade.direction !== 'SHORT') {
    return `trades[${index}] has invalid direction`;
  }

  if (!isFiniteNumber(trade.avgEntryPrice) || !isFiniteNumber(trade.avgExitPrice) || !isFiniteNumber(trade.totalQuantity)) {
    return `trades[${index}] has invalid numeric fields`;
  }

  const netPnl = trade.netPnl ?? trade.pnl;
  if (!isFiniteNumber(netPnl)) {
    return `trades[${index}] must include netPnl or pnl`;
  }

  return null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

export async function POST(request: Request) {
  try {
    const authState = await requireUser();
    if ('error' in authState) return authState.error;

    const db = getPoolDb();
    if (!db) return dbUnavailable();
    await ensureUser(db, authState.user);

    const bodyState = await parseJsonBody<ImportPayload>(request);
    if (bodyState.error) return bodyState.error;
    const body = bodyState.data;

    if (!Array.isArray(body.trades)) {
      return Response.json({ error: 'trades must be an array' }, { status: 400 });
    }

    for (let index = 0; index < body.trades.length; index += 1) {
      const trade = body.trades[index] as Partial<ApiTrade>;
      const validationError = validateTradePayload(trade, index);
      if (validationError) {
        return Response.json({ error: validationError }, { status: 400 });
      }
    }

    const batchKey = typeof body.batchKey === 'string' ? body.batchKey.trim() : '';
    if (batchKey.length > 256) {
      return Response.json({ error: 'batchKey must be 256 characters or fewer' }, { status: 400 });
    }

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

      for (const trade of body.trades) {
        const commission = trade.commission ?? 0;
        const fees = trade.fees ?? 0;
        const netPnl = trade.netPnl ?? trade.pnl ?? 0;
        const grossPnl = trade.grossPnl ?? netPnl + commission + fees;
        const legacyExecutionCount = (trade as unknown as Record<string, unknown>)['executions'];
        const executionCount = trade.executionCount ?? (typeof legacyExecutionCount === 'number' ? legacyExecutionCount : 1);

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
          grossPnl,
          netPnl,
          entryTime: trade.entryTime ?? '',
          exitTime: trade.exitTime ?? '',
          executionCount,
          mfe: trade.mfe ?? null,
          mae: trade.mae ?? null,
          bestExitPnl: trade.bestExitPnl ?? null,
          exitEfficiency: trade.exitEfficiency ?? null,
          pnl: netPnl,
          executions: executionCount,
          initialRisk: trade.initialRisk ?? null,
          commission,
          fees,
          notes: trade.notes ?? null,
        }).onConflictDoUpdate({
          target: [trades.userId, trades.id],
          set: {
            avgEntryPrice: trade.avgEntryPrice,
            avgExitPrice: trade.avgExitPrice,
            totalQuantity: trade.totalQuantity,
            grossPnl,
            netPnl,
            entryTime: trade.entryTime ?? '',
            exitTime: trade.exitTime ?? '',
            executionCount,
            mfe: trade.mfe ?? null,
            mae: trade.mae ?? null,
            bestExitPnl: trade.bestExitPnl ?? null,
            exitEfficiency: trade.exitEfficiency ?? null,
            pnl: netPnl,
            executions: executionCount,
            commission,
            fees,
          },
        });

        if (Array.isArray(trade.rawExecutions) && trade.rawExecutions.length > 0) {
          await tx.delete(tradeExecutions).where(and(
            eq(tradeExecutions.userId, authState.user.id),
            eq(tradeExecutions.tradeId, trade.id),
          ));

          await tx.insert(tradeExecutions).values(
            trade.rawExecutions.map((execution, index) => ({
              id: toExecutionRowId(authState.user.id, trade.id, execution.id, index),
              userId: authState.user.id,
              tradeId: trade.id,
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
    return Response.json({ trades: tradeList, importSkipped });
  } catch (error) {
    logRouteError('trades.import.post', error);
    return internalServerError();
  }
}
