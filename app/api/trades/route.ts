import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tradeExecutions, trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
import { requireUserOrServiceWithOptions } from '@/lib/service-auth';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toExecutionRowId,
  toTrade,
  type ApiTrade,
} from '@/lib/server-db-utils';

function normalizeTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

export async function GET(request: Request) {
  const db = getDb();
  if (!db) return dbUnavailable();

  const authState = await requireUserOrServiceWithOptions(request, db, {
    service: { requiredScopes: ['trades:read'] },
  });
  if ('error' in authState) return authState.error;

  if (authState.source === 'session') {
    await ensureUser(db, authState.user);
  }

  const tradeRows = await db.select().from(trades)
    .where(eq(trades.userId, authState.user.id))
    .orderBy(desc(trades.date));

  const tradeIds = tradeRows.map((row) => row.id);
  const [tagMap, executionRows] = await Promise.all([
    loadTagsForTradeIds(db, authState.user.id, tradeIds),
    tradeIds.length > 0
      ? db.select().from(tradeExecutions)
        .where(and(eq(tradeExecutions.userId, authState.user.id), inArray(tradeExecutions.tradeId, tradeIds)))
        .orderBy(asc(tradeExecutions.time), asc(tradeExecutions.id))
      : Promise.resolve([]),
  ]);

  const executionsByTrade = new Map<string, Array<{
    id: string;
    side: 'ENTRY' | 'EXIT';
    price: number;
    qty: number;
    time: string;
    timestamp?: string;
    commission: number;
    fees: number;
  }>>();

  for (const row of executionRows) {
    const list = executionsByTrade.get(row.tradeId) ?? [];
    list.push({
      id: row.id,
      side: row.side,
      price: row.price,
      qty: row.qty,
      time: row.time,
      timestamp: row.timestamp ?? undefined,
      commission: row.commission ?? 0,
      fees: row.fees ?? 0,
    });
    executionsByTrade.set(row.tradeId, list);
  }

  const tradeList = tradeRows.map((row) => toTrade(row, tagMap.get(row.id) ?? [], executionsByTrade.get(row.id) ?? []));
  return Response.json({ trades: tradeList });
}

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json()) as Partial<ApiTrade>;
  if (!body.id || !body.symbol || !body.date || !body.sortKey || !body.direction) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }
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
    },
  });

  if (Array.isArray(body.rawExecutions) && body.rawExecutions.length > 0) {
    await db.delete(tradeExecutions).where(and(
      eq(tradeExecutions.userId, authState.user.id),
      eq(tradeExecutions.tradeId, body.id),
    ));

    await db.insert(tradeExecutions).values(
      body.rawExecutions.map((execution, index) => ({
        id: toExecutionRowId(authState.user.id, body.id!, execution.id, index),
        userId: authState.user.id,
        tradeId: body.id!,
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
}
