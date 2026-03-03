import { inArray } from 'drizzle-orm';
import { auth } from '@/lib/auth-config';
import { type Db, type PoolDb } from '@/lib/db';
import { users, trades, tradeTags } from '@/lib/db/schema';

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

type QueryDb = Db | PoolDb;

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

export async function ensureUser(db: QueryDb, user: { id: string; email: string; name: string | null; picture: string | null }) {
  await db.insert(users)
    .values({ id: user.id, email: user.email, name: user.name, picture: user.picture })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: user.email, name: user.name, picture: user.picture },
    });
}

export function dbUnavailable() {
  return Response.json({ error: 'Database not configured' }, { status: 503 });
}

export function toTrade(row: typeof trades.$inferSelect, tags: string[] = []): ApiTrade {
  return {
    id: row.id,
    date: row.date,
    sortKey: row.sortKey,
    symbol: row.symbol,
    direction: row.direction,
    avgEntryPrice: row.avgEntryPrice,
    avgExitPrice: row.avgExitPrice,
    totalQuantity: row.totalQuantity,
    pnl: row.pnl,
    executions: row.executions,
    initialRisk: row.initialRisk ?? undefined,
    commission: row.commission ?? 0,
    fees: row.fees ?? 0,
    tags,
    notes: row.notes ?? undefined,
  };
}

export async function loadTagsForTradeIds(db: QueryDb, tradeIds: string[]) {
  if (tradeIds.length === 0) return new Map<string, string[]>();

  const rows = await db.select()
    .from(tradeTags)
    .where(inArray(tradeTags.tradeId, tradeIds));

  const tagMap = new Map<string, string[]>();
  for (const row of rows) {
    const list = tagMap.get(row.tradeId) ?? [];
    list.push(row.tag);
    tagMap.set(row.tradeId, list);
  }

  return tagMap;
}
