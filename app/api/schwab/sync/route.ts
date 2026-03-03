import { getDb } from '@/lib/db';
import { dbUnavailable, ensureUser, requireUser } from '@/lib/server-db-utils';
import { getValidSchwabToken } from '@/lib/schwab';
import { normalizeSchwabTransaction, type SchwabTransaction } from '@/lib/parsers/schwab-api';
import { processCsvData } from '@/lib/csv-parser';
import { format } from 'date-fns';
import type { InValue } from '@libsql/client';

const MAX_RANGE_DAYS = 90;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(request: Request) {
  const authState = await requireUser();
  if ('error' in authState) return authState.error;

  const db = getDb();
  if (!db) return dbUnavailable();
  await ensureUser(db, authState.user);

  const body = (await request.json().catch(() => ({}))) as {
    accountId?: string;
    startDate?: string;
    endDate?: string;
  };

  const { accountId, startDate, endDate } = body;
  if (!accountId) {
    return Response.json({ error: 'accountId is required' }, { status: 400 });
  }

  // Validate date range
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
  const end = endDate ? new Date(endDate) : new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return Response.json({ error: 'Invalid date range' }, { status: 400 });
  }

  const rangeDays = (end.getTime() - start.getTime()) / 86400000;
  if (rangeDays > MAX_RANGE_DAYS) {
    return Response.json({ error: `Maximum range is ${MAX_RANGE_DAYS} days` }, { status: 400 });
  }

  // Cooldown check
  const lastSync = await db.execute({
    sql: `SELECT synced_at FROM broker_sync_log WHERE user_id = ? AND account_number = ? ORDER BY synced_at DESC LIMIT 1`,
    args: [authState.user.id, accountId],
  });

  if (lastSync.rows.length > 0) {
    const lastSyncTime = new Date(String((lastSync.rows[0] as Record<string, InValue>).synced_at)).getTime();
    if (Date.now() - lastSyncTime < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - (Date.now() - lastSyncTime)) / 1000);
      return Response.json({ error: `Please wait ${waitSec}s before syncing again` }, { status: 429 });
    }
  }

  // Fetch token
  let token;
  try {
    token = await getValidSchwabToken(db, authState.user.id);
  } catch (error) {
    const text = error instanceof Error ? error.message : 'Could not refresh Schwab token';
    return Response.json({ error: text }, { status: 502 });
  }

  if (!token) {
    return Response.json({ error: 'Schwab not connected' }, { status: 401 });
  }

  // Fetch transactions
  const apiBase = process.env.SCHWAB_API_BASE_URL || 'https://api.schwabapi.com';
  const url = new URL(`/trader/v1/accounts/${encodeURIComponent(accountId)}/transactions`, apiBase);
  url.searchParams.set('startDate', start.toISOString());
  url.searchParams.set('endDate', end.toISOString());
  url.searchParams.set('types', 'TRADE');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 429) {
      return Response.json({ error: 'Schwab API rate limit reached. Try again shortly.' }, { status: 429 });
    }
    return Response.json({ error: 'Failed to fetch Schwab transactions' }, { status: 502 });
  }

  const transactions = (await res.json().catch(() => [])) as SchwabTransaction[];

  // Group by date and normalize
  const byDate = new Map<string, { symbol: string; side: string; qty: number; price: number; time: string; commission: number; fees: number }[]>();

  for (const txn of transactions) {
    const exec = normalizeSchwabTransaction(txn);
    if (!exec) continue;

    const tradeDate = txn.tradeDate ? format(new Date(txn.tradeDate), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');
    if (!byDate.has(tradeDate)) byDate.set(tradeDate, []);
    byDate.get(tradeDate)!.push({
      Symbol: exec.symbol,
      Side: exec.side,
      Qty: String(exec.qty),
      Price: String(exec.price),
      Time: exec.time,
      Commission: String(exec.commission),
      Fees: String(exec.fees),
    } as any);
  }

  // Process each date through the existing FIFO matcher
  const allTrades: any[] = [];
  const allWarnings: string[] = [];

  for (const [dateStr, rows] of byDate) {
    const d = new Date(dateStr);
    const dateInfo = { date: d, sortKey: format(d, 'yyyy-MM-dd') };
    const result = processCsvData(rows, dateInfo);
    allTrades.push(...result.trades);
    allWarnings.push(...result.warnings);
  }

  // Import trades using the same upsert logic as CSV import
  if (allTrades.length > 0) {
    for (const trade of allTrades) {
      const tradeId = trade.id;
      await db.execute({
        sql: `INSERT OR REPLACE INTO trades (id, user_id, date, sort_key, symbol, direction, avg_entry_price, avg_exit_price, total_quantity, pnl, executions, commission, fees, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [
          tradeId,
          authState.user.id,
          new Date(trade.date).toISOString(),
          trade.sortKey,
          trade.symbol,
          trade.direction,
          trade.avgEntryPrice,
          trade.avgExitPrice,
          trade.totalQuantity,
          trade.pnl,
          trade.executions,
          trade.commission ?? 0,
          trade.fees ?? 0,
        ],
      });
    }
  }

  // Log the sync
  await db.execute({
    sql: `INSERT INTO broker_sync_log (user_id, broker, account_number, sync_start, sync_end, trades_synced, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      authState.user.id,
      'schwab',
      accountId,
      start.toISOString(),
      end.toISOString(),
      allTrades.length,
    ],
  });

  return Response.json({
    tradesImported: allTrades.length,
    warnings: allWarnings,
  });
}
