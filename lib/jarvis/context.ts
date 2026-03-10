import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { agentMemory, macroSummaries, trades } from '@/lib/db/schema';
import type { JarvisContext, JarvisMode } from '@/lib/jarvis/types';

function toIsoDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

export async function buildContext(userId: string, _mode: JarvisMode): Promise<JarvisContext> {
  const db = getDb();
  if (!db) {
    return { user_trades: [], macro_summary: null, memory: [] };
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [tradeRows, macroRows, memoryRows] = await Promise.all([
    db.select({
      id: trades.id,
      symbol: trades.symbol,
      direction: trades.direction,
      pnl: trades.netPnl,
      date: trades.date,
      notes: trades.notes,
      initialRisk: trades.initialRisk,
    })
      .from(trades)
      .where(and(eq(trades.userId, userId), gte(trades.createdAt, thirtyDaysAgo)))
      .orderBy(desc(trades.createdAt))
      .limit(200),
    db.select({
      summaryJson: macroSummaries.summaryJson,
      generatedAt: macroSummaries.generatedAt,
    })
      .from(macroSummaries)
      .orderBy(desc(macroSummaries.generatedAt))
      .limit(1),
    db.select({
      category: agentMemory.category,
      key: agentMemory.key,
      value: agentMemory.value,
      valueJson: agentMemory.valueJson,
    })
      .from(agentMemory)
      .where(and(
        eq(agentMemory.userId, userId),
        or(isNull(agentMemory.expiresAt), gte(agentMemory.expiresAt, new Date())),
      ))
      .orderBy(desc(agentMemory.updatedAt))
      .limit(100),
  ]);

  return {
    user_trades: tradeRows.map((trade) => ({
      id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      pnl: Number(trade.pnl ?? 0),
      r_multiple: trade.initialRisk && trade.initialRisk !== 0 ? Number(trade.pnl ?? 0) / trade.initialRisk : null,
      date: toIsoDate(trade.date),
      notes: trade.notes ?? undefined,
    })),
    macro_summary: (macroRows[0]?.summaryJson as JarvisContext['macro_summary']) ?? null,
    memory: memoryRows.map((row) => ({
      category: row.category as JarvisContext['memory'][number]['category'],
      key: row.key,
      value: row.value,
      value_json: row.valueJson,
    })),
  };
}
