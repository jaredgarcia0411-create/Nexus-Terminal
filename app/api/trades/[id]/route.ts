import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tradeExecutions, trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser, toTrade } from '@/lib/server-db-utils';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const { id } = await context.params;

  const [trade] = await db.select().from(trades)
    .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
    .limit(1);
  if (!trade) {
    return Response.json({ error: 'Trade not found' }, { status: 404 });
  }

  const [tagRows, executionRows] = await Promise.all([
    db.select({ tag: tradeTagsTable.tag })
      .from(tradeTagsTable)
      .where(and(eq(tradeTagsTable.userId, authState.user.id), eq(tradeTagsTable.tradeId, id))),
    db.select().from(tradeExecutions)
      .where(and(eq(tradeExecutions.userId, authState.user.id), eq(tradeExecutions.tradeId, id)))
      .orderBy(asc(tradeExecutions.time), asc(tradeExecutions.id)),
  ]);

  const tagList = tagRows.map((r) => r.tag);
  const rawExecutions = executionRows.map((row) => ({
    id: row.id,
    side: row.side,
    price: row.price,
    qty: row.qty,
    time: row.time,
    timestamp: row.timestamp ?? undefined,
    commission: row.commission ?? 0,
    fees: row.fees ?? 0,
  }));

  return Response.json({ trade: toTrade(trade, tagList, rawExecutions) });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const { id } = await context.params;
  const body = (await request.json()) as { notes?: string; initialRisk?: number | null; tags?: string[] };

  const updateData: Partial<typeof trades.$inferInsert> = {};

  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    updateData.notes = body.notes?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'initialRisk')) {
    updateData.initialRisk = body.initialRisk ?? null;
  }

  if (Object.keys(updateData).length > 0) {
    await db.update(trades)
      .set(updateData)
      .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
  }

  if (Array.isArray(body.tags)) {
    await db.delete(tradeTagsTable).where(and(
      eq(tradeTagsTable.userId, authState.user.id),
      eq(tradeTagsTable.tradeId, id),
    ));
    for (const tag of body.tags) {
      await db.insert(tradeTagsTable).values({
        userId: authState.user.id,
        tradeId: id,
        tag,
      }).onConflictDoNothing();
      await db.insert(tagsTable).values({ userId: authState.user.id, name: tag }).onConflictDoNothing();
    }
  }

  const [trade] = await db.select().from(trades)
    .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
    .limit(1);
  if (!trade) {
    return Response.json({ error: 'Trade not found' }, { status: 404 });
  }

  const [tagRows, executionRows] = await Promise.all([
    db.select({ tag: tradeTagsTable.tag })
      .from(tradeTagsTable)
      .where(and(eq(tradeTagsTable.userId, authState.user.id), eq(tradeTagsTable.tradeId, id))),
    db.select().from(tradeExecutions)
      .where(and(eq(tradeExecutions.userId, authState.user.id), eq(tradeExecutions.tradeId, id)))
      .orderBy(asc(tradeExecutions.time), asc(tradeExecutions.id)),
  ]);
  const tagList = tagRows.map((r) => r.tag);
  const rawExecutions = executionRows.map((row) => ({
    id: row.id,
    side: row.side,
    price: row.price,
    qty: row.qty,
    time: row.time,
    timestamp: row.timestamp ?? undefined,
    commission: row.commission ?? 0,
    fees: row.fees ?? 0,
  }));

  return Response.json({ trade: toTrade(trade, tagList, rawExecutions) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const { id } = await context.params;

  await db.delete(trades)
    .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));

  return Response.json({ success: true, id });
}
