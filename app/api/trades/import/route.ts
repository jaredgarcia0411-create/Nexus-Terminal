import { getDb } from '@/lib/db';
import {
  dbUnavailable,
  ensureUser,
  loadTagsForTradeIds,
  requireUser,
  toTrade,
  type ApiTrade,
} from '@/lib/server-db-utils';

type ImportPayload = {
  trades: ApiTrade[];
};

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json()) as ImportPayload;
  if (!Array.isArray(body.trades)) {
    return Response.json({ error: 'trades must be an array' }, { status: 400 });
  }

  await db.execute('BEGIN');
  try {
    for (const trade of body.trades) {
      await db.execute({
        sql: `
          INSERT INTO trades (
            id, user_id, date, sort_key, symbol, direction, avg_entry_price, avg_exit_price,
            total_quantity, pnl, executions, initial_risk, commission, fees, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            avg_entry_price = excluded.avg_entry_price,
            avg_exit_price = excluded.avg_exit_price,
            total_quantity = excluded.total_quantity,
            pnl = excluded.pnl,
            executions = excluded.executions,
            commission = excluded.commission,
            fees = excluded.fees
        `,
        args: [
          trade.id,
          authState.user.id,
          trade.date,
          trade.sortKey,
          trade.symbol,
          trade.direction,
          trade.avgEntryPrice,
          trade.avgExitPrice,
          trade.totalQuantity,
          trade.pnl,
          trade.executions,
          trade.initialRisk ?? null,
          trade.commission ?? 0,
          trade.fees ?? 0,
          trade.notes ?? null,
        ],
      });

      if (trade.tags?.length) {
        for (const tag of trade.tags) {
          await db.execute({ sql: 'INSERT OR IGNORE INTO tags (user_id, name) VALUES (?, ?)', args: [authState.user.id, tag] });
          await db.execute({ sql: 'INSERT OR IGNORE INTO trade_tags (trade_id, tag) VALUES (?, ?)', args: [trade.id, tag] });
        }
      }
    }
    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK');
    throw error;
  }

  const tradesRes = await db.execute({
    sql: 'SELECT * FROM trades WHERE user_id = ? ORDER BY date DESC',
    args: [authState.user.id],
  });
  const tradeIds = tradesRes.rows.map((row) => String(row.id));
  const tagMap = await loadTagsForTradeIds(db, tradeIds);

  const trades = tradesRes.rows.map((row) => toTrade(row, tagMap.get(String(row.id)) ?? []));
  return Response.json({ trades });
}
