import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tags as tagsTable, tradeTags as tradeTagsTable, trades } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const result = await db.select({ name: tagsTable.name })
    .from(tagsTable)
    .where(eq(tagsTable.userId, authState.user.id))
    .orderBy(asc(tagsTable.name));
  const tagNames = result.map((r) => r.name);
  return Response.json({ tags: tagNames });
}

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  await db.insert(tagsTable)
    .values({ userId: authState.user.id, name })
    .onConflictDoNothing();
  return Response.json({ tag: name });
}

export async function DELETE(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }

  await db.delete(tagsTable)
    .where(and(eq(tagsTable.userId, authState.user.id), eq(tagsTable.name, name)));
  const userTradeIds = db.select({ id: trades.id }).from(trades).where(eq(trades.userId, authState.user.id));
  await db.delete(tradeTagsTable)
    .where(and(inArray(tradeTagsTable.tradeId, userTradeIds), eq(tradeTagsTable.tag, name)));

  return Response.json({ success: true, name });
}
