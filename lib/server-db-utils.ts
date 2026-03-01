import type { Client, InValue } from '@libsql/client';
import { auth } from '@/lib/auth-config';
import { initDb } from '@/lib/db';

export type ApiTrade = {
  id: string;
  date: string;
  sortKey: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  avgEntryPrice: number;
  avgExitPrice: number;
  totalQuantity: number;
  pnl: number;
  executions: number;
  initialRisk?: number;
  commission?: number;
  fees?: number;
  tags: string[];
  notes?: string;
};

export async function requireUser() {
  const session = await auth();
  const user = session?.user as ({ id?: string; email?: string | null; name?: string | null; image?: string | null } | undefined);
  if (!user?.id || !user.email) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      picture: user.image ?? null,
    },
  };
}

export async function ensureUser(db: Client, user: { id: string; email: string; name: string | null; picture: string | null }) {
  await initDb();
  await db.execute({
    sql: `
      INSERT INTO users (id, email, name, picture)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        name = excluded.name,
        picture = excluded.picture
    `,
    args: [user.id, user.email, user.name, user.picture],
  });
}

export function dbUnavailable() {
  return Response.json({ error: 'Database not configured' }, { status: 503 });
}

export function toTrade(row: Record<string, InValue>, tags: string[] = []): ApiTrade {
  return {
    id: String(row.id),
    date: String(row.date),
    sortKey: String(row.sort_key),
    symbol: String(row.symbol),
    direction: String(row.direction) as 'LONG' | 'SHORT',
    avgEntryPrice: Number(row.avg_entry_price),
    avgExitPrice: Number(row.avg_exit_price),
    totalQuantity: Number(row.total_quantity),
    pnl: Number(row.pnl),
    executions: Number(row.executions),
    initialRisk: row.initial_risk == null ? undefined : Number(row.initial_risk),
    commission: row.commission == null ? 0 : Number(row.commission),
    fees: row.fees == null ? 0 : Number(row.fees),
    tags,
    notes: row.notes == null ? undefined : String(row.notes),
  };
}

export async function loadTagsForTradeIds(db: Client, tradeIds: string[]) {
  if (tradeIds.length === 0) return new Map<string, string[]>();

  const placeholders = tradeIds.map(() => '?').join(', ');
  const tagRows = await db.execute({
    sql: `SELECT trade_id, tag FROM trade_tags WHERE trade_id IN (${placeholders})`,
    args: tradeIds,
  });

  const tagMap = new Map<string, string[]>();
  tagRows.rows.forEach((row) => {
    const tradeId = String(row.trade_id);
    const list = tagMap.get(tradeId) ?? [];
    list.push(String(row.tag));
    tagMap.set(tradeId, list);
  });

  return tagMap;
}
