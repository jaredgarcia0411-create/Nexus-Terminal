import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const result = await db.execute({
    sql: 'SELECT name FROM tags WHERE user_id = ? ORDER BY name ASC',
    args: [authState.user.id],
  });

  const tags = result.rows.map((row) => String(row.name));
  return Response.json({ tags });
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

  await db.execute({ sql: 'INSERT OR IGNORE INTO tags (user_id, name) VALUES (?, ?)', args: [authState.user.id, name] });
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

  await db.execute({ sql: 'DELETE FROM tags WHERE user_id = ? AND name = ?', args: [authState.user.id, name] });
  await db.execute({
    sql: 'DELETE FROM trade_tags WHERE trade_id IN (SELECT id FROM trades WHERE user_id = ?) AND tag = ?',
    args: [authState.user.id, name],
  });

  return Response.json({ success: true, name });
}
