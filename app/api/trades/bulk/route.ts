import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

type BulkPayload = {
  action: 'delete' | 'applyRisk' | 'addTag';
  ids: string[];
  value?: number | string;
};

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json()) as BulkPayload;
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return Response.json({ error: 'ids are required' }, { status: 400 });
  }

  await db.execute('BEGIN');
  try {
    if (body.action === 'delete') {
      for (const id of body.ids) {
        await db.execute({ sql: 'DELETE FROM trades WHERE id = ? AND user_id = ?', args: [id, authState.user.id] });
      }
    }

    if (body.action === 'applyRisk') {
      const risk = Number(body.value);
      if (!Number.isFinite(risk) || risk <= 0) {
        await db.execute('ROLLBACK');
        return Response.json({ error: 'value must be a positive number' }, { status: 400 });
      }
      for (const id of body.ids) {
        await db.execute({ sql: 'UPDATE trades SET initial_risk = ? WHERE id = ? AND user_id = ?', args: [risk, id, authState.user.id] });
      }
    }

    if (body.action === 'addTag') {
      const tag = String(body.value ?? '').trim();
      if (!tag) {
        await db.execute('ROLLBACK');
        return Response.json({ error: 'value is required for addTag' }, { status: 400 });
      }

      await db.execute({
        sql: 'INSERT OR IGNORE INTO tags (user_id, name) VALUES (?, ?)',
        args: [authState.user.id, tag],
      });

      for (const id of body.ids) {
        await db.execute({ sql: 'INSERT OR IGNORE INTO trade_tags (trade_id, tag) VALUES (?, ?)', args: [id, tag] });
      }
    }

    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }

  return Response.json({ success: true, action: body.action, ids: body.ids });
}
