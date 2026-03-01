import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser, requireUser, toTrade } from '@/lib/server-db-utils';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const { id } = await context.params;
  const body = (await request.json()) as { notes?: string; initialRisk?: number | null; tags?: string[] };

  const updates: string[] = [];
  const args: Array<string | number | null> = [];

  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    updates.push('notes = ?');
    args.push(body.notes?.trim() ? body.notes.trim() : null);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'initialRisk')) {
    updates.push('initial_risk = ?');
    args.push(body.initialRisk ?? null);
  }

  if (updates.length > 0) {
    await db.execute({
      sql: `UPDATE trades SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      args: [...args, id, authState.user.id],
    });
  }

  if (Array.isArray(body.tags)) {
    await db.execute({ sql: 'DELETE FROM trade_tags WHERE trade_id = ?', args: [id] });
    for (const tag of body.tags) {
      await db.execute({ sql: 'INSERT OR IGNORE INTO trade_tags (trade_id, tag) VALUES (?, ?)', args: [id, tag] });
      await db.execute({ sql: 'INSERT OR IGNORE INTO tags (user_id, name) VALUES (?, ?)', args: [authState.user.id, tag] });
    }
  }

  const tradeRes = await db.execute({
    sql: 'SELECT * FROM trades WHERE id = ? AND user_id = ? LIMIT 1',
    args: [id, authState.user.id],
  });

  if (tradeRes.rows.length === 0) {
    return Response.json({ error: 'Trade not found' }, { status: 404 });
  }

  const tagRows = await db.execute({ sql: 'SELECT tag FROM trade_tags WHERE trade_id = ?', args: [id] });
  const tags = tagRows.rows.map((row) => String(row.tag));

  return Response.json({ trade: toTrade(tradeRes.rows[0], tags) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const { id } = await context.params;

  await db.execute({
    sql: 'DELETE FROM trades WHERE id = ? AND user_id = ?',
    args: [id, authState.user.id],
  });

  return Response.json({ success: true, id });
}
