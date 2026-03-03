import { and, eq } from 'drizzle-orm';
import { getPoolDb } from '@/lib/db';
import { trades, tradeTags as tradeTagsTable, tags as tagsTable } from '@/lib/db/schema';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

type BulkPayload = {
  action: 'delete' | 'applyRisk' | 'addTag';
  ids: string[];
  value?: number | string;
};

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getPoolDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json()) as BulkPayload;
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return Response.json({ error: 'ids are required' }, { status: 400 });
  }

  if (body.action === 'applyRisk') {
    const risk = Number(body.value);
    if (!Number.isFinite(risk) || risk <= 0) {
      return Response.json({ error: 'value must be a positive number' }, { status: 400 });
    }
  }

  if (body.action === 'addTag') {
    const tag = String(body.value ?? '').trim();
    if (!tag) {
      return Response.json({ error: 'value is required for addTag' }, { status: 400 });
    }
  }

  await db.transaction(async (tx) => {
    if (body.action === 'delete') {
      for (const id of body.ids) {
        await tx.delete(trades)
          .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
      }
    }

    if (body.action === 'applyRisk') {
      const risk = Number(body.value);
      for (const id of body.ids) {
        await tx.update(trades)
          .set({ initialRisk: risk })
          .where(and(eq(trades.id, id), eq(trades.userId, authState.user.id)));
      }
    }

    if (body.action === 'addTag') {
      const tag = String(body.value ?? '').trim();

      await tx.insert(tagsTable)
        .values({ userId: authState.user.id, name: tag })
        .onConflictDoNothing();

      for (const id of body.ids) {
        await tx.insert(tradeTagsTable)
          .values({ tradeId: id, tag })
          .onConflictDoNothing();
      }
    }
  });

  return Response.json({ success: true, action: body.action, ids: body.ids });
}
