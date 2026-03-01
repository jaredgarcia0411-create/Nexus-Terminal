import { getDb } from '@/lib/db';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toTrade,
  type ApiTrade,
} from '@/lib/server-db-utils';

export async function GET() {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();

  await ensureUser(db, authState.user);

  const tradeRows = await db.execute({
    sql: 'SELECT * FROM trades WHERE user_id = ? ORDER BY date DESC',
    args: [authState.user.id],
  });

  const tradeIds = tradeRows.rows.map((row) => String(row.id));
  const tagMap = await loadTagsForTradeIds(db, tradeIds);

  const trades = tradeRows.rows.map((row) => toTrade(row, tagMap.get(String(row.id)) ?? []));
  return Response.json({ trades });
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

  await db.execute({
    sql: `
      INSERT INTO trades (
        id, user_id, date, sort_key, symbol, direction, avg_entry_price, avg_exit_price,
        total_quantity, pnl, executions, initial_risk, commission, fees, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        date = excluded.date,
        sort_key = excluded.sort_key,
        symbol = excluded.symbol,
        direction = excluded.direction,
        avg_entry_price = excluded.avg_entry_price,
        avg_exit_price = excluded.avg_exit_price,
        total_quantity = excluded.total_quantity,
        pnl = excluded.pnl,
        executions = excluded.executions,
        initial_risk = excluded.initial_risk,
        commission = excluded.commission,
        fees = excluded.fees,
        notes = excluded.notes
    `,
    args: [
      body.id,
      authState.user.id,
      body.date,
      body.sortKey,
      body.symbol,
      body.direction,
      body.avgEntryPrice ?? 0,
      body.avgExitPrice ?? 0,
      body.totalQuantity ?? 0,
      body.pnl ?? 0,
      body.executions ?? 1,
      body.initialRisk ?? null,
      body.commission ?? 0,
      body.fees ?? 0,
      body.notes ?? null,
    ],
  });

  if (Array.isArray(body.tags)) {
    await db.execute({ sql: 'DELETE FROM trade_tags WHERE trade_id = ?', args: [body.id] });
    for (const tag of body.tags) {
      await db.execute({ sql: 'INSERT OR IGNORE INTO trade_tags (trade_id, tag) VALUES (?, ?)', args: [body.id, tag] });
      await db.execute({ sql: 'INSERT OR IGNORE INTO tags (user_id, name) VALUES (?, ?)', args: [authState.user.id, tag] });
    }
  }

  const tradeRes = await db.execute({
    sql: 'SELECT * FROM trades WHERE id = ? AND user_id = ? LIMIT 1',
    args: [body.id, authState.user.id],
  });

  const created = tradeRes.rows[0];
  if (!created) return Response.json({ error: 'Trade not found after save' }, { status: 500 });

  const trade = toTrade(created, body.tags ?? []);
  return Response.json({ trade });
}
