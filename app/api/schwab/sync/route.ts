import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { brokerSyncLog, tradeExecutions, trades } from '@/lib/db/schema';
import { requireUserOrServiceWithOptions } from '@/lib/service-auth';
import { dbUnavailable, ensureUser, toExecutionRowId } from '@/lib/server-db-utils';
import { getValidSchwabToken } from '@/lib/schwab';
import { normalizeSchwabTransaction, type SchwabTransaction } from '@/lib/parsers/schwab-api';
import { processCsvData } from '@/lib/csv-parser';
import type { Trade } from '@/lib/types';
import { format } from 'date-fns';

const MAX_RANGE_DAYS = 90;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function normalizeTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.trim()) return value;
  return null;
}

export async function POST(request: Request) {
  const db = getDb();
  if (!db) return dbUnavailable();

  const authState = await requireUserOrServiceWithOptions(request, db, {
    service: {
      requiredScopes: ['schwab:sync'],
      enforceReplay: true,
    },
  });
  if ('error' in authState) return authState.error;

  if (authState.source === 'session') {
    await ensureUser(db, authState.user);
  }

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
  const [lastSync] = await db.select({ syncedAt: brokerSyncLog.syncedAt })
    .from(brokerSyncLog)
    .where(and(eq(brokerSyncLog.userId, authState.user.id), eq(brokerSyncLog.accountNumber, accountId)))
    .orderBy(desc(brokerSyncLog.syncedAt))
    .limit(1);

  if (lastSync?.syncedAt) {
    const lastSyncTime = lastSync.syncedAt.getTime();
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
  const allTrades: Trade[] = [];
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
      const commission = trade.commission ?? 0;
      const fees = trade.fees ?? 0;
      const netPnl = trade.netPnl ?? trade.pnl;
      const grossPnl = trade.grossPnl ?? netPnl + commission + fees;
      const legacyExecutionCount = (trade as unknown as Record<string, unknown>)['executions'];
      const executionCount = trade.executionCount ?? (typeof legacyExecutionCount === 'number' ? legacyExecutionCount : 1);

      await db.insert(trades).values({
        id: tradeId,
        userId: authState.user.id,
        date: new Date(trade.date).toISOString(),
        sortKey: trade.sortKey,
        symbol: trade.symbol,
        direction: trade.direction,
        avgEntryPrice: trade.avgEntryPrice,
        avgExitPrice: trade.avgExitPrice,
        totalQuantity: trade.totalQuantity,
        grossPnl,
        netPnl,
        entryTime: trade.entryTime ?? '',
        exitTime: trade.exitTime ?? '',
        executionCount,
        mfe: trade.mfe ?? null,
        mae: trade.mae ?? null,
        bestExitPnl: trade.bestExitPnl ?? null,
        exitEfficiency: trade.exitEfficiency ?? null,
        pnl: netPnl,
        executions: executionCount,
        commission,
        fees,
      }).onConflictDoUpdate({
        target: [trades.userId, trades.id],
        set: {
          avgEntryPrice: trade.avgEntryPrice,
          avgExitPrice: trade.avgExitPrice,
          totalQuantity: trade.totalQuantity,
          grossPnl,
          netPnl,
          entryTime: trade.entryTime ?? '',
          exitTime: trade.exitTime ?? '',
          executionCount,
          mfe: trade.mfe ?? null,
          mae: trade.mae ?? null,
          bestExitPnl: trade.bestExitPnl ?? null,
          exitEfficiency: trade.exitEfficiency ?? null,
          pnl: netPnl,
          executions: executionCount,
          commission,
          fees,
        },
      });

      if (Array.isArray(trade.rawExecutions) && trade.rawExecutions.length > 0) {
        await db.delete(tradeExecutions).where(and(
          eq(tradeExecutions.userId, authState.user.id),
          eq(tradeExecutions.tradeId, tradeId),
        ));

        await db.insert(tradeExecutions).values(
          trade.rawExecutions.map((execution, index) => ({
            id: toExecutionRowId(authState.user.id, tradeId, execution.id, index),
            userId: authState.user.id,
            tradeId,
            side: execution.side,
            price: execution.price,
            qty: execution.qty,
            time: execution.time,
            timestamp: normalizeTimestamp(execution.timestamp),
            commission: execution.commission ?? 0,
            fees: execution.fees ?? 0,
          })),
        );
      }
    }
  }

  // Log the sync
  await db.insert(brokerSyncLog).values({
    userId: authState.user.id,
    broker: 'schwab',
    accountNumber: accountId,
    syncStart: start.toISOString(),
    syncEnd: end.toISOString(),
    tradesSynced: allTrades.length,
  });

  return Response.json({
    tradesImported: allTrades.length,
    warnings: allWarnings,
  });
}
