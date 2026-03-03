import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser, toTrade } from '@/lib/server-db-utils';

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
    await db.delete(tradeTagsTable).where(eq(tradeTagsTable.tradeId, id));
    for (const tag of body.tags) {
      await db.insert(tradeTagsTable).values({ tradeId: id, tag }).onConflictDoNothing();
      await db.insert(tagsTable).values({ userId: authState.user.id, name: tag }).onConflictDoNothing();
    }
  }

  const [trade] = await db.select().from(trades)
    .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)))
    .limit(1);
  if (!trade) {
    return Response.json({ error: 'Trade not found' }, { status: 404 });
  }

  const tagRows = await db.select({ tag: tradeTagsTable.tag })
    .from(tradeTagsTable)
    .where(eq(tradeTagsTable.tradeId, id));
  const tagList = tagRows.map((r) => r.tag);

  return Response.json({ trade: toTrade(trade, tagList) });
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
