import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const result = await db.execute({
    sql: 'SELECT id, symbol, condition, target_price, created_at FROM price_alerts WHERE user_id = ? AND triggered = 0 ORDER BY created_at DESC',
    args: [authState.user.id],
  });

  const alerts = result.rows.map((row) => ({
    id: Number(row.id),
    symbol: String(row.symbol),
    condition: String(row.condition),
    targetPrice: Number(row.target_price),
    createdAt: String(row.created_at),
  }));

  return Response.json({ alerts });
}

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json()) as { symbol?: string; condition?: string; targetPrice?: number };
  const symbol = body.symbol?.trim().toUpperCase();
  const condition = body.condition?.trim();
  const targetPrice = body.targetPrice;

  if (!symbol) {
    return Response.json({ error: 'symbol is required' }, { status: 400 });
  }

  if (condition !== 'above' && condition !== 'below') {
    return Response.json({ error: "condition must be 'above' or 'below'" }, { status: 400 });
  }

  if (targetPrice == null || typeof targetPrice !== 'number' || isNaN(targetPrice)) {
    return Response.json({ error: 'targetPrice must be a valid number' }, { status: 400 });
  }

  const result = await db.execute({
    sql: 'INSERT INTO price_alerts (user_id, symbol, condition, target_price) VALUES (?, ?, ?, ?)',
    args: [authState.user.id, symbol, condition, targetPrice],
  });

  return Response.json({
    alert: {
      id: Number(result.lastInsertRowid),
      symbol,
      condition,
      targetPrice,
    },
  });
}
