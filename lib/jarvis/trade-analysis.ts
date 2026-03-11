import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { trades } from '@/lib/db/schema';
import { callJarvis } from '@/lib/jarvis/client';
import { buildContext } from '@/lib/jarvis/context';
import { extractTradeInsights } from '@/lib/jarvis/memory';
import { JARVIS_SYSTEM_PROMPT, buildTradeAnalysisPrompt } from '@/lib/jarvis/prompts';
import type { JarvisContext, JarvisTradeInput, TradeAnalysisOutput } from '@/lib/jarvis/types';

function asDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatMoney(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export function summarizeTrades(input: JarvisTradeInput[]) {
  const trades = input
    .map((trade) => {
      const date = asDate(trade.date);
      if (!date) return null;
      return {
        ...trade,
        date,
        pnl: Number(trade.netPnl ?? trade.pnl ?? 0),
      };
    })
    .filter((trade): trade is NonNullable<typeof trade> => trade != null);

  if (trades.length === 0) {
    return {
      totalTrades: 0,
      totalPnl: 0,
      winRate: 0,
      averagePnl: 0,
      topSymbols: [] as string[],
      latestTrades: [] as typeof trades,
    };
  }

  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const symbols = new Map<string, number>();
  for (const trade of trades) {
    symbols.set(trade.symbol, (symbols.get(trade.symbol) ?? 0) + 1);
  }

  const sortedByDate = [...trades].sort((a, b) => b.date.getTime() - a.date.getTime());
  const topSymbols = [...symbols.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([symbol]) => symbol);

  return {
    totalTrades: trades.length,
    totalPnl,
    winRate: (wins / trades.length) * 100,
    averagePnl: totalPnl / trades.length,
    topSymbols,
    latestTrades: sortedByDate.slice(0, 10),
  };
}

export function toModePrompt(context: JarvisContext) {
  const trades = context.user_trades;
  const summary = summarizeTrades(trades.map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
    date: trade.date,
    direction: trade.direction,
    pnl: trade.pnl,
    rMultiple: trade.r_multiple,
    notes: trade.notes,
  })));

  const latest = summary.latestTrades
    .map((trade) => `- ${trade.symbol} ${trade.direction ?? ''} ${formatMoney(trade.pnl)}${trade.notes ? ` notes: ${trade.notes.slice(0, 120)}` : ''}`)
    .join('\n');

  return [
    'Trade Analysis:',
    `- Sample size: ${summary.totalTrades} trades`,
    `- Net PnL: ${formatMoney(summary.totalPnl)}`,
    `- Average trade: ${formatMoney(summary.averagePnl)}`,
    `- Win rate: ${summary.winRate.toFixed(1)}%`,
    `- Top symbols: ${summary.topSymbols.join(', ') || 'N/A'}`,
    '',
    'Most recent trades:',
    latest || '- No trades available',
  ].join('\n');
}

export function normalizeTradeAnalysisPayload(payload: unknown): TradeAnalysisOutput {
  const rec = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const toArray = (value: unknown) => Array.isArray(value) ? value.map((item) => String(item)) : [];
  return {
    strengths: toArray(rec.strengths),
    weaknesses: toArray(rec.weaknesses),
    patterns: toArray(rec.patterns),
    action_items: toArray(rec.action_items),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function runTradeAnalysisPipeline(userId: string, days = 30) {
  const db = getDb();
  if (!db) {
    throw new Error('Database not configured');
  }

  const requestedDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
  const maxRows = Math.min(800, requestedDays * 40);
  await db.select({ id: trades.id })
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt))
    .limit(maxRows);

  const context = await buildContext(userId, 'trade-analysis');
  const prompt = buildTradeAnalysisPrompt(context);
  const llm = await callJarvis(JARVIS_SYSTEM_PROMPT, prompt);
  const normalized = normalizeTradeAnalysisPayload(parseJson(llm.content));

  await extractTradeInsights(userId, normalized);

  return {
    analysis: normalized,
    modelUsed: llm.modelUsed,
  };
}
