import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
import { requireUserOrServiceWithOptions } from '@/lib/service-auth';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toTrade,
  type ApiTrade,
} from '@/lib/server-db-utils';

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
  const tagMap = await loadTagsForTradeIds(db, authState.user.id, tradeIds);

  const tradeList = tradeRows.map((row) => toTrade(row, tagMap.get(row.id) ?? []));
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
    pnl: body.pnl ?? 0,
    executions: body.executions ?? 1,
    initialRisk: body.initialRisk ?? null,
    commission: body.commission ?? 0,
    fees: body.fees ?? 0,
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
      pnl: body.pnl ?? 0,
      executions: body.executions ?? 1,
      initialRisk: body.initialRisk ?? null,
      commission: body.commission ?? 0,
      fees: body.fees ?? 0,
      notes: body.notes ?? null,
    },
  });

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

  const trade = toTrade(created, body.tags ?? []);
  return Response.json({ trade });
}
